from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from typing import List, Optional
from datetime import date
from decimal import Decimal
from collections import defaultdict
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.session import get_db
from app.db.supabase import get_supabase_admin_client
from app.models.finance import Expense, Category
from app.models.company import Company
from app.schemas.expense import ExpenseCreate, ExpenseOut, ExpenseUpdate, DailyExpenseSummaryOut, RemarksUpdate
from app.schemas.audit_review import AuditReviewIn, audit_fields
from app.services.audit_review_service import apply_audit_review
from app.services.audit_service import AuditAction, log_transaction
from app.services.petty_cash_service import PettyCashService
from app.services.sales_receivables_sync import compute_paid_amount_from_particulars
from app.api.v1.endpoints.particulars import extract_particular_names, save_company_particular_if_not_exists
from app.core.post_save import rest_and_orm_share_database, schedule_created_side_effects
from app.core.idempotency import (
    ExistingRecord,
    find_by_client_ref_orm,
    find_by_client_ref_supabase,
    supabase_supports_client_ref,
)


class _SkipBackup(Exception):
    """Internal: the ORM database is the Supabase database, so the backup write is skipped."""

router = APIRouter()

from app.core.dependencies import AuditorUser, AuthenticatedUser, BusinessReader, BusinessWriter, check_company_access, require_auditor_user, require_business_reader, require_business_writer
from app.core.company_resolver import resolve_company, normalize_company_id
from app.core.pagination import PaginationParams
from app.core.cache import get_cached, set_cached, system_cache

PETTY_CASH_CATEGORY = "Petty Cash"


def _is_petty_cash_payment(payment_method: Optional[str]) -> bool:
    """Same rule the petty cash wallet uses to count an expense as spent from petty cash."""
    return "petty cash" in (payment_method or "").strip().lower()


def _local_category_id(db: Session, name: str) -> Optional[int]:
    """Local category id for a name (created when missing), for the local-database paths."""
    cleaned = (name or "").strip()
    if not cleaned or cleaned.lower() == "none":
        return None
    cat = db.query(Category).filter(func.lower(Category.name) == cleaned.lower()).first()
    if cat is None:
        cat = Category(name=cleaned)
        db.add(cat)
        db.flush()
    return cat.category_id


def reconcile_expense_bank(db: Session, *, expense_id: int, force_zero: bool = False) -> None:
    """Keep the bank equal to the Transactions ledger for one expense: only the PAID part of an expense
    has left the bank (Pending and Unpaid lines have not), on the expense's own bank account.
    Petty cash expenses never touch a bank."""
    try:
        from app.services.bank_service import BankService
        from app.core.websocket import ws_manager

        expense = db.query(Expense).filter(Expense.expense_id == expense_id).first()
        if expense is None:
            return
        # Same rule the petty cash wallet uses to count an expense as spent from petty cash
        is_petty = "petty cash" in (expense.payment_method or "").strip().lower()
        target = (
            Decimal("0.00")
            if force_zero or is_petty
            else compute_paid_amount_from_particulars(expense.description, expense.amount)
        )
        company = db.query(Company).filter(Company.company_id == expense.company_id).first()
        company_name = company.company_name if company else None
        exp_date = expense.expense_date
        BankService(db).sync_expense_disbursement(
            expense_id=expense_id,
            target_amount=target,
            company_name=company_name,
            account_id=expense.bank_account_id,
            particulars=f"Expense Disbursement: {expense.description}",
            reference_no=expense.cheque_number or expense.cheque_no or expense.reference_no,
            tx_date=exp_date.strftime("%m/%d/%y") if hasattr(exp_date, "strftime") else str(exp_date),
            legacy_particulars=expense.description,
        )
        ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"company": company_name}})
    except Exception as exc:  # never block saving an expense on a bank sync problem
        import logging
        logging.getLogger(__name__).warning("Bank reconcile skipped for expense %s: %s", expense_id, exc)


def get_supabase_mappings(client=None, db: Optional[Session] = None):
    cached = get_cached("supabase_mappings")
    if cached:
        return cached[0], cached[1]

    company_map = {}
    if db is not None:
        try:
            from app.models.company import Company as CompanyModel
            comps = db.query(CompanyModel).all()
            for c in comps:
                if c.company_id and c.company_name:
                    company_map[c.company_id] = c.company_name
        except Exception:
            pass
    else:
        try:
            from app.db.session import SessionLocal
            from app.models.company import Company as CompanyModel
            with SessionLocal() as local_db:
                comps = local_db.query(CompanyModel).all()
                for c in comps:
                    if c.company_id and c.company_name:
                        company_map[c.company_id] = c.company_name
        except Exception:
            pass

    if not company_map and client is not None:
        try:
            companies = client.table("company").select("company_id, company_name").execute().data or []
            for c in companies:
                if c.get("company_id") and c.get("company_name"):
                    company_map[c["company_id"]] = c["company_name"]
        except Exception:
            pass

    cat_map = {}
    if client is not None:
        try:
            categories = client.table("category").select("category_id, name").execute().data or []
            cat_map = {c["category_id"]: c["name"] for c in categories}
        except Exception:
            cat_map = {}

    if not cat_map and db is not None:
        try:
            cats = db.query(Category).all()
            cat_map = {c.category_id: c.name for c in cats}
        except Exception:
            pass

    set_cached("supabase_mappings", (company_map, cat_map), ttl_seconds=600)
    return company_map, cat_map

def _current_expense_row(db: Session, expense_id: int) -> Optional[dict]:
    """Company, payment method and amount of an existing expense (Supabase first, then local)."""
    try:
        client = get_supabase_admin_client()
        res = client.table("expenses").select("company_id, payment_method, amount").eq("expense_id", expense_id).execute()
        if res.data:
            return res.data[0]
    except Exception:
        pass
    exp = db.query(Expense).filter(Expense.expense_id == expense_id).first()
    if exp:
        return {"company_id": exp.company_id, "payment_method": exp.payment_method, "amount": exp.amount}
    return None

@router.get("", response_model=List[ExpenseOut], summary="List expense records")
def get_expenses(
    company_id: Optional[int] = Query(None, description="Filter by Company ID"),
    company_name: Optional[str] = Query(None, description="Filter by Company Name"),
    category_id: Optional[int] = Query(None, description="Filter by Category ID"),
    start_date: Optional[date] = Query(None, description="Filter from date"),
    end_date: Optional[date] = Query(None, description="Filter to date"),
    pagination: PaginationParams = Depends(),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db)
):
    if not hasattr(pagination, "offset"):
        pagination = PaginationParams()
    user_role = (current_user.get("role") or "").lower()
    is_privileged = user_role in ("admin", "audit", "finance", "auditor") or bool(current_user.get("is_admin"))
    user_company_ids = current_user.get("company_ids") or []
    if not is_privileged and not user_company_ids and current_user.get("company_id"):
        user_company_ids = [current_user["company_id"]]

    try:
        client = get_supabase_admin_client()
        company_map, cat_map = get_supabase_mappings(client, db=db)

        sb_query = client.table("expenses").select("*")

        # Company filter & access check
        resolved_company_id = normalize_company_id(company_id)
        if resolved_company_id:
            check_company_access(current_user, resolved_company_id)
            sb_query = sb_query.eq("company_id", resolved_company_id)
        elif company_name and company_name.lower() != "all companies":
            resolved_comp = resolve_company(db, company_name=company_name)
            target_cid = resolved_comp.company_id
            check_company_access(current_user, target_cid)
            sb_query = sb_query.eq("company_id", target_cid)
        elif user_company_ids:
            if len(user_company_ids) == 1:
                sb_query = sb_query.eq("company_id", user_company_ids[0])
            else:
                sb_query = sb_query.in_("company_id", user_company_ids)
        elif not is_privileged:
            return []

        if category_id:
            sb_query = sb_query.eq("category_id", category_id)
        if start_date:
            sb_query = sb_query.gte("expense_date", start_date.isoformat())
        if end_date:
            sb_query = sb_query.lte("expense_date", end_date.isoformat())

        sb_query = sb_query.order("expense_date", desc=True).order("expense_id", desc=True)
        res = sb_query.range(pagination.offset, pagination.offset + pagination.limit - 1).execute()
        rows = res.data or []

        return [
            ExpenseOut(
                expense_id=row["expense_id"],
                company_id=row.get("company_id"),
                company_name=company_map.get(row.get("company_id")) or "Unknown Company",
                category_id=row.get("category_id"),
                category_name=cat_map.get(row.get("category_id")) or "None",
                payment_method=row.get("payment_method"),
                created_by=row.get("created_by"),
                expense_date=row.get("expense_date"),
                reference_no=row.get("reference_no"),
                cheque_no=row.get("cheque_number") or row.get("cheque_no") or (row.get("reference_no") if not (row.get("reference_no") or "").startswith("REF-") else None),
                amount=row.get("amount") or 0.0,
                amount_paid=row.get("amount_paid") or 0.0,
                unpaid_balance=Decimal(str(row.get("amount") or 0.0)) - Decimal(str(row.get("amount_paid") or 0.0)),
                particulars=row.get("description") or "",
                description=row.get("description") or "",
                created_at=row.get("created_at"),
                updated_at=row.get("updated_at"),
                remarks=row.get("remarks"),
                **audit_fields(row)
            )
            for row in rows
        ]
    except HTTPException:
        raise
    except Exception as e:
        # Fallback to local SQLite if Supabase is unavailable
        query = (
            db.query(
                Expense,
                Company.company_name.label("company_name"),
                Category.name.label("category_name")
            )
            .outerjoin(Company, Expense.company_id == Company.company_id)
            .outerjoin(Category, Expense.category_id == Category.category_id)
        )

        if company_id:
            check_company_access(current_user, company_id)
            query = query.filter(Expense.company_id == company_id)
        elif company_name and company_name.lower() != "all companies":
            try:
                resolved_comp = resolve_company(db, company_name=company_name)
                check_company_access(current_user, resolved_comp.company_id)
                query = query.filter(Expense.company_id == resolved_comp.company_id)
            except HTTPException:
                raise
            except Exception:
                query = query.filter(func.lower(Company.company_name) == func.lower(company_name.strip()))
                if not is_privileged:
                    query = query.filter(Expense.company_id.in_(user_company_ids))
        elif user_company_ids:
            query = query.filter(Expense.company_id.in_(user_company_ids))
        elif not is_privileged:
            return []

        if category_id:
            query = query.filter(Expense.category_id == category_id)
        if start_date:
            query = query.filter(Expense.expense_date >= start_date)
        if end_date:
            query = query.filter(Expense.expense_date <= end_date)

        rows = query.order_by(Expense.expense_date.desc(), Expense.expense_id.desc()).offset(pagination.offset).limit(pagination.limit).all()

        return [
            ExpenseOut(
                expense_id=exp.expense_id,
                company_id=exp.company_id,
                company_name=c_name,
                category_id=exp.category_id,
                category_name=cat_name or "None",
                payment_method=exp.payment_method,
                created_by=exp.created_by,
                expense_date=exp.expense_date,
                reference_no=exp.reference_no,
                cheque_no=exp.cheque_number or exp.cheque_no or (exp.reference_no if not (exp.reference_no or "").startswith("REF-") else None),
                amount=exp.amount,
                amount_paid=exp.amount_paid or Decimal("0.00"),
                unpaid_balance=exp.amount - (exp.amount_paid or Decimal("0.00")),
                particulars=exp.description or "",
                description=exp.description or "",
                created_at=exp.created_at,
                updated_at=exp.updated_at,
                remarks=getattr(exp, "remarks", None),
                **audit_fields(exp)
            )
            for exp, c_name, cat_name in rows
        ]


def _to_date(val) -> Optional[date]:
    if isinstance(val, date):
        return val
    if isinstance(val, str) and val.strip():
        try:
            return date.fromisoformat(val.strip().split("T")[0])
        except Exception:
            try:
                parts = val.strip().split("/")
                if len(parts) == 3:
                    m, d, y = parts
                    if len(y) == 2:
                        y = "20" + y
                    return date(int(y), int(m), int(d))
            except Exception:
                pass
    return None


def _rollup_audit_status(statuses: List[str]) -> str:
    if not statuses:
        return "Pending Audit"
    cleaned = [s.strip() for s in statuses if s]
    if any(s.lower() in ("discrepancy", "flagged") for s in cleaned):
        return "Discrepancy"
    if all(s.lower() in ("verified", "all verified") for s in cleaned):
        return "All Verified"
    return "Pending Audit"


@router.get("/daily-summary", response_model=List[DailyExpenseSummaryOut], summary="Daily expense aggregation summary")
def get_expenses_daily_summary(
    company_id: Optional[int] = Query(None, description="Filter by Company ID"),
    company_name: Optional[str] = Query(None, description="Filter by Company Name"),
    category_id: Optional[int] = Query(None, description="Filter by Category ID"),
    start_date: Optional[date] = Query(None, description="Filter from date"),
    end_date: Optional[date] = Query(None, description="Filter to date"),
    status: Optional[str] = Query(None, description="Filter by status"),
    view_type: Optional[str] = Query(None, description="View type ('withdraw' or 'expense')"),
    search: Optional[str] = Query(None, description="Search keyword"),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db)
):
    if not hasattr(pagination, "offset"):
        pagination = PaginationParams()
    user_role = (current_user.get("role") or "").lower()
    is_privileged = user_role in ("admin", "audit", "finance", "auditor") or bool(current_user.get("is_admin"))
    user_company_ids = current_user.get("company_ids") or []
    if not is_privileged and not user_company_ids and current_user.get("company_id"):
        user_company_ids = [current_user["company_id"]]

    raw_records = []
    use_sb = False
    try:
        from app.services.sales_receivables_sync import SalesReceivablesSyncService
        use_sb = SalesReceivablesSyncService(db)._use_supabase()
    except Exception:
        use_sb = True

    try:
        if not use_sb:
            raise RuntimeError("In-memory SQLite session")
        client = get_supabase_admin_client()

        sb_query = client.table("expenses").select("*")

        resolved_company_id = normalize_company_id(company_id)
        if resolved_company_id:
            check_company_access(current_user, resolved_company_id)
            sb_query = sb_query.eq("company_id", resolved_company_id)
        elif company_name and company_name.lower() != "all companies":
            resolved_comp = resolve_company(db, company_name=company_name)
            target_cid = resolved_comp.company_id
            check_company_access(current_user, target_cid)
            sb_query = sb_query.eq("company_id", target_cid)
        elif user_company_ids:
            if len(user_company_ids) == 1:
                sb_query = sb_query.eq("company_id", user_company_ids[0])
            else:
                sb_query = sb_query.in_("company_id", user_company_ids)
        elif not is_privileged:
            return []

        if category_id:
            sb_query = sb_query.eq("category_id", category_id)
        if start_date:
            sb_query = sb_query.gte("expense_date", start_date.isoformat())
        if end_date:
            sb_query = sb_query.lte("expense_date", end_date.isoformat())

        res = sb_query.order("expense_date", desc=True).order("expense_id", desc=True).execute()
        rows = res.data or []
        for r in rows:
            raw_records.append({
                "expense_date": r.get("expense_date"),
                "amount": r.get("amount") or 0.0,
                "amount_paid": r.get("amount_paid") or 0.0,
                "particulars": r.get("description") or r.get("particulars") or "",
                "cheque_no": r.get("cheque_number") or r.get("cheque_no") or r.get("reference_no") or "",
                "audit_status": r.get("audit_status") or "Pending Audit",
            })
    except HTTPException:
        raise
    except Exception:
        query = db.query(Expense)
        if company_id:
            check_company_access(current_user, company_id)
            query = query.filter(Expense.company_id == company_id)
        elif company_name and company_name.lower() != "all companies":
            try:
                resolved_comp = resolve_company(db, company_name=company_name)
                check_company_access(current_user, resolved_comp.company_id)
                query = query.filter(Expense.company_id == resolved_comp.company_id)
            except HTTPException:
                raise
            except Exception:
                query = query.join(Company, Expense.company_id == Company.company_id).filter(
                    func.lower(Company.company_name) == func.lower(company_name.strip())
                )
                if not is_privileged:
                    query = query.filter(Expense.company_id.in_(user_company_ids))
        elif user_company_ids:
            query = query.filter(Expense.company_id.in_(user_company_ids))
        elif not is_privileged:
            return []

        if category_id:
            query = query.filter(Expense.category_id == category_id)
        if start_date:
            query = query.filter(Expense.expense_date >= start_date)
        if end_date:
            query = query.filter(Expense.expense_date <= end_date)

        rows = query.order_by(Expense.expense_date.desc(), Expense.expense_id.desc()).all()
        for e in rows:
            raw_records.append({
                "expense_date": e.expense_date,
                "amount": e.amount,
                "amount_paid": e.amount_paid or 0.0,
                "particulars": e.description or "",
                "cheque_no": e.cheque_number or e.cheque_no or e.reference_no or "",
                "audit_status": e.audit_status or "Pending Audit",
            })

    # Group by date
    daily_groups = defaultdict(lambda: {
        "count": 0,
        "gross_total": Decimal("0.00"),
        "realized_cash": Decimal("0.00"),
        "audit_statuses": []
    })

    search_term = (search or "").strip().lower()
    is_withdraw_view = (view_type or "").lower() == "withdraw"

    for r in raw_records:
        rec_date = _to_date(r["expense_date"])
        if not rec_date:
            continue

        parts = r["particulars"]
        chq = r["cheque_no"]

        if search_term:
            if search_term not in parts.lower() and search_term not in chq.lower():
                continue

        amt = Decimal(str(r["amount"] or 0))
        amt_paid = Decimal(str(r["amount_paid"] or 0))
        realized_from_particulars = compute_paid_amount_from_particulars(parts, amt)
        realized = max(amt_paid, realized_from_particulars)

        if is_withdraw_view and realized <= Decimal("0.00"):
            continue

        gross = realized if is_withdraw_view else amt

        daily_groups[rec_date]["count"] += 1
        daily_groups[rec_date]["gross_total"] += gross
        daily_groups[rec_date]["realized_cash"] += realized
        daily_groups[rec_date]["audit_statuses"].append(r["audit_status"])

    result = [
        DailyExpenseSummaryOut(
            date=d,
            day_of_week=d.strftime("%A"),
            transaction_count=data["count"],
            gross_total=data["gross_total"],
            realized_cash=data["realized_cash"],
            audit_status=_rollup_audit_status(data["audit_statuses"])
        )
        for d, data in sorted(daily_groups.items(), key=lambda x: x[0], reverse=True)
    ]
    return result


def _find_expense_by_client_ref(db: Session, client_ref: Optional[str]) -> Optional[ExistingRecord]:
    """The expense already created with this client_ref, if any (spec 0038)."""
    if not client_ref:
        return None
    try:
        found = find_by_client_ref_supabase(get_supabase_admin_client(), "expenses", "expense_id", client_ref)
        if found:
            return found
    except Exception:
        pass
    return find_by_client_ref_orm(db, Expense, "expense_id", client_ref)


LARGE_EXPENSE_THRESHOLD = Decimal("50000.00")


def _enqueue_large_expense_alert_if_enabled(
    db: Session,
    *,
    company_id: int,
    company_name: str,
    expense_id: int,
    amount: Decimal,
    description: str,
    reference_no: Optional[str],
) -> None:
    if amount < LARGE_EXPENSE_THRESHOLD:
        return
    try:
        from app.services.notification_dispatcher import enqueue_notification_event
        from app.services.notification_service import NotificationService, NotificationType

        svc = NotificationService(db)
        if not svc._is_notification_enabled_for_company(company_id, NotificationType.EXPENSE_LARGE_TRANSACTION):
            return

        ref_str = f" (Ref: {reference_no})" if reference_no else ""
        with db.begin_nested():
            enqueue_notification_event(
                db=db,
                event_type=NotificationType.EXPENSE_LARGE_TRANSACTION,
                company_id=company_id,
                target_roles=["supervisor", "finance"],
                payload={
                    "ref_type": "expense",
                    "ref_id": expense_id,
                    "amount": float(amount),
                    "title": f"Large Transaction Alert: {company_name}",
                    "message": (
                        f"An expense of ₱{amount:,.2f} was recorded for {company_name}{ref_str} "
                        f"— {description}."
                    ),
                    "extra_data": {
                        "amount": float(amount),
                        "company_id": company_id,
                        "company_name": company_name,
                        "reference_no": reference_no,
                    },
                },
                idempotency_key=f"{NotificationType.EXPENSE_LARGE_TRANSACTION}:{company_id}:expense:{expense_id}",
            )
        db.commit()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Large expense alert enqueue skipped for expense %s: %s", expense_id, exc)


@router.post("", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED, summary="Record a new expense")
def create_expense(
    expense_in: ExpenseCreate,
    request: Request,
    response: Response,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db)
):
    # Same client_ref sent again (retry, offline resend): return the expense that already exists
    existing = _find_expense_by_client_ref(db, expense_in.client_ref)
    if existing:
        check_company_access(current_user, existing.company_id)
        response.status_code = status.HTTP_200_OK
        return get_expense(expense_id=existing.record_id, current_user=current_user, db=db)

    if expense_in.amount < Decimal("1.00"):
        raise HTTPException(status_code=422, detail="Withdrawal amount must be at least 1.00 (cannot be 0 or negative).")

    if expense_in.expense_date > date.today():
        raise HTTPException(status_code=400, detail="Expense date cannot be in the future (maximum date is today).")

    parts = (expense_in.particulars or expense_in.description or "").strip()
    if not parts:
        raise HTTPException(status_code=422, detail="Particulars is required and cannot be blank.")

    # Paid with petty cash: the category is always Petty Cash, whatever was sent
    if _is_petty_cash_payment(expense_in.payment_method):
        expense_in.category = PETTY_CASH_CATEGORY
        expense_in.category_id = None

    cat_str = (expense_in.category or "").strip()
    if not expense_in.category_id and not cat_str:
        raise HTTPException(status_code=422, detail="Category is required and cannot be blank.")

    cheque = (expense_in.cheque_no or expense_in.chequeNo or "").strip() or None
    ref = expense_in.reference_no or (f"CHK-{cheque}" if cheque else f"REF-{expense_in.expense_date.strftime('%Y%m%d')}")
    effective_bank_id = getattr(expense_in, "bank_account_id", None)

    try:
        client = get_supabase_admin_client()
        company_map, cat_map = get_supabase_mappings(client, db=db)

        # 1. Resolve Company reliably
        target_company = resolve_company(db, company_id=expense_in.company_id, company_name=expense_in.company)
        target_company_id = target_company.company_id
        target_company_name = target_company.company_name

        check_company_access(current_user, target_company_id)

        # Petty cash expenses are paid from the company's petty cash wallet, not sales
        PettyCashService(db).ensure_sufficient_balance(target_company_id, expense_in.payment_method, expense_in.amount)

        # 2. Resolve Category in Supabase
        resolved_category_id = expense_in.category_id
        category_name = "None"
        category_str = (expense_in.category or "").strip()

        if category_str and category_str.lower() != "none":
            for cid, cname in cat_map.items():
                if cname.strip().lower() == category_str.lower():
                    resolved_category_id = cid
                    category_name = cname
                    break
            if not resolved_category_id:
                ins_cat = client.table("category").insert({"name": category_str}).execute()
                if ins_cat.data:
                    resolved_category_id = ins_cat.data[0]["category_id"]
                    category_name = category_str
        elif resolved_category_id and resolved_category_id in cat_map:
            category_name = cat_map[resolved_category_id]
        else:
            resolved_category_id = None
            category_name = "None"

        # 3. Insert into Supabase
        effective_bank_id = getattr(expense_in, "bank_account_id", None)
        if _is_petty_cash_payment(expense_in.payment_method):
            effective_bank_id = None
        elif not effective_bank_id and target_company_name:
            try:
                from app.services.bank_service import BankService
                found_acct = BankService(db).find_account_for_company(target_company_name)
                if found_acct:
                    effective_bank_id = str(found_acct.id)
            except Exception:
                pass

        payment_method_str = (expense_in.payment_method or "").strip() or None
        creator_id = expense_in.created_by or current_user.get("user_id")
        sb_insert = client.table("expenses").insert({
            "company_id": target_company_id,
            "category_id": resolved_category_id,
            "payment_method": payment_method_str,
            "created_by": creator_id,
            "expense_date": expense_in.expense_date.isoformat(),
            "reference_no": ref,
            "cheque_number": cheque,
            "amount": float(expense_in.amount),
            "amount_paid": float(expense_in.amount_paid or 0.0),
            "description": parts,
            "remarks": expense_in.remarks,
            "bank_account_id": effective_bank_id,
            "audit_status": "Pending Audit",
            "audited_by": None,
            "audited_at": None,
            "audit_remarks": None,
            **(
                {"client_ref": expense_in.client_ref}
                if expense_in.client_ref and supabase_supports_client_ref(client, "expenses")
                else {}
            ),
        }).execute()

        if not sb_insert.data:
            raise HTTPException(status_code=500, detail="Failed to insert expense into Supabase.")

        created_row = sb_insert.data[0]
        sb_expense_id = created_row["expense_id"]

        # Also backup to the ORM database, unless it IS the Supabase database (then the row is already there)
        try:
            if rest_and_orm_share_database():
                raise _SkipBackup()
            local_comp = db.query(Company).filter(Company.company_id == target_company_id).first()
            if not local_comp:
                local_comp = Company(
                    company_id=target_company_id,
                    company_name=target_company_name,
                    starting_balance=0.00,
                    current_balance=0.00
                )
                db.add(local_comp)
                db.commit()

            local_exp = Expense(
                expense_id=sb_expense_id,
                company_id=target_company_id,
                category_id=resolved_category_id,
                payment_method=payment_method_str,
                created_by=creator_id,
                expense_date=expense_in.expense_date,
                reference_no=ref,
                cheque_no=cheque,
                cheque_number=cheque,
                amount=expense_in.amount,
                amount_paid=expense_in.amount_paid or Decimal("0.00"),
                description=parts,
                remarks=expense_in.remarks,
                bank_account_id=effective_bank_id,
                audit_status="Pending Audit",
                audited_by=None,
                audited_at=None,
                audit_remarks=None,
                client_ref=expense_in.client_ref,
            )
            db.merge(local_exp)
            db.commit()
        except _SkipBackup:
            pass
        except Exception:
            db.rollback()

        # Debit the bank only for the PAID part (matches the Transactions ledger)
        reconcile_expense_bank(db, expense_id=sb_expense_id)
        system_cache.invalidate_tag("petty_cash")
        _enqueue_large_expense_alert_if_enabled(
            db,
            company_id=target_company_id,
            company_name=target_company_name,
            expense_id=sb_expense_id,
            amount=expense_in.amount,
            description=parts,
            reference_no=ref,
        )

        # Particulars library + audit log don't change the response: do them after it is sent
        actor_name = current_user.get("full_name") or current_user.get("name") or current_user.get("email") or f"User #{current_user.get('user_id')}"
        schedule_created_side_effects(
            db,
            company_id=target_company_id,
            company_name=target_company_name,
            particulars_text=parts,
            particulars_type="Expense",
            audit_action=AuditAction.EXPENSE_CREATED,
            user_id=current_user.get("user_id"),
            ip_address=request.client.host if request.client else "unknown",
            record_id=sb_expense_id,
            record_type="expense",
            audit_extra={"amount": float(expense_in.amount), "expense_date": expense_in.expense_date.isoformat(), "actor_name": actor_name, "reference_no": ref},
        )

        try:
            from app.core.websocket import ws_manager
            ws_manager.broadcast_sync({
                "type": "EXPENSE_CREATED",
                "payload": {
                    "expense_id": sb_expense_id,
                    "company_id": target_company_id,
                    "company": target_company_name,
                }
            })
        except Exception:
            pass

        return ExpenseOut(
            expense_id=created_row["expense_id"],
            company_id=created_row.get("company_id"),
            company_name=target_company_name,
            category_id=created_row.get("category_id"),
            category_name=category_name,
            payment_method=payment_method_str,
            created_by=created_row.get("created_by"),
            expense_date=created_row.get("expense_date"),
            reference_no=created_row.get("reference_no"),
            cheque_no=created_row.get("cheque_number") or cheque or (created_row.get("reference_no") if not (created_row.get("reference_no") or "").startswith("REF-") else None),
            amount=created_row.get("amount"),
            amount_paid=created_row.get("amount_paid") or 0.0,
            unpaid_balance=Decimal(str(created_row.get("amount") or 0.0)) - Decimal(str(created_row.get("amount_paid") or 0.0)),
            particulars=created_row.get("description"),
            description=created_row.get("description"),
            created_at=created_row.get("created_at"),
            updated_at=created_row.get("updated_at"),
            remarks=created_row.get("remarks"),
            **audit_fields(created_row)
        )

    except HTTPException:
        raise
    except Exception as e:
        # The insert may have succeeded before a later step failed, or a parallel request with the same
        # client_ref won the race: return that expense instead of inserting a second one
        existing = _find_expense_by_client_ref(db, expense_in.client_ref)
        if existing:
            check_company_access(current_user, existing.company_id)
            response.status_code = status.HTTP_200_OK
            return get_expense(expense_id=existing.record_id, current_user=current_user, db=db)

        # Fallback to local SQLite only if Supabase error occurs
        target_company = resolve_company(db, company_id=expense_in.company_id, company_name=expense_in.company)
        check_company_access(current_user, target_company.company_id)

        PettyCashService(db).ensure_sufficient_balance(target_company.company_id, expense_in.payment_method, expense_in.amount)

        if _is_petty_cash_payment(expense_in.payment_method):
            effective_bank_id = None
        elif not effective_bank_id and target_company.company_name:
            try:
                from app.services.bank_service import BankService
                found_acct = BankService(db).find_account_for_company(target_company.company_name)
                if found_acct:
                    effective_bank_id = str(found_acct.id)
            except Exception:
                pass

        expense = Expense(
            company_id=target_company.company_id,
            category_id=expense_in.category_id or _local_category_id(db, expense_in.category or ""),
            payment_method=(expense_in.payment_method or "").strip() or None,
            created_by=expense_in.created_by,
            expense_date=expense_in.expense_date,
            reference_no=ref,
            amount=expense_in.amount,
            amount_paid=expense_in.amount_paid or Decimal("0.00"),
            description=parts,
            remarks=expense_in.remarks,
            bank_account_id=effective_bank_id,
            audit_status="Pending Audit",
            audited_by=None,
            audited_at=None,
            audit_remarks=None,
            client_ref=expense_in.client_ref,
        )
        db.add(expense)
        db.commit()
        db.refresh(expense)

        # Debit the bank only for the PAID part (matches the Transactions ledger)
        reconcile_expense_bank(db, expense_id=expense.expense_id)
        system_cache.invalidate_tag("petty_cash")
        _enqueue_large_expense_alert_if_enabled(
            db,
            company_id=target_company.company_id,
            company_name=target_company.company_name,
            expense_id=expense.expense_id,
            amount=expense.amount,
            description=parts,
            reference_no=ref,
        )

        # Auto-save particulars to company library
        try:
            for p_name in extract_particular_names(parts):
                save_company_particular_if_not_exists(
                    db, target_company_id, target_company_name, p_name, "Expense"
                )
        except Exception:
            pass

        cat = db.query(Category).filter(Category.category_id == expense.category_id).first() if expense.category_id else None

        actor_name = current_user.get("full_name") or current_user.get("name") or current_user.get("email") or f"User #{current_user.get('user_id')}"
        log_transaction(
            db, AuditAction.EXPENSE_CREATED,
            user_id=current_user.get("user_id"), company_id=target_company.company_id,
            ip_address=request.client.host if request.client else "unknown",
            record_id=expense.expense_id, record_type="expense",
            extra={"amount": float(expense.amount), "expense_date": expense.expense_date.isoformat(), "actor_name": actor_name, "reference_no": ref},
        )

        try:
            from app.core.websocket import ws_manager
            ws_manager.broadcast_sync({
                "type": "EXPENSE_CREATED",
                "payload": {
                    "expense_id": expense.expense_id,
                    "company_id": target_company.company_id,
                    "company": target_company.company_name,
                }
            })
        except Exception:
            pass

        return ExpenseOut(
            expense_id=expense.expense_id,
            company_id=expense.company_id,
            company_name=target_company.company_name,
            category_id=expense.category_id,
            category_name=cat.name if cat else "None",
            created_by=expense.created_by,
            expense_date=expense.expense_date,
            reference_no=expense.reference_no,
            cheque_no=expense.cheque_number or expense.cheque_no or cheque or (expense.reference_no if not (expense.reference_no or "").startswith("REF-") else None),
            amount=expense.amount,
            amount_paid=expense.amount_paid or Decimal("0.00"),
            unpaid_balance=expense.amount - (expense.amount_paid or Decimal("0.00")),
            particulars=expense.description,
            description=expense.description,
            created_at=expense.created_at,
            updated_at=expense.updated_at,
            remarks=getattr(expense, "remarks", None),
            **audit_fields(expense)
        )

@router.get("/{expense_id}", response_model=ExpenseOut, summary="Get expense details")
def get_expense(
    expense_id: int,
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db)
):

    try:
        client = get_supabase_admin_client()
        company_map, cat_map = get_supabase_mappings(client, db=db)
        res = client.table("expenses").select("*").eq("expense_id", expense_id).execute()
        if res.data:
            row = res.data[0]
            check_company_access(current_user, row.get("company_id"))
            return ExpenseOut(
                expense_id=row["expense_id"],
                company_id=row.get("company_id"),
                company_name=company_map.get(row.get("company_id")) or "Unknown",
                category_id=row.get("category_id"),
                category_name=cat_map.get(row.get("category_id")) or "None",
                payment_method=row.get("payment_method"),
                created_by=row.get("created_by"),
                expense_date=row.get("expense_date"),
                reference_no=row.get("reference_no"),
                cheque_no=row.get("cheque_number") or row.get("cheque_no") or (row.get("reference_no") if not (row.get("reference_no") or "").startswith("REF-") else None),
                amount=row.get("amount") or 0.0,
                amount_paid=row.get("amount_paid") or 0.0,
                unpaid_balance=Decimal(str(row.get("amount") or 0.0)) - Decimal(str(row.get("amount_paid") or 0.0)),
                particulars=row.get("description") or "",
                description=row.get("description") or "",
                created_at=row.get("created_at"),
                updated_at=row.get("updated_at"),
                remarks=row.get("remarks"),
                **audit_fields(row)
            )
    except HTTPException:
        raise
    except Exception:
        pass

    result = (
        db.query(
            Expense,
            Company.company_name.label("company_name"),
            Category.name.label("category_name")
        )
        .outerjoin(Company, Expense.company_id == Company.company_id)
        .outerjoin(Category, Expense.category_id == Category.category_id)
        .filter(Expense.expense_id == expense_id)
        .first()
    )
    if not result:
        raise HTTPException(status_code=404, detail="Expense not found")
    exp, c_name, cat_name = result
    check_company_access(current_user, exp.company_id)
    return ExpenseOut(
        expense_id=exp.expense_id,
        company_id=exp.company_id,
        company_name=c_name,
        category_id=exp.category_id,
        category_name=cat_name or "None",
        payment_method=exp.payment_method,
        created_by=exp.created_by,
        expense_date=exp.expense_date,
        reference_no=exp.reference_no,
        cheque_no=exp.cheque_number or exp.cheque_no or (exp.reference_no if not (exp.reference_no or "").startswith("REF-") else None),
        amount=exp.amount,
        amount_paid=exp.amount_paid or Decimal("0.00"),
        unpaid_balance=exp.amount - (exp.amount_paid or Decimal("0.00")),
        particulars=exp.description or "",
        description=exp.description or "",
        created_at=exp.created_at,
        updated_at=exp.updated_at,
        remarks=getattr(exp, "remarks", None),
        **audit_fields(exp)
    )

@router.put("/{expense_id}", response_model=ExpenseOut, summary="Update an existing expense")
@router.patch("/{expense_id}", response_model=ExpenseOut, summary="Update an existing expense")
def update_expense(
    expense_id: int,
    expense_in: ExpenseUpdate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db)
):

    target_amt = expense_in.amount if expense_in.amount is not None else expense_in.withdrawal
    if target_amt is not None and target_amt < Decimal("1.00"):
        raise HTTPException(status_code=422, detail="Withdrawal amount must be at least 1.00 (cannot be 0 or negative).")

    if expense_in.expense_date is not None and expense_in.expense_date > date.today():
        raise HTTPException(status_code=400, detail="Expense date cannot be in the future (maximum date is today).")

    # Fetch existing expense to verify company access
    current = _current_expense_row(db, expense_id)
    if current and current.get("company_id"):
        check_company_access(current_user, current.get("company_id"))

    # Paid with petty cash (newly chosen, or already petty cash): the category is always Petty Cash
    effective_payment_method = (
        expense_in.payment_method if expense_in.payment_method is not None else (current or {}).get("payment_method")
    )
    force_petty_category = _is_petty_cash_payment(effective_payment_method)
    if force_petty_category:
        expense_in.category = PETTY_CASH_CATEGORY
        expense_in.category_id = None

    # Re-check the petty cash wallet with this expense's old amount added back
    if current:
        PettyCashService(db).ensure_sufficient_balance(
            current.get("company_id"),
            expense_in.payment_method if expense_in.payment_method is not None else current.get("payment_method"),
            target_amt if target_amt is not None else current.get("amount"),
            exclude_expense_id=expense_id,
        )

    update_payload = {}
    if expense_in.expense_date:
        update_payload["expense_date"] = expense_in.expense_date.isoformat()
    if target_amt is not None:
        update_payload["amount"] = float(target_amt)
    if expense_in.amount_paid is not None:
        update_payload["amount_paid"] = float(expense_in.amount_paid)

    parts = expense_in.particulars or expense_in.description
    if parts is not None:
        update_payload["description"] = parts.strip()

    cheque = expense_in.cheque_no if expense_in.cheque_no is not None else expense_in.chequeNo
    if cheque is not None:
        chq_val = cheque.strip() if cheque.strip() else None
        update_payload["cheque_number"] = chq_val
        if chq_val:
            update_payload["reference_no"] = chq_val
    elif expense_in.reference_no is not None:
        update_payload["reference_no"] = expense_in.reference_no.strip() if expense_in.reference_no.strip() else None
    if expense_in.remarks is not None:
        update_payload["remarks"] = expense_in.remarks.strip() if expense_in.remarks else None

    # Update in Supabase
    updated_row = None
    try:
        client = get_supabase_admin_client()
        company_map, cat_map = get_supabase_mappings(client, db=db)

        category_str = (expense_in.category or "").strip()
        if category_str:
            if category_str.lower() == "none":
                update_payload["category_id"] = None
            else:
                cat_id = None
                for cid, cname in cat_map.items():
                    if cname.lower() == category_str.lower():
                        cat_id = cid
                        break
                if not cat_id:
                    ins_cat = client.table("category").insert({"name": category_str}).execute()
                    if ins_cat.data:
                        cat_id = ins_cat.data[0]["category_id"]
                update_payload["category_id"] = cat_id
        elif expense_in.category_id is not None:
            update_payload["category_id"] = expense_in.category_id

        if expense_in.payment_method is not None:
            update_payload["payment_method"] = (expense_in.payment_method or "").strip() or None

        if update_payload:
            sb_res = client.table("expenses").update(update_payload).eq("expense_id", expense_id).execute()
            if sb_res.data:
                updated_row = sb_res.data[0]
    except Exception as e:
        print(f"Supabase expense update error: {e}")

    # Also update in local SQLite
    expense = db.query(Expense).filter(Expense.expense_id == expense_id).first()
    if expense and force_petty_category and "category_id" not in update_payload:
        # Supabase step did not run: still file the expense under Petty Cash locally
        update_payload["category_id"] = _local_category_id(db, PETTY_CASH_CATEGORY)
    if expense:
        if "expense_date" in update_payload:
            expense.expense_date = expense_in.expense_date
        if "amount" in update_payload:
            expense.amount = target_amt
        if "amount_paid" in update_payload:
            expense.amount_paid = expense_in.amount_paid
        if "description" in update_payload:
            expense.description = update_payload["description"]
        if "reference_no" in update_payload:
            expense.reference_no = update_payload["reference_no"]
        if "cheque_number" in update_payload:
            expense.cheque_number = update_payload["cheque_number"]
            expense.cheque_no = update_payload["cheque_number"]
        if "category_id" in update_payload:
            expense.category_id = update_payload["category_id"]
        if "payment_method" in update_payload:
            expense.payment_method = update_payload["payment_method"]
        if "remarks" in update_payload:
            expense.remarks = update_payload["remarks"]
        db.commit()
        db.refresh(expense)

    # Keep the bank equal to the ledger after any edit to amount, particulars, paid status or bank
    reconcile_expense_bank(db, expense_id=expense_id)
    system_cache.invalidate_tag("petty_cash")

    # Auto-save updated particulars to company library
    if parts:
        try:
            target_cid = (updated_row.get("company_id") if updated_row else None) or (expense.company_id if expense else None)
            for p_name in extract_particular_names(parts):
                save_company_particular_if_not_exists(
                    db, target_cid, None, p_name, "Expense"
                )
        except Exception:
            pass

    if updated_row:
        client = get_supabase_admin_client()
        company_map, cat_map = get_supabase_mappings(client, db=db)
        actor_name = current_user.get("full_name") or current_user.get("name") or current_user.get("email") or f"User #{current_user.get('user_id')}"
        log_transaction(
            db, AuditAction.EXPENSE_UPDATED,
            user_id=current_user.get("user_id"), company_id=updated_row.get("company_id"),
            ip_address=request.client.host if request.client else "unknown",
            record_id=expense_id, record_type="expense",
            extra={"changes": {k: str(v) for k, v in update_payload.items()}, "actor_name": actor_name},
        )

        try:
            from app.core.websocket import ws_manager
            ws_manager.broadcast_sync({
                "type": "EXPENSE_UPDATED",
                "payload": {
                    "expense_id": expense_id,
                    "company_id": updated_row.get("company_id"),
                }
            })
        except Exception:
            pass
        return ExpenseOut(
            expense_id=updated_row["expense_id"],
            company_id=updated_row.get("company_id"),
            company_name=company_map.get(updated_row.get("company_id")) or "Unknown",
            category_id=updated_row.get("category_id"),
            category_name=cat_map.get(updated_row.get("category_id")) or "None",
            payment_method=updated_row.get("payment_method"),
            created_by=updated_row.get("created_by"),
            expense_date=updated_row.get("expense_date"),
            reference_no=updated_row.get("reference_no"),
            cheque_no=updated_row.get("cheque_number") or cheque or (updated_row.get("reference_no") if not (updated_row.get("reference_no") or "").startswith("REF-") else None),
            amount=updated_row.get("amount"),
            amount_paid=updated_row.get("amount_paid") or 0.0,
            unpaid_balance=Decimal(str(updated_row.get("amount") or 0.0)) - Decimal(str(updated_row.get("amount_paid") or 0.0)),
            particulars=updated_row.get("description"),
            description=updated_row.get("description"),
            created_at=updated_row.get("created_at"),
            updated_at=updated_row.get("updated_at"),
            remarks=updated_row.get("remarks"),
            **audit_fields(updated_row)
        )

    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    company = db.query(Company).filter(Company.company_id == expense.company_id).first()
    category = db.query(Category).filter(Category.category_id == expense.category_id).first() if expense.category_id else None

    actor_name = current_user.get("full_name") or current_user.get("name") or current_user.get("email") or f"User #{current_user.get('user_id')}"
    log_transaction(
        db, AuditAction.EXPENSE_UPDATED,
        user_id=current_user.get("user_id"), company_id=expense.company_id,
        ip_address=request.client.host if request.client else "unknown",
        record_id=expense_id, record_type="expense",
        extra={"changes": {k: str(v) for k, v in update_payload.items()}, "actor_name": actor_name},
    )

    try:
        from app.core.websocket import ws_manager
        ws_manager.broadcast_sync({
            "type": "EXPENSE_UPDATED",
            "payload": {
                "expense_id": expense_id,
                "company_id": expense.company_id,
            }
        })
    except Exception:
        pass
    return ExpenseOut(
        expense_id=expense.expense_id,
        company_id=expense.company_id,
        company_name=company.company_name if company else None,
        category_id=expense.category_id,
        category_name=category.name if category else "None",
        payment_method=expense.payment_method,
        created_by=expense.created_by,
        expense_date=expense.expense_date,
        reference_no=expense.reference_no,
        cheque_no=expense.cheque_number or expense.cheque_no or (expense.reference_no if not (expense.reference_no or "").startswith("REF-") else None),
        amount=expense.amount,
        amount_paid=expense.amount_paid or Decimal("0.00"),
        unpaid_balance=expense.amount - (expense.amount_paid or Decimal("0.00")),
        particulars=expense.description,
        description=expense.description,
        created_at=expense.created_at,
        updated_at=expense.updated_at,
        remarks=getattr(expense, "remarks", None),
        **audit_fields(expense)
    )


@router.patch("/{expense_id}/remarks", response_model=ExpenseOut, summary="Update operational remarks of an expense")
def update_expense_remarks(
    expense_id: int,
    remarks_in: RemarksUpdate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db)
):
    target_remarks = remarks_in.remarks.strip() if remarks_in.remarks and remarks_in.remarks.strip() else None

    current = _current_expense_row(db, expense_id)
    if not current:
        raise HTTPException(status_code=404, detail="Expense not found")

    existing_company_id = current.get("company_id")
    check_company_access(current_user, existing_company_id)

    try:
        client = get_supabase_admin_client()
        client.table("expenses").update({"remarks": target_remarks}).eq("expense_id", expense_id).execute()
    except Exception as e:
        pass

    expense = db.query(Expense).filter(Expense.expense_id == expense_id).first()
    if expense:
        expense.remarks = target_remarks
        db.commit()
        db.refresh(expense)

    try:
        from app.core.websocket import ws_manager
        ws_manager.broadcast_sync({
            "type": "EXPENSE_UPDATED",
            "payload": {
                "expense_id": expense_id,
                "company_id": existing_company_id,
                "action": "remarks_updated",
                "remarks": target_remarks,
            }
        })
    except Exception:
        pass

    actor_name = current_user.get("full_name") or current_user.get("name") or current_user.get("email") or f"User #{current_user.get('user_id')}"
    log_transaction(
        db, AuditAction.EXPENSE_UPDATED,
        user_id=current_user.get("user_id"), company_id=existing_company_id,
        ip_address=request.client.host if request.client else "unknown",
        record_id=expense_id, record_type="expense",
        extra={"remarks": target_remarks, "actor_name": actor_name},
    )

    return get_expense(expense_id, current_user, db)


@router.patch("/{expense_id}/audit", response_model=ExpenseOut, summary="Save the audit review of an expense (Auditor only)")
def review_expense_audit(
    expense_id: int,
    review_in: AuditReviewIn,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_auditor_user),
    db: Session = Depends(get_db)
):
    apply_audit_review(
        db, current_user,
        model=Expense, pk_column="expense_id", supabase_table="expenses",
        record_id=expense_id, payload=review_in, not_found="Expense not found",
    )
    log_transaction(
        db, AuditAction.EXPENSE_UPDATED,
        user_id=current_user.get("user_id"), company_id=None,
        ip_address=request.client.host if request.client else "unknown",
        record_id=expense_id, record_type="expense_audit_review",
        extra={"audit_status": review_in.audit_status},
    )

    try:
        from app.core.websocket import ws_manager
        ws_manager.broadcast_sync({
            "type": "EXPENSE_UPDATED",
            "payload": {
                "expense_id": expense_id,
                "audit_status": review_in.audit_status,
            }
        })
    except Exception:
        pass
    return get_expense(expense_id, current_user, db)
@router.delete("/{expense_id}", status_code=status.HTTP_200_OK, summary="Delete an expense")
def delete_expense(
    expense_id: int,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db)
):

    deleted_from_supabase = False
    deleted_company_id = None
    deleted_day = None
    client = None
    try:
        client = get_supabase_admin_client()
        existing = client.table("expenses").select("company_id, expense_date").eq("expense_id", expense_id).limit(1).execute()
        if existing.data:
            deleted_company_id = existing.data[0].get("company_id")
            deleted_day = existing.data[0].get("expense_date")
    except Exception as e:
        print(f"Supabase fetch before delete error: {e}")

    expense = db.query(Expense).filter(Expense.expense_id == expense_id).first()
    if expense:
        deleted_company_id = deleted_company_id or expense.company_id
        deleted_day = deleted_day or expense.expense_date

    if not deleted_company_id and not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    check_company_access(current_user, deleted_company_id)

    if client:
        try:
            sb_res = client.table("expenses").delete().eq("expense_id", expense_id).execute()
            if sb_res.data and len(sb_res.data) > 0:
                deleted_from_supabase = True
        except Exception as e:
            print(f"Supabase delete expense error: {e}")

    if expense:
        # Undo the bank debit first, while the expense (and its bank entries) can still be found
        reconcile_expense_bank(db, expense_id=expense_id, force_zero=True)
        db.delete(expense)
        db.commit()
        # The expense is gone, so none of its bank entries (originals or reversals) should remain
        try:
            from app.services.bank_service import BankService
            BankService(db).purge_linked_entries(link_attr="source_expense_id", link_id=expense_id)
        except Exception as e:
            db.rollback()
            print(f"Bank entry purge error on expense delete: {e}")

    # Cascade: the day's expense remark goes once no expense is left on that day
    if deleted_day:
        from app.services.daily_remark_cascade import purge_orphan_daily_remark
        purge_orphan_daily_remark(db, client, "expense", deleted_company_id, deleted_day)

    system_cache.invalidate_tag("petty_cash")

    try:
        log_transaction(
            db, AuditAction.EXPENSE_DELETED,
            user_id=current_user.get("user_id"), company_id=deleted_company_id,
            ip_address=request.client.host if request.client else "unknown",
            record_id=expense_id, record_type="expense",
        )
    except Exception as e:
        print(f"Audit log error on expense delete: {e}")

    try:
        from app.core.websocket import ws_manager
        ws_manager.broadcast_sync({
            "type": "EXPENSE_DELETED",
            "payload": {
                "expense_id": expense_id,
                "company_id": deleted_company_id,
            }
        })
    except Exception:
        pass

    return {
        "message": "Expense deleted successfully",
        "success": True,
        "expense_id": expense_id,
        "supabase_deleted": deleted_from_supabase
    }

