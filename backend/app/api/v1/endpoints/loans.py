from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from typing import List, Optional
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import or_, func

from app.db.session import get_db
from app.db.supabase import get_supabase_admin_client
from app.models.loan import Loan, LoanRepayment
from app.models.bank import BankAccount
from app.services.bank_service import BankService
from app.schemas.bank import BankDepositWithdrawRequest
from app.models.company import Company
from app.schemas.loan import (
    LoanCreate,
    LoanOut,
    LoanUpdate,
    LoanApproveRequest,
    LoanEndorseRequest,
    LoanAuditReviewRequest,
    LoanRepaymentCreate,
    LoanRepaymentOut,
    LoanStatementOut,
    CompanyLoanOut,
    CompanyLoanListOut,
)
from app.core.dependencies import AuditorUser, AuthenticatedUser, BusinessReader, BusinessWriter, FinanceUser, check_company_access, require_auditor_user, require_business_reader, require_business_writer, require_finance_user
from app.core.cache import system_cache
from app.core.websocket import ws_manager
from app.services.finance_service import FinanceService, FinanceCalculator
from app.services.audit_service import AuditAction, log_transaction

router = APIRouter()

from app.core.cache import get_cached, set_cached

def get_supabase_company_mapping(client, db: Optional[Session] = None):
    cached = get_cached("supabase_loan_company_mapping")
    if cached:
        return cached[0], cached[1]

    id_to_name = {}
    name_to_id = {}

    if db:
        try:
            comps = db.query(Company).all()
            for c in comps:
                id_to_name[c.company_id] = c.company_name
                name_to_id[c.company_name.strip().lower()] = c.company_id
        except Exception:
            pass

    if client:
        try:
            companies = client.table("company").select("company_id, company_name").execute().data or []
            for c in companies:
                id_to_name[c["company_id"]] = c["company_name"]
                name_to_id[c["company_name"].strip().lower()] = c["company_id"]
        except Exception:
            pass

    set_cached("supabase_loan_company_mapping", (id_to_name, name_to_id), ttl_seconds=600)
    return id_to_name, name_to_id


def resolve_company_id(
    cid: Optional[int],
    cname: Optional[str],
    name_to_id: dict,
    db: Session
) -> Optional[int]:
    if cid:
        return cid
    if cname and cname.strip():
        norm = cname.strip().lower()
        if norm in name_to_id:
            return name_to_id[norm]
        comp = db.query(Company).filter(func.lower(Company.company_name) == norm).first()
        if comp:
            return comp.company_id
        try:
            from app.core.company_resolver import resolve_company
            resolved = resolve_company(db, company_id=cid, company_name=cname)
            if resolved:
                return resolved.company_id
        except Exception:
            pass
    return None


def forbid_audit_edit(current_user: AuthenticatedUser) -> None:
    """Internal Audit can review loans but never edit them."""
    role = str(current_user.get("role") or "").strip().lower()
    if role in ("audit", "auditor"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Internal Audit users cannot edit loans.",
        )


def _company_loan_query(
    db: Session,
    borrower_id: Optional[int],
    lender_id: Optional[int],
    company_id: Optional[int],
    category: Optional[str],
    reference: Optional[str],
    particulars: Optional[str],
    payment_status: Optional[str],
    start_date: Optional[date],
    end_date: Optional[date],
):
    query = db.query(Loan)
    if borrower_id:
        query = query.filter(Loan.borrower == borrower_id)
    if lender_id:
        query = query.filter(Loan.lender == lender_id)
    if company_id:
        query = query.filter(or_(Loan.borrower == company_id, Loan.lender == company_id))
    query = query.filter(func.lower(Loan.status).in_(["approved", "paid", "overdue"]))
    if reference:
        query = query.filter(Loan.loan_ref_no.ilike(f"%{reference.strip()}%"))
    if particulars:
        query = query.filter(Loan.description.ilike(f"%{particulars.strip()}%"))
    if start_date:
        query = query.filter(Loan.loan_date >= start_date)
    if end_date:
        query = query.filter(Loan.loan_date <= end_date)
    return query


LOAN_CATEGORIES = ("Rent", "Electricity", "Water Bill", "Internet", "Operating Supplies")


def _loan_category(description: Optional[str]) -> Optional[str]:
    text = (description or "").lower()
    aliases = {
        "Rent": ("rent", "lease"),
        "Electricity": ("electricity", "electric", "power", "meralco"),
        "Water Bill": ("water", "maynilad", "manila water"),
        "Internet": ("internet", "wifi", "wi-fi", "broadband"),
        "Operating Supplies": ("operating supplies", "supplies", "utility", "utilities"),
    }
    for category, keywords in aliases.items():
        if any(keyword in text for keyword in keywords):
            return category
    return None


def _company_loan_item(loan: Loan, company_names: dict[int, str], db: Session) -> CompanyLoanOut:
    principal = Decimal(str(loan.principal_amount or 0))
    interest = FinanceCalculator.calculate_loan_interest(
        principal, Decimal(str(loan.interest_rate or 0))
    )
    total_payable = FinanceCalculator.calculate_loan_total_payable(principal, interest)
    total_paid = Decimal(str(
        db.query(func.coalesce(func.sum(LoanRepayment.amount), 0))
        .filter(LoanRepayment.loan_id == loan.loan_id, LoanRepayment.status != "pending")
        .scalar() or 0
    ))
    outstanding = FinanceCalculator.calculate_loan_remaining_balance(total_payable, total_paid)
    if outstanding <= 0:
        payment_status = "Fully Paid"
    elif loan.due_date and loan.due_date < date.today():
        payment_status = "Overdue"
    elif total_paid > 0:
        payment_status = "Partially Paid"
    else:
        payment_status = "Unpaid"
    category = _loan_category(loan.description) or "Operating Supplies"
    interest_display = f"{loan.interest_rate or Decimal('0.00')}%"
    return CompanyLoanOut(
        loan_id=loan.loan_id,
        borrower=loan.borrower,
        lender=loan.lender,
        borrower_name=company_names.get(loan.borrower) or f"Company #{loan.borrower}",
        lender_name=company_names.get(loan.lender) if loan.lender else "External Lender",
        loan_ref_no=loan.loan_ref_no,
        principal_amount=principal,
        amount=principal,
        interest_rate=Decimal(str(loan.interest_rate or 0)),
        interest_type=loan.interest_type or "simple",
        loan_date=loan.loan_date,
        due_date=loan.due_date,
        description=loan.description,
        particulars=loan.description,
        status=loan.status,
        category=category,
        total_paid=total_paid,
        outstanding_balance=outstanding,
        payment_status=payment_status,
        interest_display=interest_display,
        created_at=loan.created_at,
        updated_at=loan.updated_at,
    )


def _group_company_loans(
    loans: list[Loan], company_names: dict[int, str], db: Session
) -> list[dict]:
    groups: dict[tuple[int, Optional[int], str], list[CompanyLoanOut]] = {}
    for loan in loans:
        item = _company_loan_item(loan, company_names, db)
        key = (item.borrower, item.lender, item.category)
        groups.setdefault(key, []).append(item)

    result = []
    for (borrower, lender, category), items in groups.items():
        rates = {item.interest_rate for item in items}
        outstanding = sum((item.outstanding_balance for item in items), Decimal("0.00"))
        total_paid = sum((item.total_paid for item in items), Decimal("0.00"))
        statuses = {item.payment_status for item in items}
        if "Overdue" in statuses:
            payment_status = "Overdue"
        elif outstanding <= 0:
            payment_status = "Fully Paid"
        elif "Partially Paid" in statuses or "Fully Paid" in statuses:
            payment_status = "Partially Paid"
        else:
            payment_status = "Unpaid"
        interest_display = (
            f"{next(iter(rates))}%"
            if len(rates) == 1
            else "Multiple rates"
        )
        result.append({
            "borrower": borrower,
            "lender": lender,
            "borrower_name": items[0].borrower_name,
            "lender_name": items[0].lender_name,
            "category": category,
            "total_loan_amount": sum((item.principal_amount for item in items), Decimal("0.00")),
            "total_paid": total_paid,
            "outstanding_balance": outstanding,
            "interest_display": interest_display,
            "payment_status": payment_status,
            "loan_count": len(items),
            "loans": items,
        })
    return result


@router.get("/company", response_model=CompanyLoanListOut, summary="List approved company loans")
def get_company_loans(
    borrower_id: Optional[int] = Query(None),
    lender_id: Optional[int] = Query(None),
    company_id: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    reference: Optional[str] = Query(None),
    particulars: Optional[str] = Query(None),
    payment_status: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    role = (current_user.get("role") or "").lower()
    is_privileged = role in ("finance", "audit", "auditor")
    user_company_ids = current_user.get("company_ids") or []
    if not is_privileged and not user_company_ids and current_user.get("company_id"):
        user_company_ids = [current_user["company_id"]]

    if company_id:
        check_company_access(current_user, company_id)
    if borrower_id:
        check_company_access(current_user, borrower_id)
    if lender_id:
        check_company_access(current_user, lender_id)

    company_names = {c.company_id: c.company_name for c in db.query(Company).all()}
    query = _company_loan_query(
        db, borrower_id, lender_id, company_id, category, reference,
        particulars, payment_status, start_date, end_date,
    )
    if not is_privileged:
        if not user_company_ids:
            query = query.filter(Loan.loan_id == -1)
        else:
            query = query.filter(or_(Loan.borrower.in_(user_company_ids), Loan.lender.in_(user_company_ids)))

    groups = _group_company_loans(
        query.order_by(Loan.loan_date.desc(), Loan.loan_id.desc()).all(),
        company_names,
        db,
    )
    if category and category.lower() != "all":
        groups = [group for group in groups if group["category"].lower() == category.lower()]
    if payment_status and payment_status.lower() != "all":
        groups = [group for group in groups if group["payment_status"].lower() == payment_status.lower()]
    total = len(groups)
    items = groups[offset:offset + limit]
    return CompanyLoanListOut(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/company/export", summary="Export approved company loans as CSV")
def export_company_loans(
    borrower_id: Optional[int] = Query(None),
    lender_id: Optional[int] = Query(None),
    company_id: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    reference: Optional[str] = Query(None),
    particulars: Optional[str] = Query(None),
    payment_status: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
) -> Response:
    import csv
    import io

    role = (current_user.get("role") or "").lower()
    is_privileged = role in ("finance", "audit", "auditor")
    user_company_ids = current_user.get("company_ids") or []
    if not is_privileged and not user_company_ids and current_user.get("company_id"):
        user_company_ids = [current_user["company_id"]]

    if company_id:
        check_company_access(current_user, company_id)
    if borrower_id:
        check_company_access(current_user, borrower_id)
    if lender_id:
        check_company_access(current_user, lender_id)

    company_names = {c.company_id: c.company_name for c in db.query(Company).all()}
    query = _company_loan_query(
        db, borrower_id, lender_id, company_id, category, reference,
        particulars, payment_status, start_date, end_date,
    )

    if not is_privileged:
        if not user_company_ids:
            query = query.filter(Loan.loan_id == -1)
        else:
            query = query.filter(or_(Loan.borrower.in_(user_company_ids), Loan.lender.in_(user_company_ids)))

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Borrower Company", "Lender Company", "Category", "Total Loan Amount",
        "Total Paid", "Outstanding Balance", "Interest Rate", "Status",
    ])
    groups = _group_company_loans(
        query.order_by(Loan.loan_date.desc(), Loan.loan_id.desc()).all(),
        company_names,
        db,
    )
    if category and category.lower() != "all":
        groups = [group for group in groups if group["category"].lower() == category.lower()]
    if payment_status and payment_status.lower() != "all":
        groups = [group for group in groups if group["payment_status"].lower() == payment_status.lower()]
    for group in groups:
        writer.writerow([
            group["borrower_name"],
            group["lender_name"],
            group["category"],
            group["total_loan_amount"],
            group["total_paid"],
            group["outstanding_balance"],
            group["interest_display"],
            group["payment_status"],
        ])
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="company-loans.csv"'},
    )


@router.get("", response_model=List[LoanOut], summary="List loans from Supabase / DB")
def get_loans(
    borrower_id: Optional[int] = Query(None, description="Filter by Borrower Company ID"),
    lender_id: Optional[int] = Query(None, description="Filter by Lender Company ID"),
    company_name: Optional[str] = Query(None, description="Filter by Company Name (matches borrower or lender)"),
    scope: Optional[str] = Query(None, description="'borrower' or 'lender' tab scope"),
    status: Optional[str] = Query(None, description="Filter by Loan Status"),
    start_date: Optional[date] = Query(None, description="Filter from loan date"),
    end_date: Optional[date] = Query(None, description="Filter to loan date"),
    user_role: Optional[str] = Query(None, description="Current user role"),
    request: Request = None,
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    role = (current_user.get("role") or "").strip().lower()
    is_auditor = role in {"audit", "auditor"}

    is_privileged = role in ("finance", "audit", "auditor")
    user_company_ids = current_user.get("company_ids") or []
    if not is_privileged and not user_company_ids and current_user.get("company_id"):
        user_company_ids = [current_user["company_id"]]

    scope_cids = "all" if is_privileged else ",".join(str(c) for c in sorted(user_company_ids))
    cache_key = f"loans_{borrower_id}_{lender_id}_{company_name}_{scope}_{status}_{start_date}_{end_date}_{role}_{scope_cids}"
    cached = system_cache.get(cache_key)
    if cached is not None:
        return cached

    if borrower_id:
        check_company_access(current_user, borrower_id)
    if lender_id:
        check_company_access(current_user, lender_id)

    try:
        client = get_supabase_admin_client()
        id_to_name, name_to_id = get_supabase_company_mapping(client, db)

        resolved_target_cid = None
        if company_name and company_name.lower() != "all companies":
            resolved_target_cid = resolve_company_id(None, company_name, name_to_id, db)
            if resolved_target_cid and not is_privileged:
                check_company_access(current_user, resolved_target_cid)

        sb_query = client.table("loan").select("*")

        if isinstance(borrower_id, int):
            sb_query = sb_query.eq("borrower", borrower_id)
        if isinstance(lender_id, int):
            sb_query = sb_query.eq("lender", lender_id)

        if resolved_target_cid:
            if scope == "borrower":
                sb_query = sb_query.eq("borrower", resolved_target_cid)
            elif scope == "lender":
                sb_query = sb_query.eq("lender", resolved_target_cid)
            else:
                # Matches either borrower or lender
                sb_query = sb_query.or_(f"borrower.eq.{resolved_target_cid},lender.eq.{resolved_target_cid}")
        elif not is_privileged:
            if not user_company_ids:
                return []
            if len(user_company_ids) == 1:
                cid = user_company_ids[0]
                sb_query = sb_query.or_(f"borrower.eq.{cid},lender.eq.{cid}")
            else:
                or_clause = ",".join([f"borrower.eq.{cid},lender.eq.{cid}" for cid in user_company_ids])
                sb_query = sb_query.or_(or_clause)

        if isinstance(status, str) and status.lower() != "all":
            sb_query = sb_query.eq("status", status)

        if isinstance(start_date, (date, datetime)):
            sb_query = sb_query.gte("loan_date", start_date.isoformat())
        if isinstance(end_date, (date, datetime)):
            sb_query = sb_query.lte("loan_date", end_date.isoformat())

        res = sb_query.order("loan_date", desc=True).order("loan_id", desc=True).execute()
        rows = res.data or []

        result: List[LoanOut] = []
        for r in rows:
            row_status = r.get("status") or "Pending Finance Endorsement"
            if is_auditor and row_status in {"Pending Finance Endorsement", "Pending Approval"}:
                continue

            b_id = r.get("borrower")
            l_id = r.get("lender")
            p_amt = Decimal(str(r.get("principal_amount") or 0.0))
            desc = r.get("description") or ""

            result.append(
                LoanOut(
                    loan_id=r["loan_id"],
                    borrower=b_id,
                    lender=l_id,
                    borrower_name=id_to_name.get(b_id) or f"Company #{b_id}",
                    lender_name=id_to_name.get(l_id) if l_id else "Pending Finance Assignment",
                    loan_ref_no=r.get("loan_ref_no"),
                    principal_amount=p_amt,
                    amount=p_amt,
                    interest_rate=Decimal(str(r.get("interest_rate") or 0.0)),
                    interest_type=r.get("interest_type") or "simple",
                    loan_date=r.get("loan_date"),
                    due_date=r.get("due_date"),
                    description=desc,
                    particulars=desc,
                    status=row_status,
                    endorsed_by=r.get("endorsed_by"),
                    endorsed_at=r.get("endorsed_at"),
                    finance_remark=r.get("finance_remark"),
                    audit_reviewed_by=r.get("audit_reviewed_by"),
                    audit_reviewed_at=r.get("audit_reviewed_at"),
                    audit_remark=r.get("audit_remark"),
                    bank_account_id=r.get("bank_account_id"),
                    created_at=r.get("created_at"),
                    updated_at=r.get("updated_at"),
                )
            )
        system_cache.set(cache_key, result, ttl=45, tags=["loans"])
        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"Supabase GET /loans failed, falling back to local SQLite: {e}")
        query = db.query(Loan)

        resolved_target_cid = None
        if company_name and company_name.lower() != "all companies":
            resolved_target_cid = resolve_company_id(None, company_name, {}, db)
            if resolved_target_cid and not is_privileged:
                check_company_access(current_user, resolved_target_cid)

        if isinstance(borrower_id, int):
            query = query.filter(Loan.borrower == borrower_id)
        if isinstance(lender_id, int):
            query = query.filter(Loan.lender == lender_id)

        if resolved_target_cid:
            if scope == "borrower":
                query = query.filter(Loan.borrower == resolved_target_cid)
            elif scope == "lender":
                query = query.filter(Loan.lender == resolved_target_cid)
            else:
                query = query.filter(or_(Loan.borrower == resolved_target_cid, Loan.lender == resolved_target_cid))
        elif not is_privileged:
            if not user_company_ids:
                return []
            query = query.filter(or_(Loan.borrower.in_(user_company_ids), Loan.lender.in_(user_company_ids)))

        if isinstance(status, str) and status.lower() != "all":
            query = query.filter(Loan.status == status)

        if is_auditor:
            query = query.filter(~Loan.status.in_(["Pending Finance Endorsement", "Pending Approval"]))

        if isinstance(start_date, (date, datetime)):
            query = query.filter(Loan.loan_date >= start_date)
        if isinstance(end_date, (date, datetime)):
            query = query.filter(Loan.loan_date <= end_date)

        loans = query.order_by(Loan.loan_date.desc(), Loan.loan_id.desc()).all()

        companies = db.query(Company).all()
        comp_map = {c.company_id: c.company_name for c in companies}

        fallback_result = [
            LoanOut(
                loan_id=l.loan_id,
                borrower=l.borrower,
                lender=l.lender,
                borrower_name=comp_map.get(l.borrower) or f"Company #{l.borrower}",
                lender_name=comp_map.get(l.lender) if l.lender else "Pending Finance Assignment",
                loan_ref_no=l.loan_ref_no,
                principal_amount=l.principal_amount,
                amount=l.principal_amount,
                interest_rate=l.interest_rate or Decimal("0.00"),
                interest_type=l.interest_type or "simple",
                loan_date=l.loan_date,
                due_date=l.due_date,
                description=l.description,
                particulars=l.description,
                status=getattr(l, "status", None) or "Pending Finance Endorsement",
                endorsed_by=getattr(l, "endorsed_by", None),
                endorsed_at=getattr(l, "endorsed_at", None),
                finance_remark=getattr(l, "finance_remark", None),
                audit_reviewed_by=getattr(l, "audit_reviewed_by", None),
                audit_reviewed_at=getattr(l, "audit_reviewed_at", None),
                audit_remark=getattr(l, "audit_remark", None),
                bank_account_id=getattr(l, "bank_account_id", None),
                created_at=l.created_at,
                updated_at=l.updated_at,
            )
            for l in loans
        ]
        system_cache.set(cache_key, fallback_result, ttl=45, tags=["loans"])
        return fallback_result


@router.post("", response_model=LoanOut, status_code=status.HTTP_201_CREATED, summary="Create a new loan record")
def create_loan(
    loan_in: LoanCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db)
):

    client = None
    name_to_id = {}
    id_to_name = {}
    try:
        client = get_supabase_admin_client()
        id_to_name, name_to_id = get_supabase_company_mapping(client)
    except Exception:
        pass

    borrower_id = resolve_company_id(loan_in.borrower, loan_in.borrower_company, name_to_id, db)
    lender_id = resolve_company_id(loan_in.lender, loan_in.lender_company, name_to_id, db) if (loan_in.lender or loan_in.lender_company) else None

    if not borrower_id:
        raise HTTPException(status_code=400, detail="Borrower company could not be resolved.")

    check_company_access(current_user, borrower_id)

    if lender_id and borrower_id == lender_id:
        raise HTTPException(status_code=400, detail="Borrower and lender cannot be the same company.")

    if loan_in.principal_amount < Decimal("1.00"):
        raise HTTPException(status_code=400, detail="Loan amount must be at least 1.00 (cannot be 0 or letters).")

    desc = (loan_in.particulars or loan_in.description or "").strip()
    if not desc:
        desc = "Inter-company term financing facility"

    ref_no = loan_in.loan_ref_no
    if not ref_no or not ref_no.strip():
        date_str = loan_in.loan_date.strftime("%Y%m%d") if loan_in.loan_date else datetime.now().strftime("%Y%m%d")
        ref_no = f"LN-{date_str}-{int(datetime.now().timestamp() % 10000):04d}"

    row_data = {
        "borrower": borrower_id,
        "lender": lender_id,
        "loan_ref_no": ref_no,
        "principal_amount": float(loan_in.principal_amount),
        "interest_rate": float(loan_in.interest_rate or 0.0),
        "interest_type": loan_in.interest_type or "simple",
        "loan_date": loan_in.loan_date.isoformat(),
        "due_date": loan_in.due_date.isoformat() if loan_in.due_date else None,
        "description": desc,
        "status": "Pending Finance Endorsement",
    }

    created_row = None
    if client:
        try:
            sb_res = client.table("loan").insert(row_data).execute()
            if sb_res.data and len(sb_res.data) > 0:
                created_row = sb_res.data[0]
        except Exception as e:
            print(f"Supabase insert loan error: {e}")

    final_id = created_row["loan_id"] if created_row else None

    # Mirror into SQLite if Supabase inserted, or insert into db if Supabase was unavailable
    if not created_row or (db.bind and db.bind.dialect.name == "sqlite"):
        sqlite_loan = Loan(
            loan_id=created_row["loan_id"] if created_row else None,
            borrower=borrower_id,
            lender=lender_id,
            loan_ref_no=ref_no,
            principal_amount=loan_in.principal_amount,
            interest_rate=loan_in.interest_rate or Decimal("0.00"),
            interest_type=loan_in.interest_type or "simple",
            loan_date=loan_in.loan_date,
            due_date=loan_in.due_date,
            description=desc,
            status="Pending Finance Endorsement",
        )
        try:
            db.add(sqlite_loan)
            db.commit()
            db.refresh(sqlite_loan)
            final_id = final_id or sqlite_loan.loan_id
        except Exception as e:
            db.rollback()
            print(f"Database mirror insert loan error: {e}")
    b_name = id_to_name.get(borrower_id) or loan_in.borrower_company or f"Company #{borrower_id}"
    l_name = id_to_name.get(lender_id) if lender_id else (loan_in.lender_company or "Pending Finance Assignment")

    try:
        log_transaction(
            db, AuditAction.LOAN_CREATED,
            user_id=None, company_id=borrower_id,
            ip_address=request.client.host if request.client else "unknown",
            record_id=final_id, record_type="loan",
            extra={"borrower": borrower_id, "lender": lender_id, "amount": float(loan_in.principal_amount)},
        )
    except Exception:
        pass

    system_cache.invalidate_tag("loans")
    system_cache.invalidate_tag("notifications")
    ws_manager.broadcast_sync({"type": "LOANS_UPDATED"})

    return LoanOut(
        loan_id=final_id,
        borrower=borrower_id,
        lender=lender_id,
        borrower_name=b_name,
        lender_name=l_name,
        loan_ref_no=ref_no,
        principal_amount=loan_in.principal_amount,
        amount=loan_in.principal_amount,
        interest_rate=loan_in.interest_rate or Decimal("0.00"),
        interest_type=loan_in.interest_type or "simple",
        loan_date=loan_in.loan_date,
        due_date=loan_in.due_date,
        description=desc,
        particulars=desc,
        status="Pending Finance Endorsement",
        created_at=datetime.now(),
        updated_at=datetime.now(),
    )


@router.put("/{loan_id}", response_model=LoanOut, summary="Update an existing loan (Only allowed if Pending Approval)")
def update_loan(
    loan_id: int,
    loan_update: LoanUpdate,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db)
):
    forbid_audit_edit(current_user)

    client = None
    try:
        client = get_supabase_admin_client()
    except Exception:
        pass

    # Check current status
    existing_status = None
    existing_row = None
    if client:
        try:
            res = client.table("loan").select("*").eq("loan_id", loan_id).execute()
            if res.data and len(res.data) > 0:
                existing_row = res.data[0]
                existing_status = existing_row.get("status")
        except Exception:
            pass

    sql_loan = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    if not existing_status and sql_loan:
        existing_status = sql_loan.status

    if not existing_row and not sql_loan:
        raise HTTPException(status_code=404, detail="Loan not found.")

    borrower_id = (existing_row.get("borrower") if existing_row else None) or (sql_loan.borrower if sql_loan else None)
    if borrower_id:
        check_company_access(current_user, borrower_id)

    if existing_status and existing_status.strip().lower() not in {"pending approval", "pending finance endorsement"}:
        raise HTTPException(
            status_code=400,
            detail=f"Loan is already {existing_status}. Once reviewed, loans can no longer be edited."
        )

    update_payload = {}
    if loan_update.principal_amount is not None:
        if loan_update.principal_amount < Decimal("1.00"):
            raise HTTPException(status_code=400, detail="Loan amount must be at least 1.00.")
        update_payload["principal_amount"] = float(loan_update.principal_amount)
    elif loan_update.amount is not None:
        if loan_update.amount < Decimal("1.00"):
            raise HTTPException(status_code=400, detail="Loan amount must be at least 1.00.")
        update_payload["principal_amount"] = float(loan_update.amount)

    if loan_update.interest_rate is not None:
        update_payload["interest_rate"] = float(loan_update.interest_rate)
    if loan_update.loan_date is not None:
        update_payload["loan_date"] = loan_update.loan_date.isoformat()
    if loan_update.due_date is not None:
        update_payload["due_date"] = loan_update.due_date.isoformat()
    if loan_update.particulars is not None or loan_update.description is not None:
        desc = (loan_update.particulars or loan_update.description or "").strip()
        update_payload["description"] = desc
    if loan_update.loan_ref_no is not None:
        update_payload["loan_ref_no"] = loan_update.loan_ref_no.strip()

    id_to_name, name_to_id = get_supabase_company_mapping(client) if client else ({}, {})
    if loan_update.lender or loan_update.lender_company:
        lid = resolve_company_id(loan_update.lender, loan_update.lender_company, name_to_id, db)
        if lid:
            update_payload["lender"] = lid

    updated_row = None
    if client and update_payload:
        try:
            update_payload["updated_at"] = datetime.now().isoformat()
            sb_res = client.table("loan").update(update_payload).eq("loan_id", loan_id).execute()
            if sb_res.data and len(sb_res.data) > 0:
                updated_row = sb_res.data[0]
        except Exception as e:
            print(f"Supabase update loan error: {e}")

    if sql_loan and update_payload:
        if "principal_amount" in update_payload:
            sql_loan.principal_amount = Decimal(str(update_payload["principal_amount"]))
        if "interest_rate" in update_payload:
            sql_loan.interest_rate = Decimal(str(update_payload["interest_rate"]))
        if "loan_date" in update_payload:
            sql_loan.loan_date = datetime.strptime(update_payload["loan_date"], "%Y-%m-%d").date()
        if "due_date" in update_payload:
            sql_loan.due_date = datetime.strptime(update_payload["due_date"], "%Y-%m-%d").date()
        if "description" in update_payload:
            sql_loan.description = update_payload["description"]
        if "lender" in update_payload:
            sql_loan.lender = update_payload["lender"]
        db.commit()
        db.refresh(sql_loan)

    system_cache.invalidate_tag("loans")
    system_cache.invalidate_tag("notifications")
    ws_manager.broadcast_sync({"type": "LOANS_UPDATED"})
    final_row = updated_row or existing_row
    if final_row:
        b_id = final_row.get("borrower")
        l_id = final_row.get("lender")
        p_amt = Decimal(str(final_row.get("principal_amount") or 0.0))
        return LoanOut(
            loan_id=final_row["loan_id"],
            borrower=b_id,
            lender=l_id,
            borrower_name=id_to_name.get(b_id) or f"Company #{b_id}",
            lender_name=id_to_name.get(l_id) or f"Company #{l_id}",
            loan_ref_no=final_row.get("loan_ref_no"),
            principal_amount=p_amt,
            amount=p_amt,
            interest_rate=Decimal(str(final_row.get("interest_rate") or 0.0)),
            interest_type=final_row.get("interest_type") or "simple",
            loan_date=final_row.get("loan_date"),
            due_date=final_row.get("due_date"),
            description=final_row.get("description"),
            particulars=final_row.get("description"),
            status=final_row.get("status") or "Pending Finance Endorsement",
            endorsed_by=final_row.get("endorsed_by"),
            endorsed_at=final_row.get("endorsed_at"),
            finance_remark=final_row.get("finance_remark"),
            audit_reviewed_by=final_row.get("audit_reviewed_by"),
            audit_reviewed_at=final_row.get("audit_reviewed_at"),
            audit_remark=final_row.get("audit_remark"),
            created_at=final_row.get("created_at"),
            updated_at=final_row.get("updated_at"),
        )

    system_cache.invalidate_tag("loans")
    system_cache.invalidate_tag("notifications")
    ws_manager.broadcast_sync({"type": "LOANS_UPDATED"})
    return LoanOut.model_validate(sql_loan)


@router.post("/{loan_id}/endorse", response_model=LoanOut, summary="Finance endorses or rejects a pending loan request")
def endorse_loan(
    loan_id: int,
    endorse_in: LoanEndorseRequest,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_finance_user),
    db: Session = Depends(get_db)
):
    client = None
    name_to_id = {}
    id_to_name = {}
    try:
        client = get_supabase_admin_client()
        id_to_name, name_to_id = get_supabase_company_mapping(client, db)
    except Exception:
        pass

    sql_loan = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    existing_row = None
    if client:
        try:
            res = client.table("loan").select("*").eq("loan_id", loan_id).execute()
            if res.data and len(res.data) > 0:
                existing_row = res.data[0]
        except Exception:
            pass

    if not existing_row and not sql_loan:
        raise HTTPException(status_code=404, detail="Loan not found.")

    borrower_id = (existing_row.get("borrower") if existing_row else None) or (sql_loan.borrower if sql_loan else None)

    action_norm = (endorse_in.action or "endorse").strip().lower()
    remark_text = (endorse_in.remark or "").strip()
    if not remark_text:
        raise HTTPException(status_code=400, detail="Finance endorsement or rejection remark is required.")

    endorser_name = request.headers.get("X-User-Name") or "Finance Officer"
    now_ts = datetime.now()

    if action_norm == "endorse":
        # The funding bank is the only thing Finance must choose. The lender company
        # is whoever owns that bank account.
        funding_bank_id = (
            endorse_in.bank_account_id
            or (existing_row.get("bank_account_id") if existing_row else None)
            or (sql_loan.bank_account_id if sql_loan else None)
        )
        if not funding_bank_id:
            raise HTTPException(status_code=400, detail="Please choose a bank account to disburse this loan.")

        funding_bank_account = db.query(BankAccount).filter(BankAccount.id == funding_bank_id).first()
        if not funding_bank_account:
            raise HTTPException(status_code=400, detail="The selected bank account was not found.")

        final_lender_id = funding_bank_account.company_id or resolve_company_id(
            None, funding_bank_account.company_name, name_to_id, db
        )
        if final_lender_id is None:
            # The bank has no company we can match; keep whatever lender the loan already has.
            final_lender_id = (existing_row.get("lender") if existing_row else None) or (sql_loan.lender if sql_loan else None)
        if not endorse_in.bank_account_id:
            endorse_in.bank_account_id = funding_bank_id
        if borrower_id and final_lender_id == borrower_id:
            raise HTTPException(status_code=400, detail="Lender company cannot be the same as the borrower company.")

        new_status = "Pending Audit Approval"
    else:
        final_lender_id = (existing_row.get("lender") if existing_row else None) or (sql_loan.lender if sql_loan else None)
        new_status = "Rejected by Finance"

    update_payload = {
        "status": new_status,
        "endorsed_by": endorser_name,
        "endorsed_at": now_ts.isoformat(),
        "finance_remark": remark_text,
        "updated_at": now_ts.isoformat(),
    }
    if final_lender_id:
        update_payload["lender"] = final_lender_id
    if endorse_in.bank_account_id:
        update_payload["bank_account_id"] = endorse_in.bank_account_id
    if endorse_in.interest_rate is not None:
        update_payload["interest_rate"] = float(endorse_in.interest_rate)
    if endorse_in.due_date is not None:
        update_payload["due_date"] = endorse_in.due_date.isoformat()

    updated_row = None
    if client:
        try:
            sb_res = client.table("loan").update(update_payload).eq("loan_id", loan_id).execute()
            if sb_res.data and len(sb_res.data) > 0:
                updated_row = sb_res.data[0]
        except Exception as e:
            print(f"Supabase endorse loan error: {e}")

    if sql_loan:
        sql_loan.status = new_status
        sql_loan.endorsed_by = endorser_name
        sql_loan.endorsed_at = now_ts
        sql_loan.finance_remark = remark_text
        if final_lender_id:
            sql_loan.lender = final_lender_id
        if endorse_in.bank_account_id:
            sql_loan.bank_account_id = endorse_in.bank_account_id
        if endorse_in.interest_rate is not None:
            sql_loan.interest_rate = Decimal(str(endorse_in.interest_rate))
        if endorse_in.due_date is not None:
            sql_loan.due_date = endorse_in.due_date
        db.commit()
        db.refresh(sql_loan)

    if not id_to_name and client:
        id_to_name, _ = get_supabase_company_mapping(client)
    if not id_to_name:
        comps = db.query(Company).all()
        id_to_name = {c.company_id: c.company_name for c in comps}

    final_source = updated_row or (existing_row or {})
    final_lender = final_lender_id or final_source.get("lender")
    p_amt = Decimal(str(final_source.get("principal_amount") or (sql_loan.principal_amount if sql_loan else 0.0)))

    try:
        log_transaction(
            db, AuditAction.LOAN_UPDATED,
            user_id=None, company_id=borrower_id,
            ip_address=request.client.host if request.client else "unknown",
            record_id=loan_id, record_type="loan_endorsement",
            extra={"action": action_norm, "status": new_status, "finance_remark": remark_text},
        )
    except Exception:
        pass

    system_cache.invalidate_tag("loans")
    system_cache.invalidate_tag("notifications")
    ws_manager.broadcast_sync({"type": "LOANS_UPDATED"})

    return LoanOut(
        loan_id=loan_id,
        borrower=borrower_id,
        lender=final_lender,
        borrower_name=id_to_name.get(borrower_id) or f"Company #{borrower_id}",
        lender_name=id_to_name.get(final_lender) if final_lender else "Pending Finance Assignment",
        loan_ref_no=final_source.get("loan_ref_no") or (sql_loan.loan_ref_no if sql_loan else None),
        principal_amount=p_amt,
        amount=p_amt,
        interest_rate=Decimal(str(update_payload.get("interest_rate") or final_source.get("interest_rate") or (sql_loan.interest_rate if sql_loan else 0.0))),
        interest_type=final_source.get("interest_type") or "simple",
        loan_date=final_source.get("loan_date") or (sql_loan.loan_date if sql_loan else None),
        due_date=endorse_in.due_date or final_source.get("due_date") or (sql_loan.due_date if sql_loan else None),
        description=final_source.get("description") or (sql_loan.description if sql_loan else None),
        particulars=final_source.get("description") or (sql_loan.description if sql_loan else None),
        status=new_status,
        endorsed_by=endorser_name,
        endorsed_at=now_ts,
        finance_remark=remark_text,
        audit_reviewed_by=final_source.get("audit_reviewed_by"),
        audit_reviewed_at=final_source.get("audit_reviewed_at"),
        audit_remark=final_source.get("audit_remark"),
        bank_account_id=update_payload.get("bank_account_id") or final_source.get("bank_account_id") or (sql_loan.bank_account_id if sql_loan else None),
        created_at=final_source.get("created_at") or datetime.now(),
        updated_at=now_ts,
    )


@router.post("/{loan_id}/audit-review", response_model=LoanOut, summary="Audit approves or disapproves a finance endorsed loan")
def audit_review_loan(
    loan_id: int,
    review_in: LoanAuditReviewRequest,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_auditor_user),
    db: Session = Depends(get_db)
):
    client = None
    name_to_id = {}
    id_to_name = {}
    try:
        client = get_supabase_admin_client()
        id_to_name, name_to_id = get_supabase_company_mapping(client, db)
    except Exception:
        pass

    sql_loan = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    existing_row = None
    if client:
        try:
            res = client.table("loan").select("*").eq("loan_id", loan_id).execute()
            if res.data and len(res.data) > 0:
                existing_row = res.data[0]
        except Exception:
            pass

    if not existing_row and not sql_loan:
        raise HTTPException(status_code=404, detail="Loan not found.")

    borrower_id = (existing_row.get("borrower") if existing_row else None) or (sql_loan.borrower if sql_loan else None)
    lender_id = (existing_row.get("lender") if existing_row else None) or (sql_loan.lender if sql_loan else None)

    action_norm = (review_in.action or "").strip().lower()
    remark_text = (review_in.remark or "").strip()
    if not remark_text:
        raise HTTPException(status_code=400, detail="Audit remark is required.")

    reviewer_name = request.headers.get("X-User-Name") or "Internal Auditor"
    now_ts = datetime.now()

    if action_norm == "approve":
        new_status = "Approved"
    elif action_norm in {"disapprove", "reject"}:
        new_status = "Disapproved by Audit"
    else:
        raise HTTPException(status_code=400, detail=f"Invalid action '{review_in.action}'. Allowed: approve, disapprove.")

    update_payload = {
        "status": new_status,
        "audit_reviewed_by": reviewer_name,
        "audit_reviewed_at": now_ts.isoformat(),
        "audit_remark": remark_text,
        "updated_at": now_ts.isoformat(),
    }

    updated_row = None
    if client:
        try:
            sb_res = client.table("loan").update(update_payload).eq("loan_id", loan_id).execute()
            if sb_res.data and len(sb_res.data) > 0:
                updated_row = sb_res.data[0]
        except Exception as e:
            print(f"Supabase audit review loan error: {e}")

    if sql_loan:
        sql_loan.status = new_status
        sql_loan.audit_reviewed_by = reviewer_name
        sql_loan.audit_reviewed_at = now_ts
        sql_loan.audit_remark = remark_text
        db.commit()
        db.refresh(sql_loan)

    if not id_to_name and client:
        id_to_name, _ = get_supabase_company_mapping(client)
    if not id_to_name:
        comps = db.query(Company).all()
        id_to_name = {c.company_id: c.company_name for c in comps}

    final_source = updated_row or (existing_row or {})
    p_amt = Decimal(str(final_source.get("principal_amount") or (sql_loan.principal_amount if sql_loan else 0.0)))

    if action_norm == "approve" and p_amt > Decimal("0.00"):
        loan_ref = final_source.get("loan_ref_no") or (sql_loan.loan_ref_no if sql_loan else str(loan_id))
        funding_bank_id = (sql_loan.bank_account_id if sql_loan else None) or final_source.get("bank_account_id")
        
        bank_svc = BankService(db)
        funding_acc = None
        if funding_bank_id:
            funding_acc = db.query(BankAccount).filter(BankAccount.id == funding_bank_id).first()
        if not funding_acc and lender_id:
            l_name_lookup = id_to_name.get(lender_id) or ""
            funding_acc = bank_svc.find_account_for_company(l_name_lookup)

        b_name_disp = id_to_name.get(borrower_id) or f"Company #{borrower_id}"
        l_name_disp = id_to_name.get(lender_id) or "Corporate Treasury"

        if funding_acc:
            try:
                w_req = BankDepositWithdrawRequest(
                    amount=p_amt,
                    date=datetime.now().strftime("%m/%d/%y"),
                    particulars=f"Loan Disbursement to {b_name_disp} (Ref: {loan_ref})",
                    category="Bank Transfer",
                    reference_no=loan_ref,
                )
                bank_svc.withdraw(funding_acc.id, w_req)
                ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"account_id": funding_acc.id}})
            except Exception as exc:
                print(f"Audit approval bank deduction error: {exc}")
                raise HTTPException(status_code=400, detail=f"Bank deduction failed: {exc}")

        # Deposit to supervisor/borrower account
        borrower_acc = db.query(BankAccount).filter(BankAccount.company_id == borrower_id).first()
        if not borrower_acc:
            borrower_acc = bank_svc.find_account_for_company(b_name_disp)
        if borrower_acc:
            try:
                d_req = BankDepositWithdrawRequest(
                    amount=p_amt,
                    date=datetime.now().strftime("%m/%d/%y"),
                    particulars=f"Loan Proceeds from {l_name_disp} (Ref: {loan_ref})",
                    category="Bank Transfer",
                    reference_no=loan_ref,
                )
                bank_svc.deposit(borrower_acc.id, d_req)
                ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"account_id": borrower_acc.id}})
            except Exception as exc:
                print(f"Audit approval borrower bank deposit error: {exc}")

    try:
        log_transaction(
            db, AuditAction.LOAN_UPDATED,
            user_id=None, company_id=borrower_id,
            ip_address=request.client.host if request.client else "unknown",
            record_id=loan_id, record_type="loan_audit_review",
            extra={"action": action_norm, "status": new_status, "audit_remark": remark_text},
        )
    except Exception:
        pass

    system_cache.invalidate_tag("loans")
    system_cache.invalidate_tag("notifications")
    ws_manager.broadcast_sync({"type": "LOANS_UPDATED"})

    return LoanOut(
        loan_id=loan_id,
        borrower=borrower_id,
        lender=lender_id,
        borrower_name=id_to_name.get(borrower_id) or f"Company #{borrower_id}",
        lender_name=id_to_name.get(lender_id) if lender_id else "Pending Finance Assignment",
        loan_ref_no=final_source.get("loan_ref_no") or (sql_loan.loan_ref_no if sql_loan else None),
        principal_amount=p_amt,
        amount=p_amt,
        interest_rate=Decimal(str(final_source.get("interest_rate") or (sql_loan.interest_rate if sql_loan else 0.0))),
        interest_type=final_source.get("interest_type") or "simple",
        loan_date=final_source.get("loan_date") or (sql_loan.loan_date if sql_loan else None),
        due_date=final_source.get("due_date") or (sql_loan.due_date if sql_loan else None),
        description=final_source.get("description") or (sql_loan.description if sql_loan else None),
        particulars=final_source.get("description") or (sql_loan.description if sql_loan else None),
        status=new_status,
        endorsed_by=final_source.get("endorsed_by") or (sql_loan.endorsed_by if sql_loan else None),
        endorsed_at=final_source.get("endorsed_at") or (sql_loan.endorsed_at if sql_loan else None),
        finance_remark=final_source.get("finance_remark") or (sql_loan.finance_remark if sql_loan else None),
        audit_reviewed_by=reviewer_name,
        audit_reviewed_at=now_ts,
        audit_remark=remark_text,
        bank_account_id=final_source.get("bank_account_id") or (sql_loan.bank_account_id if sql_loan else None),
        created_at=final_source.get("created_at") or datetime.now(),
        updated_at=now_ts,
    )


@router.patch("/{loan_id}/approve", response_model=LoanOut, summary="Finance approves a pending loan request and assigns lender")
@router.post("/{loan_id}/approve", response_model=LoanOut, summary="Finance approves a pending loan request and assigns lender")
def approve_loan(
    loan_id: int,
    approval_in: Optional[LoanApproveRequest] = None,
    current_user: AuthenticatedUser = Depends(require_finance_user),
    db: Session = Depends(get_db)
):
    client = None
    name_to_id = {}
    id_to_name = {}
    try:
        client = get_supabase_admin_client()
        id_to_name, name_to_id = get_supabase_company_mapping(client, db)
    except Exception:
        pass

    sql_loan = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    existing_row = None
    if client:
        try:
            res = client.table("loan").select("*").eq("loan_id", loan_id).execute()
            if res.data and len(res.data) > 0:
                existing_row = res.data[0]
        except Exception:
            pass

    if not existing_row and not sql_loan:
        raise HTTPException(status_code=404, detail="Loan not found.")

    borrower_id = (existing_row.get("borrower") if existing_row else None) or (sql_loan.borrower if sql_loan else None)

    # Determine assigned lender
    new_lender_id = None
    if approval_in and (approval_in.lender or approval_in.lender_company):
        new_lender_id = resolve_company_id(approval_in.lender, approval_in.lender_company, name_to_id, db)

    current_lender = (existing_row.get("lender") if existing_row else None) or (sql_loan.lender if sql_loan else None)
    final_lender_id = new_lender_id or current_lender

    if not final_lender_id:
        raise HTTPException(
            status_code=400,
            detail="A lending company must be selected by Finance to approve this loan.",
        )

    if borrower_id and final_lender_id == borrower_id:
        raise HTTPException(
            status_code=400,
            detail="Lender company cannot be the same as the borrower company.",
        )

    update_payload = {
        "status": "Approved",
        "lender": final_lender_id,
        "updated_at": datetime.now().isoformat(),
    }
    if approval_in:
        if approval_in.interest_rate is not None:
            update_payload["interest_rate"] = float(approval_in.interest_rate)
        if approval_in.due_date is not None:
            update_payload["due_date"] = approval_in.due_date.isoformat()

    updated_row = None
    if client:
        try:
            sb_res = (
                client.table("loan")
                .update(update_payload)
                .eq("loan_id", loan_id)
                .execute()
            )
            if sb_res.data and len(sb_res.data) > 0:
                updated_row = sb_res.data[0]
        except Exception as e:
            print(f"Supabase approve loan error: {e}")

    if sql_loan:
        sql_loan.status = "Approved"
        sql_loan.lender = final_lender_id
        if approval_in and approval_in.interest_rate is not None:
            sql_loan.interest_rate = Decimal(str(approval_in.interest_rate))
        if approval_in and approval_in.due_date is not None:
            sql_loan.due_date = approval_in.due_date
        db.commit()
        db.refresh(sql_loan)

    if not id_to_name and client:
        id_to_name, _ = get_supabase_company_mapping(client)

    if not id_to_name:
        comps = db.query(Company).all()
        id_to_name = {c.company_id: c.company_name for c in comps}

    final_source = updated_row or {
        "loan_id": sql_loan.loan_id,
        "borrower": sql_loan.borrower,
        "lender": sql_loan.lender,
        "loan_ref_no": sql_loan.loan_ref_no,
        "principal_amount": float(sql_loan.principal_amount),
        "interest_rate": float(sql_loan.interest_rate or 0.0),
        "interest_type": sql_loan.interest_type,
        "loan_date": sql_loan.loan_date,
        "due_date": sql_loan.due_date,
        "description": sql_loan.description,
        "status": "Approved",
        "created_at": sql_loan.created_at,
        "updated_at": sql_loan.updated_at,
    }

    b_id = final_source.get("borrower")
    l_id = final_source.get("lender")
    p_amt = Decimal(str(final_source.get("principal_amount") or 0.0))
    system_cache.invalidate_tag("loans")
    system_cache.invalidate_tag("notifications")
    ws_manager.broadcast_sync({"type": "LOANS_UPDATED"})

    return LoanOut(
        loan_id=final_source["loan_id"],
        borrower=b_id,
        lender=l_id,
        borrower_name=id_to_name.get(b_id) or f"Company #{b_id}",
        lender_name=id_to_name.get(l_id) if l_id else "Pending Finance Assignment",
        loan_ref_no=final_source.get("loan_ref_no"),
        principal_amount=p_amt,
        amount=p_amt,
        interest_rate=Decimal(str(final_source.get("interest_rate") or 0.0)),
        interest_type=final_source.get("interest_type") or "simple",
        loan_date=final_source.get("loan_date"),
        due_date=final_source.get("due_date"),
        description=final_source.get("description"),
        particulars=final_source.get("description"),
        status="Approved",
        created_at=final_source.get("created_at") or datetime.now(),
        updated_at=final_source.get("updated_at") or datetime.now(),
    )


@router.delete("/{loan_id}", status_code=status.HTTP_200_OK, summary="Delete loan (Only allowed if Pending Approval)")
def delete_loan(
    loan_id: int,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db)
):
    forbid_audit_edit(current_user)

    client = None
    try:
        client = get_supabase_admin_client()
    except Exception:
        pass

    # Check status
    existing_status = None
    existing_row = None
    if client:
        try:
            res = client.table("loan").select("*").eq("loan_id", loan_id).execute()
            if res.data and len(res.data) > 0:
                existing_row = res.data[0]
                existing_status = existing_row.get("status")
        except Exception:
            pass

    sql_loan = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    if not existing_status and sql_loan:
        existing_status = sql_loan.status

    if not existing_status and not sql_loan:
        raise HTTPException(status_code=404, detail="Loan not found.")

    borrower_id = (existing_row.get("borrower") if existing_row else None) or (sql_loan.borrower if sql_loan else None)
    if borrower_id:
        check_company_access(current_user, borrower_id)

    if existing_status and existing_status.strip().lower() not in {"pending approval", "pending finance endorsement"}:
        raise HTTPException(
            status_code=400,
            detail=f"Approved loans cannot be deleted (current status: {existing_status})."
        )

    deleted_from_supabase = False
    if client:
        try:
            sb_res = client.table("loan").delete().eq("loan_id", loan_id).execute()
            if sb_res.data and len(sb_res.data) > 0:
                deleted_from_supabase = True
        except Exception as e:
            print(f"Supabase delete loan error: {e}")

    if sql_loan:
        db.delete(sql_loan)
        db.commit()

    system_cache.invalidate_tag("loans")
    system_cache.invalidate_tag("notifications")
    ws_manager.broadcast_sync({"type": "LOANS_UPDATED"})
    return {
        "message": "Loan deleted successfully",
        "success": True,
        "loan_id": loan_id,
        "supabase_deleted": deleted_from_supabase,
    }


@router.get("/{loan_id}/statement", response_model=LoanStatementOut, summary="Get full loan statement and amortized balance")
def get_loan_statement(loan_id: int, current_user: AuthenticatedUser = Depends(require_business_reader), db: Session = Depends(get_db)):
    loan = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    role = (current_user.get("role") or "").lower()
    if role not in {"audit", "auditor", "finance"}:
        user_cids = set(current_user.get("company_ids") or [])
        if current_user.get("company_id"):
            user_cids.add(current_user["company_id"])
        if loan.borrower not in user_cids and loan.lender not in user_cids:
            raise HTTPException(status_code=403, detail="You are not authorized to view this loan.")
    service = FinanceService(db)
    statement = service.get_loan_statement(loan_id)
    if not statement:
        raise HTTPException(status_code=404, detail="Loan not found")
    return statement


@router.post("/{loan_id}/repayments", response_model=LoanRepaymentOut, status_code=status.HTTP_201_CREATED, summary="Record a loan repayment")
def create_loan_repayment(
    loan_id: int,
    repayment_in: LoanRepaymentCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db)
):
    loan = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    check_company_access(current_user, loan.borrower)

    service = FinanceService(db)
    statement = service.get_loan_statement(loan_id)
    if not statement:
        raise HTTPException(status_code=404, detail="Loan statement error")

    if repayment_in.amount > statement.current_remaining_balance:
        raise HTTPException(
            status_code=400,
            detail=f"Repayment amount ({repayment_in.amount}) exceeds remaining balance ({statement.current_remaining_balance})",
        )

    new_remaining = statement.current_remaining_balance - repayment_in.amount

    repayment_data = repayment_in.model_dump()
    repayment_data["loan_id"] = loan_id
    repayment_data["remaining_balance"] = new_remaining

    repayment = LoanRepayment(**repayment_data)
    db.add(repayment)
    db.commit()
    db.refresh(repayment)

    log_transaction(
        db, AuditAction.LOAN_UPDATED,
        user_id=None, company_id=loan.borrower,
        ip_address=request.client.host if request.client else "unknown",
        record_id=loan_id, record_type="loan_repayment",
        extra={"repayment_id": repayment.loan_repayment_id, "amount": float(repayment.amount), "remaining_balance": float(new_remaining)},
    )
    system_cache.invalidate_tag("loans")
    system_cache.invalidate_tag("notifications")
    ws_manager.broadcast_sync({"type": "LOANS_UPDATED"})
    return repayment
