from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from typing import List, Optional
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import or_, func

from app.db.session import get_db
from app.core.company_resolver import get_company_name_map
from app.db.supabase import get_supabase_admin_client
from app.models.loan import Loan, LoanRepayment
from app.models.bank import BankAccount, BankTransaction
from app.models.finance import Expense, Category
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
from app.core.pagination import PaginationParams
from app.core.cache import system_cache
from app.core.websocket import ws_manager
from app.services.finance_service import FinanceService, FinanceCalculator, hydrate_repayment_payment_methods
from app.services.audit_service import AuditAction, log_transaction
from app.core.post_save import rest_and_orm_share_database

router = APIRouter()

_has_backfilled_repayments = False

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
    query = query.filter(func.lower(Loan.status).in_(DISBURSED_LOAN_STATUSES))
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


def _loan_total_payable(loan: Loan) -> Decimal:
    principal = Decimal(str(loan.principal_amount or 0))
    rate = Decimal(str(loan.interest_rate or 0))
    return FinanceCalculator.calculate_loan_total_payable(
        principal, FinanceCalculator.calculate_loan_interest(principal, rate)
    )


def _company_loan_item(loan: Loan, company_names: dict[int, str], db: Session) -> CompanyLoanOut:
    principal = Decimal(str(loan.principal_amount or 0))
    total_payable = _loan_total_payable(loan)
    total_paid = Decimal(str(
        db.query(func.coalesce(func.sum(LoanRepayment.amount), 0))
        .filter(
            LoanRepayment.loan_id == loan.loan_id,
            or_(LoanRepayment.status.is_(None), func.lower(LoanRepayment.status) != "pending"),
        )
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
    is_privileged = role in ("audit", "auditor")
    user_company_ids = current_user.get("company_ids") or []
    if not is_privileged and not user_company_ids and current_user.get("company_id"):
        user_company_ids = [current_user["company_id"]]

    if company_id:
        check_company_access(current_user, company_id)
    if borrower_id:
        check_company_access(current_user, borrower_id)
    if lender_id:
        check_company_access(current_user, lender_id)

    company_names = get_company_name_map(db)
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
    is_privileged = role in ("audit", "auditor")
    user_company_ids = current_user.get("company_ids") or []
    if not is_privileged and not user_company_ids and current_user.get("company_id"):
        user_company_ids = [current_user["company_id"]]

    if company_id:
        check_company_access(current_user, company_id)
    if borrower_id:
        check_company_access(current_user, borrower_id)
    if lender_id:
        check_company_access(current_user, lender_id)

    company_names = get_company_name_map(db)
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


def _attach_borrower_banks(db: Session, loans: List[LoanOut]) -> None:
    """Fill borrower_bank_account_id from the deposit made on disbursement. That deposit carries the loan
    reference as its cheque number, on the borrower's own bank (see _move_loan_funds)."""
    from app.models.bank import BankTransaction

    by_ref = {l.loan_ref_no: l for l in loans if l.loan_ref_no and l.borrower is not None}
    if not by_ref:
        return
    try:
        rows = (
            db.query(BankTransaction.cheque_no, BankTransaction.bank_account_id, BankAccount.company_id)
            .join(BankAccount, BankAccount.id == BankTransaction.bank_account_id)
            .filter(BankTransaction.cheque_no.in_(list(by_ref.keys())), BankTransaction.deposit > 0)
            .order_by(BankTransaction.created_at.asc())
            .all()
        )
    except Exception as exc:
        db.rollback()
        print(f"Borrower bank lookup skipped: {exc}")
        return
    for ref, account_id, company_id in rows:
        loan = by_ref.get(ref)
        # The first deposit on one of the borrower's banks is the disbursement
        if loan is not None and loan.borrower_bank_account_id is None and company_id == loan.borrower:
            loan.borrower_bank_account_id = account_id


def cleanup_duplicate_loan_repayment_expenses(db: Session) -> int:
    """Find and remove duplicate loan repayment expense records (keeping only the earliest one)."""
    try:
        from app.models.finance import Expense

        rows = (
            db.query(Expense)
            .filter(Expense.description.ilike("Loan Repayment%"))
            .order_by(Expense.expense_id.asc())
            .all()
        )
        # An expense tied to a LoanRepayment is a real payment of its own: never treat it as a duplicate.
        linked_ids = {eid for (eid,) in db.query(LoanRepayment.expense_id).filter(LoanRepayment.expense_id.isnot(None)).all()}
        seen: set[tuple] = set()
        to_delete: list[Expense] = []
        for r in rows:
            if r.expense_id in linked_ids:
                continue
            cheque_key = (r.cheque_no or r.cheque_number or "").strip().lower()
            desc_key = (r.description or "").strip().lower()
            key = (r.company_id, str(r.amount), str(r.expense_date), cheque_key, desc_key)
            if key in seen:
                to_delete.append(r)
            else:
                seen.add(key)

        if to_delete:
            deleted_count = len(to_delete)
            sb_client = None if rest_and_orm_share_database() else get_supabase_admin_client()
            for dup in to_delete:
                dup_id = dup.expense_id
                db.delete(dup)
                if sb_client:
                    try:
                        sb_client.table("expenses").delete().eq("expense_id", dup_id).execute()
                    except Exception:
                        pass
            db.commit()
            system_cache.invalidate_tag("expenses")
            return deleted_count
    except Exception as exc:
        print(f"Cleanup duplicate loan repayment expenses warning: {exc}")
    return 0


_duplicate_cleanup_done = False


def ensure_repayment_expenses_deduplicated(db: Session) -> None:
    global _duplicate_cleanup_done
    if _duplicate_cleanup_done:
        return
    try:
        cleanup_duplicate_loan_repayment_expenses(db)
        _duplicate_cleanup_done = True
    except Exception as exc:
        print(f"Deduplication check warning: {exc}")


def _attach_loan_repayments(db: Session, items: List[LoanOut]) -> None:
    """Populate total_paid, outstanding_balance, and repayments from LoanRepayment rows."""
    loan_ids = [item.loan_id for item in items if item.loan_id]
    if not loan_ids:
        return
    rows = (
        db.query(LoanRepayment)
        .filter(LoanRepayment.loan_id.in_(loan_ids))
        .order_by(LoanRepayment.payment_date.asc(), LoanRepayment.loan_repayment_id.asc())
        .all()
    )
    hydrate_repayment_payment_methods(db, rows)
    by_loan: dict[int, list[LoanRepayment]] = {}
    for r in rows:
        by_loan.setdefault(r.loan_id, []).append(r)

    for item in items:
        reps = by_loan.get(item.loan_id, [])
        total_paid = sum(
            (Decimal(str(r.amount or 0)) for r in reps if (r.status or "").strip().lower() != "pending"),
            Decimal("0.00"),
        )
        principal = Decimal(str(item.principal_amount or 0))
        interest = FinanceCalculator.calculate_loan_interest(
            principal,
            Decimal(str(item.interest_rate or 0)),
        )
        total_payable = FinanceCalculator.calculate_loan_total_payable(principal, interest)
        outstanding = FinanceCalculator.calculate_loan_remaining_balance(total_payable, total_paid)
        item.total_paid = total_paid
        item.outstanding_balance = outstanding
        item.repayments = [LoanRepaymentOut.model_validate(r) for r in reps]


@router.get("", response_model=List[LoanOut], summary="List loans from Supabase / DB")
def get_loans(
    response: Response,
    borrower_id: Optional[int] = Query(None, description="Filter by Borrower Company ID"),
    lender_id: Optional[int] = Query(None, description="Filter by Lender Company ID"),
    company_name: Optional[str] = Query(None, description="Filter by Company Name (matches borrower or lender)"),
    scope: Optional[str] = Query(None, description="'borrower' or 'lender' tab scope"),
    status: Optional[str] = Query(None, description="Filter by Loan Status"),
    start_date: Optional[date] = Query(None, description="Filter from loan date"),
    end_date: Optional[date] = Query(None, description="Filter to loan date"),
    search: Optional[str] = Query(None, description="Search ref no or description"),
    user_role: Optional[str] = Query(None, description="Current user role"),
    pagination: PaginationParams = Depends(),
    request: Request = None,
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    role = (current_user.get("role") or "").strip().lower()
    is_auditor = role in {"audit", "auditor"}

    is_privileged = role in ("admin", "audit", "auditor", "owner") or bool(current_user.get("is_admin"))
    user_company_ids = current_user.get("company_ids") or []
    if not is_privileged and not user_company_ids and current_user.get("company_id"):
        user_company_ids = [current_user["company_id"]]
    if hasattr(borrower_id, "default"):
        borrower_id = None
    if hasattr(lender_id, "default"):
        lender_id = None
    if hasattr(company_name, "default"):
        company_name = None
    if hasattr(scope, "default"):
        scope = None
    if hasattr(status, "default"):
        status = None
    if hasattr(start_date, "default") or not isinstance(start_date, (date, datetime)):
        start_date = None
    if hasattr(end_date, "default") or not isinstance(end_date, (date, datetime)):
        end_date = None
    if hasattr(search, "default"):
        search = None

    scope_cids = "all" if is_privileged else ",".join(str(c) for c in sorted(user_company_ids))
    cache_key = f"loans_{borrower_id}_{lender_id}_{company_name}_{scope}_{status}_{start_date}_{end_date}_{search}_{role}_{scope_cids}_{pagination.limit}_{pagination.offset}"
    cached = system_cache.get(cache_key)
    if cached is not None:
        if isinstance(cached, dict) and "items" in cached:
            response.headers["X-Total-Count"] = str(cached.get("total", len(cached["items"])))
            response.headers["X-Page-Limit"] = str(pagination.limit)
            response.headers["X-Page-Offset"] = str(pagination.offset)
            return cached["items"]
        response.headers["X-Total-Count"] = str(len(cached))
        response.headers["X-Page-Limit"] = str(pagination.limit)
        response.headers["X-Page-Offset"] = str(pagination.offset)
        return cached

    if borrower_id:
        check_company_access(current_user, borrower_id)
    if lender_id:
        check_company_access(current_user, lender_id)

    ensure_repayment_expenses_deduplicated(db)

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
            response.headers["X-Total-Count"] = "0"
            response.headers["X-Page-Limit"] = str(pagination.limit)
            response.headers["X-Page-Offset"] = str(pagination.offset)
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

    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(or_(Loan.loan_ref_no.ilike(term), Loan.description.ilike(term)))

    total_count = query.count()
    response.headers["X-Total-Count"] = str(total_count)
    response.headers["X-Page-Limit"] = str(pagination.limit)
    response.headers["X-Page-Offset"] = str(pagination.offset)

    loans = query.order_by(Loan.loan_date.desc(), Loan.loan_id.desc()).offset(pagination.offset).limit(pagination.limit).all()

    comp_map = dict(db.query(Company.company_id, Company.company_name).all())

    result = [
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
            audit_status=getattr(l, "audit_status", None) or "Pending Audit",
            audited_by=getattr(l, "audited_by", None),
            audited_at=getattr(l, "audited_at", None),
            audit_remarks=getattr(l, "audit_remarks", None),
            disbursed_by=getattr(l, "disbursed_by", None),
            disbursed_at=getattr(l, "disbursed_at", None),
            bank_account_id=getattr(l, "bank_account_id", None),
            borrower_bank_account_id=getattr(l, "borrower_bank_account_id", None),
            created_at=l.created_at,
            updated_at=l.updated_at,
        )
        for l in loans
    ]
    _attach_borrower_banks(db, result)
    _attach_loan_repayments(db, result)
    system_cache.set(cache_key, {"items": result, "total": total_count}, ttl=45, tags=["loans"])
    return result


@router.get("/export", response_model=List[LoanOut], summary="Export all matching loans")
def export_loans(
    borrower_id: Optional[int] = Query(None),
    lender_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    scope: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    search: Optional[str] = Query(None),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    dummy_resp = Response()
    return get_loans(
        response=dummy_resp,
        borrower_id=borrower_id,
        lender_id=lender_id,
        company_name=company_name,
        scope=scope,
        status=status,
        start_date=start_date,
        end_date=end_date,
        search=search,
        pagination=PaginationParams(limit=100, offset=0),
        current_user=current_user,
        db=db,
    ) if False else _export_loans_unbounded(
        db=db,
        current_user=current_user,
        borrower_id=borrower_id,
        lender_id=lender_id,
        company_name=company_name,
        scope=scope,
        status=status,
        start_date=start_date,
        end_date=end_date,
        search=search,
    )


def _export_loans_unbounded(
    db: Session,
    current_user: AuthenticatedUser,
    borrower_id: Optional[int] = None,
    lender_id: Optional[int] = None,
    company_name: Optional[str] = None,
    scope: Optional[str] = None,
    status: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    search: Optional[str] = None,
) -> List[LoanOut]:
    role = (current_user.get("role") or "").strip().lower()
    is_auditor = role in {"audit", "auditor"}
    is_privileged = role in ("admin", "audit", "auditor", "owner") or bool(current_user.get("is_admin"))
    user_company_ids = current_user.get("company_ids") or []
    if not is_privileged and not user_company_ids and current_user.get("company_id"):
        user_company_ids = [current_user["company_id"]]
    if borrower_id:
        check_company_access(current_user, borrower_id)
    if lender_id:
        check_company_access(current_user, lender_id)
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
    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(or_(Loan.loan_ref_no.ilike(term), Loan.description.ilike(term)))
    loans = query.order_by(Loan.loan_date.desc(), Loan.loan_id.desc()).all()
    comp_map = dict(db.query(Company.company_id, Company.company_name).all())
    result = [
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
            audit_status=getattr(l, "audit_status", None) or "Pending Audit",
            audited_by=getattr(l, "audited_by", None),
            audited_at=getattr(l, "audited_at", None),
            audit_remarks=getattr(l, "audit_remarks", None),
            disbursed_by=getattr(l, "disbursed_by", None),
            disbursed_at=getattr(l, "disbursed_at", None),
            bank_account_id=getattr(l, "bank_account_id", None),
            borrower_bank_account_id=getattr(l, "borrower_bank_account_id", None),
            created_at=l.created_at,
            updated_at=l.updated_at,
        )
        for l in loans
    ]
    _attach_borrower_banks(db, result)
    _attach_loan_repayments(db, result)
    return result


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

    b_name = id_to_name.get(borrower_id) or loan_in.borrower_company or f"Company #{borrower_id}"
    borrower_bank_id = (loan_in.borrower_bank_account_id or "").strip() or None
    if borrower_bank_id:
        borrower_acc = db.query(BankAccount).filter(BankAccount.id == borrower_bank_id).first()
        if not borrower_acc:
            raise HTTPException(status_code=400, detail="Selected receiving bank account was not found.")
        owns_via_id = borrower_acc.company_id is not None and int(borrower_acc.company_id) == int(borrower_id)
        owns_via_name = any(
            o.strip().lower() == b_name.strip().lower()
            or o.strip().lower() in b_name.strip().lower()
            or b_name.strip().lower() in o.strip().lower()
            for o in (borrower_acc.company_names or [])
        )
        if not owns_via_id and not owns_via_name:
            raise HTTPException(
                status_code=400,
                detail="Selected receiving bank account does not belong to the borrower company.",
            )

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
        "borrower_bank_account_id": borrower_bank_id,
        "principal_amount": float(loan_in.principal_amount),
        "interest_rate": float(loan_in.interest_rate or 0.0),
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
            borrower_bank_account_id=borrower_bank_id,
            principal_amount=loan_in.principal_amount,
            interest_rate=loan_in.interest_rate or Decimal("0.00"),
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
        loan_date=loan_in.loan_date,
        due_date=loan_in.due_date,
        description=desc,
        particulars=desc,
        borrower_bank_account_id=borrower_bank_id,
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

    endorser_name = (
        current_user.get("full_name")
        or current_user.get("name")
        or current_user.get("email")
        or request.headers.get("X-User-Name")
        or "Finance Officer"
    )
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
        borrower_bank_account_id=final_source.get("borrower_bank_account_id") or (sql_loan.borrower_bank_account_id if sql_loan else None),
        created_at=final_source.get("created_at") or datetime.now(),
        updated_at=now_ts,
    )


# Loans whose money has been released to the borrower (spec 0046). "Approved" alone means Audit approved
# and the loan is waiting for Finance to disburse it, so no money has moved yet.
DISBURSED_LOAN_STATUSES = ["disbursed", "paid", "partially paid", "overdue"]


def _move_loan_funds(db: Session, *, loan_id: int, sql_loan, final_source: dict, borrower_id, lender_id,
                     id_to_name: dict, p_amt: Decimal) -> None:
    """Take the principal from the funding (lender) bank and deposit it to the borrower's bank."""
    loan_ref = final_source.get("loan_ref_no") or (sql_loan.loan_ref_no if sql_loan else str(loan_id))
    funding_bank_id = (sql_loan.bank_account_id if sql_loan else None) or final_source.get("bank_account_id")

    bank_svc = BankService(db)
    funding_acc = None
    if funding_bank_id:
        funding_acc = db.query(BankAccount).filter(BankAccount.id == funding_bank_id).first()
    if not funding_acc and lender_id:
        funding_acc = bank_svc.find_account_for_company(id_to_name.get(lender_id) or "")
    if not funding_acc:
        raise HTTPException(status_code=400, detail="No funding bank account is set on this loan. Finance must choose one before disbursing.")
    available = Decimal(str(funding_acc.current_balance or 0))
    if p_amt > available:
        raise HTTPException(
            status_code=400,
            detail=f"Loan amount (₱{p_amt:,.2f}) is more than the balance of {funding_acc.bank_name} (₱{available:,.2f}).",
        )

    b_name_disp = id_to_name.get(borrower_id) or f"Company #{borrower_id}"
    l_name_disp = id_to_name.get(lender_id) or "Corporate Treasury"

    supervisor_particular = (
        str(final_source.get("particulars") or final_source.get("description") or (sql_loan.description if sql_loan else "") or "").strip()
    )
    if supervisor_particular.lower().startswith("loan:"):
        clean_particular = supervisor_particular[5:].strip()
    elif supervisor_particular:
        clean_particular = supervisor_particular
    else:
        clean_particular = "Disbursement"

    try:
        bank_svc.withdraw(funding_acc.id, BankDepositWithdrawRequest(
            amount=p_amt,
            date=datetime.now().strftime("%m/%d/%y"),
            particulars=f"Loan: {clean_particular} (to {b_name_disp})",
            category="Bank Transfer",
            reference_no=loan_ref,
        ), source_loan_id=loan_id)
        ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"account_id": funding_acc.id}})
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Loan disbursement bank deduction error: {exc}")
        raise HTTPException(status_code=400, detail="Bank deduction failed. Please try again.")

    borrower_bank_id = (
        (sql_loan.borrower_bank_account_id if sql_loan else None)
        or final_source.get("borrower_bank_account_id")
    )
    borrower_acc = None
    if borrower_bank_id:
        borrower_acc = db.query(BankAccount).filter(BankAccount.id == borrower_bank_id).first()
    if not borrower_acc:
        borrower_acc = bank_svc.find_account_for_company(b_name_disp)
    if not borrower_acc and borrower_id:
        borrower_acc = (
            db.query(BankAccount)
            .filter(BankAccount.company_id == borrower_id)
            .order_by(BankAccount.id.asc())
            .first()
        )
    if borrower_acc:
        try:
            bank_svc.deposit(borrower_acc.id, BankDepositWithdrawRequest(
                amount=p_amt,
                date=datetime.now().strftime("%m/%d/%y"),
                particulars=f"Loan: {clean_particular} (from {l_name_disp})",
                category="Bank Transfer",
                reference_no=loan_ref,
            ), source_loan_id=loan_id)
            ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"account_id": borrower_acc.id}})
        except Exception as exc:
            print(f"Loan disbursement borrower bank deposit error: {exc}")


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

    reviewer_name = (
        current_user.get("full_name")
        or current_user.get("name")
        or current_user.get("email")
        or request.headers.get("X-User-Name")
        or "Internal Auditor"
    )
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

    # Audit approval no longer moves money: the loan waits for Finance to disburse it (spec 0046)

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
        borrower_bank_account_id=final_source.get("borrower_bank_account_id") or (sql_loan.borrower_bank_account_id if sql_loan else None),
        created_at=final_source.get("created_at") or datetime.now(),
        updated_at=now_ts,
    )


@router.post("/{loan_id}/disburse", response_model=LoanOut, summary="Finance releases the money of an Audit-approved loan")
def disburse_loan(
    loan_id: int,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_finance_user),
    db: Session = Depends(get_db)
):
    client = None
    id_to_name = {}
    try:
        client = get_supabase_admin_client()
        id_to_name, _ = get_supabase_company_mapping(client, db)
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

    source = existing_row or {}
    current_status = (source.get("status") or (sql_loan.status if sql_loan else "") or "").strip()
    if current_status.lower() != "approved":
        raise HTTPException(
            status_code=409,
            detail=f"Only loans approved by Audit can be disbursed. This loan is '{current_status or 'unknown'}'.",
        )

    borrower_id = source.get("borrower") or (sql_loan.borrower if sql_loan else None)
    lender_id = source.get("lender") or (sql_loan.lender if sql_loan else None)

    if not id_to_name:
        id_to_name = get_company_name_map(db)

    p_amt = Decimal(str(source.get("principal_amount") or (sql_loan.principal_amount if sql_loan else 0) or 0))
    if p_amt > Decimal("0.00"):
        _move_loan_funds(
            db, loan_id=loan_id, sql_loan=sql_loan, final_source=source, borrower_id=borrower_id,
            lender_id=lender_id, id_to_name=id_to_name, p_amt=p_amt,
        )

    disburser = (
        current_user.get("full_name") or current_user.get("name") or current_user.get("email")
        or request.headers.get("X-User-Name") or "Finance"
    )
    now_ts = datetime.now()
    update_payload = {
        "status": "Disbursed",
        "disbursed_by": disburser,
        "disbursed_at": now_ts.isoformat(),
        "updated_at": now_ts.isoformat(),
    }
    updated_row = None
    if client:
        try:
            sb_res = client.table("loan").update(update_payload).eq("loan_id", loan_id).execute()
            if sb_res.data and len(sb_res.data) > 0:
                updated_row = sb_res.data[0]
        except Exception as e:
            print(f"Supabase loan disburse error: {e}")
    if sql_loan:
        sql_loan.status = "Disbursed"
        sql_loan.disbursed_by = disburser
        sql_loan.disbursed_at = now_ts
        db.commit()
        db.refresh(sql_loan)

    try:
        log_transaction(
            db, AuditAction.LOAN_UPDATED,
            user_id=current_user.get("user_id"), company_id=borrower_id,
            ip_address=request.client.host if request.client else "unknown",
            record_id=loan_id, record_type="loan_disbursement",
            extra={"status": "Disbursed", "amount": str(p_amt)},
        )
    except Exception:
        pass

    system_cache.invalidate_tag("loans")
    system_cache.invalidate_tag("notifications")
    ws_manager.broadcast_sync({"type": "LOANS_UPDATED"})

    final = updated_row or source

    def pick(key):
        if final.get(key) is not None:
            return final.get(key)
        return getattr(sql_loan, key, None) if sql_loan else None

    return LoanOut(
        loan_id=loan_id,
        borrower=borrower_id,
        lender=lender_id,
        borrower_name=id_to_name.get(borrower_id) or f"Company #{borrower_id}",
        lender_name=id_to_name.get(lender_id) if lender_id else "Pending Finance Assignment",
        loan_ref_no=pick("loan_ref_no"),
        principal_amount=p_amt,
        amount=p_amt,
        interest_rate=Decimal(str(pick("interest_rate") or 0)),
        loan_date=pick("loan_date"),
        due_date=pick("due_date"),
        description=pick("description"),
        particulars=pick("description"),
        status="Disbursed",
        endorsed_by=pick("endorsed_by"),
        endorsed_at=pick("endorsed_at"),
        finance_remark=pick("finance_remark"),
        audit_reviewed_by=pick("audit_reviewed_by"),
        audit_reviewed_at=pick("audit_reviewed_at"),
        audit_remark=pick("audit_remark"),
        disbursed_by=disburser,
        disbursed_at=now_ts,
        bank_account_id=pick("bank_account_id"),
        borrower_bank_account_id=pick("borrower_bank_account_id"),
        created_at=pick("created_at") or now_ts,
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

    if (loan.status or "").strip().lower() not in DISBURSED_LOAN_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="Payments can only be recorded after Finance has disbursed the loan.",
        )

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

    repayment_data = repayment_in.model_dump(exclude={"bank_account_id", "payment_method"})
    repayment_data["loan_id"] = loan_id
    repayment_data["remaining_balance"] = new_remaining
    chosen_payment_method = repayment_in.payment_method or "Cash"
    chosen_borrower_bank_id = repayment_in.bank_account_id

    repayment = LoanRepayment(**repayment_data)
    repayment.payment_method = chosen_payment_method
    db.add(repayment)
    db.flush()

    # Update loan status in SQLAlchemy (and Supabase if configured)
    is_past_due = bool(
        (loan.due_date and loan.due_date < date.today())
        or (loan.status or "").strip().lower() == "overdue"
    )
    if new_remaining <= Decimal("0.00"):
        new_loan_status = "Paid"
    elif is_past_due:
        new_loan_status = "Overdue"
    else:
        new_loan_status = "Partially Paid"
    loan.status = new_loan_status

    comp_map = dict(db.query(Company.company_id, Company.company_name).all())
    b_name = comp_map.get(loan.borrower) or f"Company #{loan.borrower}"
    l_name = comp_map.get(loan.lender) if loan.lender else "Lender"
    loan_ref = loan.loan_ref_no or f"LN-{loan_id}"
    raw_desc = (loan.description or "").strip()
    clean_particular = raw_desc[5:].strip() if raw_desc.lower().startswith("loan:") else (raw_desc or "Loan Facility")
    pay_date_str = repayment_in.payment_date.strftime("%m/%d/%y")

    bank_svc = BankService(db)
    is_petty = "petty cash" in chosen_payment_method.strip().lower()
    # 1. Resolve Borrower & Lender bank accounts
    borrower_acc = None
    if not is_petty:
        if chosen_borrower_bank_id:
            from app.services.income_bank_links import validate_company_bank
            validate_company_bank(db, loan.borrower, chosen_borrower_bank_id)
            borrower_acc = db.query(BankAccount).filter(BankAccount.id == chosen_borrower_bank_id).first()
        if not borrower_acc:
            borrower_acc = db.query(BankAccount).filter(BankAccount.company_id == loan.borrower).first()
        if not borrower_acc:
            borrower_acc = bank_svc.find_account_for_company(b_name)
    repayment.bank_account_id = borrower_acc.id if borrower_acc else None

    lender_acc = None
    if getattr(loan, "bank_account_id", None):
        lender_acc = db.query(BankAccount).filter(BankAccount.id == loan.bank_account_id).first()
    if not lender_acc and loan.lender:
        lender_acc = db.query(BankAccount).filter(BankAccount.company_id == loan.lender).first()
    if not lender_acc and loan.lender:
        lender_acc = bank_svc.find_account_for_company(l_name)

    # 2. Record Expense for Borrower company first so its expense_id links to LoanRepayment & BankTransaction
    loan_cat = db.query(Category).filter(Category.name.ilike("Loan Repayment")).first()
    if not loan_cat:
        loan_cat = db.query(Category).filter(Category.name.ilike("Loan%")).first()
    if not loan_cat:
        loan_cat = Category(name="Loan Repayment", description="Inter-company loan repayment")
        db.add(loan_cat)
        db.flush()

    target_cheque = repayment_in.reference_no or loan_ref
    target_desc = f"Loan Repayment: {clean_particular} (to {l_name})"

    # Reuse an unlinked identical expense only; one already tied to another repayment belongs to that payment
    # (two same day partial payments of the same amount are two payments, not one).
    linked_expense_ids = db.query(LoanRepayment.expense_id).filter(LoanRepayment.expense_id.isnot(None))
    existing_exp = db.query(Expense).filter(
        Expense.company_id == loan.borrower,
        Expense.amount == repayment_in.amount,
        Expense.expense_date == repayment_in.payment_date,
        or_(
            Expense.cheque_no == target_cheque,
            Expense.cheque_number == target_cheque,
        ),
        Expense.description == target_desc,
        ~Expense.expense_id.in_(linked_expense_ids),
    ).first()

    expense_id = None
    if not existing_exp:
        expense_rec = Expense(
            company_id=loan.borrower,
            category_id=loan_cat.category_id,
            payment_method=chosen_payment_method,
            created_by=current_user.get("user_id"),
            expense_date=repayment_in.payment_date,
            cheque_no=target_cheque,
            amount=repayment_in.amount,
            amount_paid=repayment_in.amount,
            description=target_desc,
            remarks=repayment_in.notes,
            bank_account_id=borrower_acc.id if borrower_acc else None,
            audit_status="Pending Audit",
        )
        db.add(expense_rec)
        db.flush()
        expense_id = expense_rec.expense_id
    else:
        expense_id = existing_exp.expense_id

    repayment.expense_id = expense_id
    db.flush()

    # 3. Deduct from Borrower's bank account via linked Expense entry (same transaction)
    if borrower_acc and expense_id:
        from app.api.v1.endpoints.expenses import reconcile_expense_bank
        reconcile_expense_bank(db, expense_id=expense_id, commit=False)
        for borrower_tx in db.query(BankTransaction).filter(BankTransaction.source_expense_id == expense_id).all():
            borrower_tx.source_loan_repayment_id = repayment.loan_repayment_id
            borrower_tx.category = "Loan Repayment"

    # 4. Credit Lender's funding bank account and tag with source_loan_repayment_id (same transaction)
    if lender_acc:
        # deposit() returns (account, transaction)
        bank_svc.deposit(
            lender_acc.id,
            BankDepositWithdrawRequest(
                amount=repayment_in.amount,
                date=pay_date_str,
                particulars=f"Loan Repayment: {clean_particular} (from {b_name})",
                category="Loan Repayment",
                reference_no=repayment_in.reference_no or loan_ref,
            ),
            source_loan_repayment_id=repayment.loan_repayment_id,
            commit=False,
        )

    db.commit()
    db.refresh(repayment)
    repayment.payment_method = chosen_payment_method
    if borrower_acc:
        ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"account_id": borrower_acc.id}})
    if lender_acc:
        ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"account_id": lender_acc.id}})

    try:
        sb_client = None if rest_and_orm_share_database() else get_supabase_admin_client()
        if sb_client:
            sb_client.table("loan").update({"status": new_loan_status}).eq("loan_id", loan_id).execute()
            # Only perform Supabase REST insert if ORM and REST do NOT share the same database
            if not existing_exp:
                try:
                    sb_client.table("expenses").insert({
                        "company_id": loan.borrower,
                        "category_id": loan_cat.category_id,
                        "payment_method": chosen_payment_method,
                        "created_by": current_user.get("user_id"),
                        "expense_date": repayment_in.payment_date.isoformat(),
                        "cheque_number": target_cheque,
                        "amount": float(repayment_in.amount),
                        "amount_paid": float(repayment_in.amount),
                        "description": target_desc,
                        "remarks": repayment_in.notes,
                        "bank_account_id": borrower_acc.id if borrower_acc else None,
                        "audit_status": "Pending Audit",
                    }).execute()
                except Exception as sb_exp_err:
                    print(f"Supabase expense insert on loan repayment warning: {sb_exp_err}")
    except Exception as exc:
        print(f"Supabase loan status update on repayment failed: {exc}")

    cleanup_duplicate_loan_repayment_expenses(db)

    log_transaction(
        db, AuditAction.LOAN_UPDATED,
        user_id=None, company_id=loan.borrower,
        ip_address=request.client.host if request.client else "unknown",
        record_id=loan_id, record_type="loan_repayment",
        extra={
            "repayment_id": repayment.loan_repayment_id,
            "amount": float(repayment.amount),
            "remaining_balance": float(new_remaining),
            "borrower_bank_id": borrower_acc.id if borrower_acc else None,
            "lender_bank_id": lender_acc.id if lender_acc else None,
            "expense_id": expense_id,
        },
    )
    system_cache.invalidate_tag("loans")
    system_cache.invalidate_tag("bank_accounts")
    system_cache.invalidate_tag("expenses")
    system_cache.invalidate_tag("notifications")
    ws_manager.broadcast_sync({"type": "LOANS_UPDATED"})
    ws_manager.broadcast_sync({"type": "EXPENSE_CREATED"})
    return repayment


def recompute_loan_repayments_and_status(db: Session, loan_id: int) -> Optional[str]:
    """Recalculate remaining_balance on every repayment for a loan and update Loan.status."""
    loan = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    if not loan:
        return None
    total_payable = _loan_total_payable(loan)

    repayments = (
        db.query(LoanRepayment)
        .filter(LoanRepayment.loan_id == loan_id)
        .order_by(LoanRepayment.payment_date.asc(), LoanRepayment.loan_repayment_id.asc())
        .all()
    )
    total_paid = Decimal("0.00")
    for rep in repayments:
        if (rep.status or "").strip().lower() != "pending":
            total_paid += Decimal(str(rep.amount or 0))
        rep.remaining_balance = max(Decimal("0.00"), total_payable - total_paid)

    remaining = max(Decimal("0.00"), total_payable - total_paid)
    is_past_due = bool(
        (loan.due_date and loan.due_date < date.today())
        or (loan.status or "").strip().lower() == "overdue"
    )
    if remaining <= Decimal("0.00"):
        new_status = "Paid"
    elif is_past_due:
        new_status = "Overdue"
    elif total_paid <= Decimal("0.00"):
        new_status = "Disbursed"
    else:
        new_status = "Partially Paid"
    loan.status = new_status
    db.flush()
    return new_status


def sync_remote_loan_status(db: Session, loan_id: int) -> None:
    """Push Loan.status via Supabase REST only after local commit and only when REST and ORM do not share Postgres."""
    if rest_and_orm_share_database():
        return
    loan = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    if not loan:
        return
    try:
        sb_client = get_supabase_admin_client()
        if sb_client:
            sb_client.table("loan").update({"status": loan.status}).eq("loan_id", loan_id).execute()
    except Exception:
        pass


def _find_repayment_for_expense(db: Session, expense: Optional[Expense]) -> Optional[LoanRepayment]:
    if not expense:
        return None
    rep = db.query(LoanRepayment).filter(LoanRepayment.expense_id == expense.expense_id).first()
    if rep:
        return rep
    desc = (expense.description or "").strip()
    if desc.lower().startswith("loan repayment:"):
        candidates = (
            db.query(LoanRepayment, Loan)
            .join(Loan, Loan.loan_id == LoanRepayment.loan_id)
            .filter(
                LoanRepayment.expense_id.is_(None),
                Loan.borrower == expense.company_id,
                LoanRepayment.payment_date == expense.expense_date,
                LoanRepayment.amount == expense.amount,
            )
            .order_by(LoanRepayment.loan_repayment_id.asc())
            .all()
        )
        if not candidates:
            return None
        lender_ids = {ln.lender for _, ln in candidates if ln.lender}
        comp_map = (
            dict(db.query(Company.company_id, Company.company_name).filter(Company.company_id.in_(lender_ids)).all())
            if lender_ids
            else {}
        )
        desc_lower = desc.lower()
        for cand_rep, cand_loan in candidates:
            l_name = comp_map.get(cand_loan.lender) if cand_loan.lender else None
            if l_name and f"(to {l_name.lower()})" in desc_lower:
                return cand_rep
        if "(to " not in desc_lower:
            return candidates[0][0]
        for cand_rep, cand_loan in candidates:
            if not cand_loan.lender and ("(to lender)" in desc_lower or "(to external lender)" in desc_lower):
                return cand_rep
        if len(candidates) == 1:
            only_rep, only_loan = candidates[0]
            l_name = comp_map.get(only_loan.lender) if only_loan.lender else None
            if not l_name:
                return only_rep
    return None


def _find_legacy_lender_deposit(
    db: Session,
    repayment: LoanRepayment,
    *,
    match_date: Optional[date] = None,
    match_amount: Optional[Decimal] = None,
    claimed_tx_ids: Optional[set] = None,
    loans_by_id: Optional[dict] = None,
    comp_map: Optional[dict] = None,
    lender_accounts_by_company: Optional[dict] = None,
) -> Optional[BankTransaction]:
    loan = loans_by_id.get(repayment.loan_id) if loans_by_id is not None else db.query(Loan).filter(Loan.loan_id == repayment.loan_id).first()
    legacy_q = db.query(BankTransaction).filter(
        BankTransaction.source_loan_repayment_id.is_(None),
        BankTransaction.source_expense_id.is_(None),
        BankTransaction.source_sale_id.is_(None),
        BankTransaction.category == "Loan Repayment",
        BankTransaction.deposit > 0,
        BankTransaction.particulars.ilike("Loan Repayment:%(from %"),
    )
    if claimed_tx_ids:
        legacy_q = legacy_q.filter(~BankTransaction.id.in_(claimed_tx_ids))
    if loan is not None:
        if getattr(loan, "bank_account_id", None):
            legacy_q = legacy_q.filter(BankTransaction.bank_account_id == loan.bank_account_id)
        elif loan.lender:
            if lender_accounts_by_company is not None:
                lender_acc_ids = lender_accounts_by_company.get(loan.lender, [])
            else:
                lender_acc_ids = [
                    aid for (aid,) in db.query(BankAccount.id).filter(BankAccount.company_id == loan.lender).all()
                ]
            if lender_acc_ids:
                legacy_q = legacy_q.filter(BankTransaction.bank_account_id.in_(lender_acc_ids))
        b_name = (
            comp_map.get(loan.borrower)
            if comp_map is not None
            else (db.query(Company.company_name).filter(Company.company_id == loan.borrower).scalar() if loan.borrower else None)
        )
        if b_name:
            legacy_q = legacy_q.filter(BankTransaction.particulars.ilike(f"Loan Repayment:%(from {b_name})%"))
    target_date = match_date or repayment.payment_date
    if target_date is not None:
        legacy_q = legacy_q.filter(BankTransaction.transaction_date == target_date.strftime("%m/%d/%y"))
    target_amount = match_amount if match_amount is not None else repayment.amount
    if target_amount is not None:
        legacy_q = legacy_q.filter(BankTransaction.deposit == target_amount)
    return legacy_q.order_by(BankTransaction.created_at.asc()).first()


def _assert_lender_bank_unlocked(
    db: Session,
    repayment_id: int,
    *,
    repayment: Optional[LoanRepayment] = None,
    legacy_pay_date: Optional[date] = None,
    legacy_amount: Optional[Decimal] = None,
) -> None:
    linked_rows = (
        db.query(BankTransaction)
        .filter(
            BankTransaction.source_loan_repayment_id == repayment_id,
            BankTransaction.deposit > 0,
        )
        .all()
    )
    if not linked_rows:
        rep = repayment or db.query(LoanRepayment).filter(LoanRepayment.loan_repayment_id == repayment_id).first()
        if rep is not None:
            legacy = _find_legacy_lender_deposit(
                db,
                rep,
                match_date=legacy_pay_date or rep.payment_date,
                match_amount=legacy_amount if legacy_amount is not None else rep.amount,
            )
            if legacy is not None:
                linked_rows = [legacy]
    if any((t.audit_status or "").strip().lower() == "verified" for t in linked_rows):
        raise HTTPException(
            status_code=409,
            detail="The lender's bank deposit for this loan repayment has been Verified by an Auditor and cannot be modified.",
        )


def _sync_lender_bank_for_repayment(
    db: Session,
    repayment: LoanRepayment,
    *,
    amount: Optional[Decimal],
    pay_date: Optional[date] = None,
    reference_no: Optional[str] = None,
    delete: bool = False,
    legacy_pay_date: Optional[date] = None,
    legacy_amount: Optional[Decimal] = None,
) -> None:
    """Update or delete the lender's BankTransaction deposit linked to this LoanRepayment."""
    bank_svc = BankService(db)
    linked = (
        db.query(BankTransaction)
        .filter(
            BankTransaction.source_loan_repayment_id == repayment.loan_repayment_id,
            BankTransaction.deposit > 0,
        )
        .all()
    )
    if not linked:
        legacy = _find_legacy_lender_deposit(
            db,
            repayment,
            match_date=legacy_pay_date or repayment.payment_date,
            match_amount=legacy_amount if legacy_amount is not None else repayment.amount,
        )
        if legacy is not None:
            legacy.source_loan_repayment_id = repayment.loan_repayment_id
            db.flush()
            linked = [legacy]
    for t in linked:
        if (t.audit_status or "").strip().lower() == "verified":
            raise HTTPException(
                status_code=409,
                detail="The lender's bank deposit for this loan repayment has been Verified by an Auditor and cannot be modified.",
            )
    if not linked:
        return
    keep = linked[0]
    loan = db.query(Loan).filter(Loan.loan_id == repayment.loan_id).first()
    lender_company_name = None
    particulars = keep.particulars
    if loan is not None:
        if loan.lender:
            lender_company_name = db.query(Company.company_name).filter(Company.company_id == loan.lender).scalar()
        b_name = (
            db.query(Company.company_name).filter(Company.company_id == loan.borrower).scalar()
            if loan.borrower
            else None
        ) or f"Company #{loan.borrower}"
        raw_desc = (loan.description or "").strip()
        clean_particular = raw_desc[5:].strip() if raw_desc.lower().startswith("loan:") else (raw_desc or "Loan Facility")
        particulars = f"Loan Repayment: {clean_particular} (from {b_name})"

    target_amt = Decimal("0.00") if (delete or amount is None or amount <= Decimal("0.00")) else Decimal(str(amount))
    bank_svc.patch_linked_entry(
        link_attr="source_loan_repayment_id",
        link_id=repayment.loan_repayment_id,
        credit=True,
        amount=target_amt,
        account_id=keep.bank_account_id,
        particulars=particulars,
        reference_no=reference_no,
        tx_date=pay_date.strftime("%m/%d/%y") if pay_date is not None else keep.transaction_date,
        company_name=lender_company_name,
        category="Loan Repayment",
        commit=False,
    )


def _assert_repayment_amount_allowed(db: Session, loan: Loan, repayment_id: int, new_amt: Decimal) -> None:
    """The edited payment plus every other payment may not go past what the loan owes (principal + interest)."""
    total_payable = _loan_total_payable(loan)
    other_paid = sum(
        (
            Decimal(str(r.amount or 0))
            for r in db.query(LoanRepayment).filter(
                LoanRepayment.loan_id == loan.loan_id,
                LoanRepayment.loan_repayment_id != repayment_id,
                or_(LoanRepayment.status.is_(None), func.lower(LoanRepayment.status) != "pending"),
            ).all()
        ),
        Decimal("0.00"),
    )
    max_allowed = max(Decimal("0.00"), total_payable - other_paid)
    if new_amt > max_allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Repayment amount ({new_amt}) exceeds remaining loan balance ({max_allowed}).",
        )


def prepare_loan_repayment_edit(db: Session, expense_id: int, new_amount: Optional[Decimal]) -> Optional[int]:
    """Run BEFORE an expense is changed. Finds the loan repayment behind the expense (matching on the values
    it still has now), pins the link to expense_id so later lookups never depend on those values, and rejects
    an amount the loan cannot take or a Verified lender deposit, so a refused edit never leaves anything half saved."""
    expense = db.query(Expense).filter(Expense.expense_id == expense_id).first()
    rep = _find_repayment_for_expense(db, expense)
    if rep is None:
        return None
    _assert_lender_bank_unlocked(db, rep.loan_repayment_id, repayment=rep)
    if rep.expense_id != expense_id:
        rep.expense_id = expense_id
        db.flush()
    if new_amount is not None:
        amt = Decimal(str(new_amount)).quantize(Decimal("0.01"))
        if amt <= Decimal("0.00"):
            raise HTTPException(
                status_code=400,
                detail="A loan repayment expense cannot be marked as Pending or Unpaid. Delete the expense to reverse the loan repayment.",
            )
        loan = db.query(Loan).filter(Loan.loan_id == rep.loan_id).first()
        if loan is not None:
            _assert_repayment_amount_allowed(db, loan, rep.loan_repayment_id, amt)
    return rep.loan_repayment_id


def sync_loan_repayment_from_expense(
    db: Session,
    expense: Expense,
    commit: bool = True,
    old_pay_date: Optional[date] = None,
    paid_amount: Optional[Decimal] = None,
) -> Optional[int]:
    """Cascade an Expense edit to its linked LoanRepayment, Loan status, and lender's bank deposit."""
    from app.services.sales_receivables_sync import compute_paid_amount_from_particulars

    rep = _find_repayment_for_expense(db, expense)
    if not rep:
        return None
    rep.expense_id = expense.expense_id
    loan = db.query(Loan).filter(Loan.loan_id == rep.loan_id).first()
    if not loan:
        return None

    new_amt = (
        Decimal(str(paid_amount)).quantize(Decimal("0.01"))
        if paid_amount is not None
        else Decimal(str(compute_paid_amount_from_particulars(expense.description, expense.amount) or 0)).quantize(Decimal("0.01"))
    )
    if new_amt <= Decimal("0.00"):
        raise HTTPException(
            status_code=400,
            detail="A loan repayment expense cannot be marked as Pending or Unpaid. Delete the expense to reverse the loan repayment.",
        )
    _assert_repayment_amount_allowed(db, loan, rep.loan_repayment_id, new_amt)

    prior_date = old_pay_date or rep.payment_date
    prior_amount = rep.amount
    is_petty = "petty cash" in (expense.payment_method or "").strip().lower()
    if is_petty:
        target_bank_id = None
    elif expense.bank_account_id:
        target_bank_id = expense.bank_account_id
    elif rep.bank_account_id:
        target_bank_id = rep.bank_account_id
    else:
        acc = db.query(BankAccount).filter(BankAccount.company_id == loan.borrower).first()
        if not acc:
            comp = db.query(Company).filter(Company.company_id == loan.borrower).first()
            acc = BankService(db).find_account_for_company(comp.company_name) if comp else None
        target_bank_id = acc.id if acc else None

    rep.amount = new_amt
    if expense.expense_date is not None:
        rep.payment_date = expense.expense_date
    rep.reference_no = expense.cheque_no
    rep.notes = expense.remarks
    rep.bank_account_id = target_bank_id

    # Tag borrower bank entry with source_loan_repayment_id and canonical category if present
    for btx in db.query(BankTransaction).filter(BankTransaction.source_expense_id == expense.expense_id).all():
        btx.source_loan_repayment_id = rep.loan_repayment_id
        btx.category = "Loan Repayment"

    _sync_lender_bank_for_repayment(
        db,
        rep,
        amount=new_amt,
        pay_date=rep.payment_date,
        reference_no=rep.reference_no,
        legacy_pay_date=prior_date,
        legacy_amount=prior_amount,
    )
    recompute_loan_repayments_and_status(db, loan.loan_id)
    if commit:
        db.commit()
        sync_remote_loan_status(db, loan.loan_id)
    else:
        db.flush()
    system_cache.invalidate_tag("notifications")
    return loan.loan_id


def delete_loan_repayment_from_expense(db: Session, expense_id: int, commit: bool = True) -> Optional[int]:
    """Cascade an Expense deletion to its linked LoanRepayment, Loan status, and lender's bank deposit."""
    expense = db.query(Expense).filter(Expense.expense_id == expense_id).first()
    rep = _find_repayment_for_expense(db, expense) if expense else (
        db.query(LoanRepayment).filter(LoanRepayment.expense_id == expense_id).first()
    )
    if not rep:
        return None
    loan_id = rep.loan_id
    _sync_lender_bank_for_repayment(db, rep, amount=None, delete=True)
    db.delete(rep)
    db.flush()
    recompute_loan_repayments_and_status(db, loan_id)
    if commit:
        db.commit()
        sync_remote_loan_status(db, loan_id)
    else:
        db.flush()
    system_cache.invalidate_tag("notifications")
    return loan_id


@router.put("/{loan_id}/repayments/{repayment_id}", response_model=LoanRepaymentOut, summary="Update a loan repayment")
def update_loan_repayment(
    loan_id: int,
    repayment_id: int,
    repayment_in: LoanRepaymentCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    loan = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    check_company_access(current_user, loan.borrower)

    rep = db.query(LoanRepayment).filter(
        LoanRepayment.loan_id == loan_id,
        LoanRepayment.loan_repayment_id == repayment_id,
    ).first()
    if not rep:
        raise HTTPException(status_code=404, detail="Loan repayment not found")

    exp = db.query(Expense).filter(Expense.expense_id == rep.expense_id).first() if rep.expense_id else None
    if exp and (exp.audit_status or "").strip().lower() == "verified":
        raise HTTPException(status_code=409, detail="This loan repayment's expense has been Verified by an Auditor and cannot be edited.")
    _assert_lender_bank_unlocked(db, rep.loan_repayment_id, repayment=rep)

    new_amt = Decimal(str(repayment_in.amount)).quantize(Decimal("0.01"))
    _assert_repayment_amount_allowed(db, loan, repayment_id, new_amt)

    existing_pm = (exp.payment_method if exp and exp.payment_method else rep.payment_method) or "Cash"
    if "payment_method" in repayment_in.model_fields_set and repayment_in.payment_method is not None:
        chosen_pm = repayment_in.payment_method.strip() or existing_pm
    else:
        chosen_pm = existing_pm
    is_petty = "petty cash" in chosen_pm.lower()

    if not is_petty and repayment_in.bank_account_id:
        from app.services.income_bank_links import validate_company_bank
        validate_company_bank(db, loan.borrower, repayment_in.bank_account_id)

    if is_petty:
        target_bank_id = None
    else:
        target_bank_id = repayment_in.bank_account_id or rep.bank_account_id or (exp.bank_account_id if exp else None)
        if not target_bank_id:
            acc = db.query(BankAccount).filter(BankAccount.company_id == loan.borrower).first()
            if not acc:
                comp = db.query(Company).filter(Company.company_id == loan.borrower).first()
                acc = BankService(db).find_account_for_company(comp.company_name) if comp else None
            target_bank_id = acc.id if acc else None

    old_pay_date = rep.payment_date
    old_amount = rep.amount
    rep.amount = new_amt
    rep.payment_date = repayment_in.payment_date
    # An empty reference clears it (the expense and bank rows fall back to the loan reference)
    rep.reference_no = (repayment_in.reference_no or "").strip() or None
    rep.notes = repayment_in.notes
    rep.bank_account_id = target_bank_id

    effective_cheque = rep.reference_no or loan.loan_ref_no or f"LN-{loan_id}"
    if exp:
        exp.amount = new_amt
        exp.amount_paid = new_amt
        exp.expense_date = repayment_in.payment_date
        exp.cheque_no = effective_cheque
        exp.remarks = repayment_in.notes
        exp.payment_method = chosen_pm
        exp.bank_account_id = target_bank_id
        exp.audit_status = "Pending Audit"
        exp.audited_by = None
        exp.audited_at = None
        exp.audit_remarks = None
        db.flush()

    _sync_lender_bank_for_repayment(
        db,
        rep,
        amount=new_amt,
        pay_date=rep.payment_date,
        reference_no=rep.reference_no or loan.loan_ref_no,
        legacy_pay_date=old_pay_date,
        legacy_amount=old_amount,
    )
    recompute_loan_repayments_and_status(db, loan_id)

    if exp:
        # Same transaction as the edit above, so the repayment, expense and both banks save together
        from app.api.v1.endpoints.expenses import reconcile_expense_bank
        reconcile_expense_bank(db, expense_id=exp.expense_id, commit=False)
        for btx in db.query(BankTransaction).filter(BankTransaction.source_expense_id == exp.expense_id).all():
            btx.source_loan_repayment_id = rep.loan_repayment_id
            btx.category = "Loan Repayment"
    db.commit()
    sync_remote_loan_status(db, loan_id)

    if exp and not rest_and_orm_share_database():
        try:
            sb_client = get_supabase_admin_client()
            if sb_client:
                sb_client.table("expenses").update({
                    "amount": float(new_amt),
                    "amount_paid": float(new_amt),
                    "expense_date": repayment_in.payment_date.isoformat(),
                    "cheque_number": effective_cheque,
                    "remarks": repayment_in.notes,
                    "payment_method": chosen_pm,
                    "bank_account_id": target_bank_id,
                    "audit_status": "Pending Audit",
                    "audited_by": None,
                    "audited_at": None,
                    "audit_remarks": None,
                }).eq("expense_id", exp.expense_id).execute()
        except Exception as sb_err:
            print(f"Supabase expense update on loan repayment warning: {sb_err}")

    db.refresh(rep)
    rep.payment_method = chosen_pm
    log_transaction(
        db, AuditAction.LOAN_UPDATED,
        user_id=current_user.get("user_id"), company_id=loan.borrower,
        ip_address=request.client.host if request.client else "unknown",
        record_id=loan_id, record_type="loan_repayment",
        extra={"repayment_id": rep.loan_repayment_id, "amount": float(new_amt), "action": "repayment_updated"},
    )
    system_cache.invalidate_tag("loans")
    system_cache.invalidate_tag("bank_accounts")
    system_cache.invalidate_tag("expenses")
    system_cache.invalidate_tag("notifications")
    ws_manager.broadcast_sync({"type": "LOANS_UPDATED"})
    ws_manager.broadcast_sync({"type": "EXPENSE_UPDATED"})
    ws_manager.broadcast_sync({"type": "BANK_UPDATED"})
    return rep


@router.delete("/{loan_id}/repayments/{repayment_id}", status_code=status.HTTP_200_OK, summary="Delete a loan repayment")
def delete_loan_repayment(
    loan_id: int,
    repayment_id: int,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    loan = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    check_company_access(current_user, loan.borrower)

    rep = db.query(LoanRepayment).filter(
        LoanRepayment.loan_id == loan_id,
        LoanRepayment.loan_repayment_id == repayment_id,
    ).first()
    if not rep:
        raise HTTPException(status_code=404, detail="Loan repayment not found")

    exp = db.query(Expense).filter(Expense.expense_id == rep.expense_id).first() if rep.expense_id else None
    if exp and (exp.audit_status or "").strip().lower() == "verified":
        raise HTTPException(status_code=409, detail="This loan repayment's expense has been Verified by an Auditor and cannot be deleted.")

    expense_id = rep.expense_id
    _sync_lender_bank_for_repayment(db, rep, amount=None, delete=True)
    if expense_id:
        from app.api.v1.endpoints.expenses import reconcile_expense_bank
        reconcile_expense_bank(db, expense_id=expense_id, force_zero=True, commit=False)
        BankService(db).purge_linked_entries(link_attr="source_expense_id", link_id=expense_id, commit=False)
        if exp:
            db.delete(exp)
    db.delete(rep)
    db.flush()
    recompute_loan_repayments_and_status(db, loan_id)
    db.commit()
    sync_remote_loan_status(db, loan_id)

    if expense_id and not rest_and_orm_share_database():
        try:
            sb_client = get_supabase_admin_client()
            if sb_client:
                sb_client.table("expenses").delete().eq("expense_id", expense_id).execute()
        except Exception as sb_err:
            print(f"Supabase expense delete on loan repayment warning: {sb_err}")

    log_transaction(
        db, AuditAction.LOAN_UPDATED,
        user_id=current_user.get("user_id"), company_id=loan.borrower,
        ip_address=request.client.host if request.client else "unknown",
        record_id=loan_id, record_type="loan_repayment",
        extra={"repayment_id": repayment_id, "expense_id": expense_id, "action": "repayment_deleted"},
    )
    system_cache.invalidate_tag("loans")
    system_cache.invalidate_tag("bank_accounts")
    system_cache.invalidate_tag("expenses")
    system_cache.invalidate_tag("notifications")
    ws_manager.broadcast_sync({"type": "LOANS_UPDATED"})
    ws_manager.broadcast_sync({"type": "EXPENSE_DELETED"})
    ws_manager.broadcast_sync({"type": "BANK_UPDATED"})
    return {"success": True, "loan_id": loan_id, "repayment_id": repayment_id}


def backfill_loan_repayment_links(db: Session) -> int:
    """Link repayments recorded before migration 0074 to their borrower expense and lender deposit, so an
    edit or delete reaches them too. Matches only on exact amount, date and the 'Loan Repayment' wording,
    never to something already linked, and only fills blanks. Safe to run on every start."""
    linked = 0
    try:
        loans_by_id = {ln.loan_id: ln for ln in db.query(Loan).all()}
        comp_map = dict(db.query(Company.company_id, Company.company_name).all())
        lender_accounts_by_company: dict[int, list[str]] = {}
        for aid, cid in db.query(BankAccount.id, BankAccount.company_id).all():
            if cid is not None:
                lender_accounts_by_company.setdefault(cid, []).append(aid)

        taken_expenses = {
            eid for (eid,) in db.query(LoanRepayment.expense_id).filter(LoanRepayment.expense_id.isnot(None)).all()
        }
        reps = (
            db.query(LoanRepayment)
            .filter(LoanRepayment.expense_id.is_(None))
            .order_by(LoanRepayment.payment_date.asc(), LoanRepayment.loan_repayment_id.asc())
            .all()
        )
        for rep in reps:
            loan = loans_by_id.get(rep.loan_id)
            if loan is None:
                continue
            q = db.query(Expense).filter(
                Expense.company_id == loan.borrower,
                Expense.description.ilike("Loan Repayment:%"),
                Expense.expense_date == rep.payment_date,
                Expense.amount == rep.amount,
            ).order_by(Expense.expense_id.asc())
            candidates = [e for e in q.all() if e.expense_id not in taken_expenses]
            l_name = comp_map.get(loan.lender) if loan.lender else None
            exp = (
                next((e for e in candidates if f"(to {l_name.lower()})" in (e.description or "").lower()), None)
                if l_name
                else None
            )
            if exp is None and not l_name and candidates:
                exp = candidates[0]
            elif exp is None and candidates and len(candidates) == 1:
                # Single candidate when lender wording changed: only adopt if it wasn't explicitly addressed to a different lender
                desc_lower = (candidates[0].description or "").lower()
                if not l_name or "(to " not in desc_lower:
                    exp = candidates[0]
            if exp is not None:
                rep.expense_id = exp.expense_id
                taken_expenses.add(exp.expense_id)
                if not rep.bank_account_id:
                    rep.bank_account_id = exp.bank_account_id
                linked += 1

        already_linked_reps = {
            rid
            for (rid,) in db.query(BankTransaction.source_loan_repayment_id)
            .filter(
                BankTransaction.source_loan_repayment_id.isnot(None),
                BankTransaction.deposit > 0,
            )
            .all()
        }
        claimed_tx_ids: set[str] = set()
        for rep in db.query(LoanRepayment).order_by(LoanRepayment.payment_date.asc(), LoanRepayment.loan_repayment_id.asc()).all():
            if rep.loan_repayment_id in already_linked_reps:
                continue
            tx = _find_legacy_lender_deposit(
                db,
                rep,
                match_date=rep.payment_date,
                claimed_tx_ids=claimed_tx_ids,
                loans_by_id=loans_by_id,
                comp_map=comp_map,
                lender_accounts_by_company=lender_accounts_by_company,
            )
            if tx is not None:
                tx.source_loan_repayment_id = rep.loan_repayment_id
                claimed_tx_ids.add(tx.id)
                db.flush()
                linked += 1
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"Loan repayment link backfill skipped: {exc}")
    return linked


@router.patch("/{loan_id}/audit", summary="Save the ledger audit review of a loan (Auditor only)")
def review_loan_audit(
    loan_id: int,
    review_in: dict,
    current_user: AuthenticatedUser = Depends(require_auditor_user),
    db: Session = Depends(get_db),
):
    from app.schemas.audit_review import AuditReviewIn
    from app.services.audit_review_service import apply_audit_review

    payload = AuditReviewIn(**review_in)
    ln = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    if ln:
        # Check company access on borrower or lender
        try:
            check_company_access(current_user, ln.borrower)
        except HTTPException:
            if ln.lender:
                check_company_access(current_user, ln.lender)
            else:
                raise
    apply_audit_review(
        db,
        current_user,
        model=Loan,
        pk_column="loan_id",
        supabase_table="loan",
        record_id=loan_id,
        payload=payload,
        not_found="Loan not found",
    )
    system_cache.invalidate_tag("loans")
    ws_manager.broadcast_sync({"type": "LOANS_UPDATED", "payload": {"action": "audited", "loan_id": loan_id}})
    ln = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    return {
        "loan_id": loan_id,
        "audit_status": getattr(ln, "audit_status", "Pending Audit") if ln else payload.audit_status,
        "audited_by": getattr(ln, "audited_by", None) if ln else None,
        "audited_at": ln.audited_at.isoformat() if ln and getattr(ln, "audited_at", None) else None,
        "audit_remarks": getattr(ln, "audit_remarks", None) if ln else None,
    }


@router.patch("/repayments/{repayment_id}/audit", summary="Save the ledger audit review of a loan repayment (Auditor only)")
def review_loan_repayment_audit(
    repayment_id: int,
    review_in: dict,
    current_user: AuthenticatedUser = Depends(require_auditor_user),
    db: Session = Depends(get_db),
):
    from app.schemas.audit_review import AuditReviewIn
    from app.services.audit_review_service import apply_audit_review

    payload = AuditReviewIn(**review_in)
    apply_audit_review(
        db,
        current_user,
        model=LoanRepayment,
        pk_column="loan_repayment_id",
        supabase_table="loans_repayments",
        record_id=repayment_id,
        payload=payload,
        not_found="Loan repayment not found",
    )
    system_cache.invalidate_tag("loans")
    ws_manager.broadcast_sync({"type": "LOANS_UPDATED", "payload": {"action": "audited", "repayment_id": repayment_id}})
    rep = db.query(LoanRepayment).filter(LoanRepayment.loan_repayment_id == repayment_id).first()
    return {
        "loan_repayment_id": repayment_id,
        "audit_status": getattr(rep, "audit_status", "Pending Audit") if rep else payload.audit_status,
        "audited_by": getattr(rep, "audited_by", None) if rep else None,
        "audited_at": rep.audited_at.isoformat() if rep and getattr(rep, "audited_at", None) else None,
        "audit_remarks": getattr(rep, "audit_remarks", None) if rep else None,
    }

