from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from typing import List, Optional
from datetime import date
from decimal import Decimal
from collections import defaultdict
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.session import get_db
from app.db.supabase import get_supabase_admin_client
from app.models.finance import Sale, Category
from app.models.company import Company
from app.schemas.sale import SaleCreate, SaleOut, SaleUpdate, DailySalesSummaryOut, DepositStatusUpdate
from app.schemas.audit_review import AuditReviewIn, audit_fields
from app.services.audit_review_service import apply_audit_review
from app.services.audit_service import AuditAction, log_transaction
from app.services.sales_receivables_sync import (
    SalesReceivablesSyncService,
    compute_paid_amount_from_particulars,
)
from app.core.websocket import ws_manager
from app.api.v1.endpoints.particulars import extract_particular_names, save_company_particular_if_not_exists

router = APIRouter()

from app.core.dependencies import (
    AuditorUser,
    AuthenticatedUser,
    BusinessReader,
    BusinessWriter,
    check_company_access,
    require_auditor_user,
    require_business_reader,
    require_business_writer,
)
from app.core.company_resolver import resolve_company, normalize_company_id
from app.core.cache import get_cached, set_cached


def get_supabase_mappings(client):
    cached = get_cached("supabase_mappings")
    if cached:
        return cached[0], cached[1]

    company_map = {}
    try:
        from app.db.session import SessionLocal
        from app.models.company import Company as CompanyModel
        db = SessionLocal()
        comps = db.query(CompanyModel).all()
        for c in comps:
            if c.company_id and c.company_name:
                company_map[c.company_id] = c.company_name
        db.close()
    except Exception:
        pass

    if not company_map:
        try:
            companies = client.table("company").select("company_id, company_name").execute().data or []
            for c in companies:
                if c.get("company_id") and c.get("company_name"):
                    company_map[c["company_id"]] = c["company_name"]
        except Exception:
            pass

    try:
        categories = client.table("category").select("category_id, name").execute().data or []
        cat_map = {c["category_id"]: c["name"] for c in categories}
    except Exception:
        cat_map = {}

    set_cached("supabase_mappings", (company_map, cat_map), ttl_seconds=600)
    return company_map, cat_map


@router.get("", response_model=List[SaleOut], summary="List sales transactions")
def get_sales(
    company_id: Optional[int] = Query(None, description="Filter by Company ID"),
    company_name: Optional[str] = Query(None, description="Filter by Company Name"),
    category_id: Optional[int] = Query(None, description="Filter by Category ID"),
    start_date: Optional[date] = Query(None, description="Filter from date"),
    end_date: Optional[date] = Query(None, description="Filter to date"),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db)
):
    # Normalize FastAPI Query parameters if called directly in tests/python code
    if hasattr(company_id, "default"):
        company_id = None
    if hasattr(company_name, "default"):
        company_name = None
    if hasattr(category_id, "default"):
        category_id = None
    if hasattr(start_date, "default") or not isinstance(start_date, date):
        start_date = None
    if hasattr(end_date, "default") or not isinstance(end_date, date):
        end_date = None

    is_privileged = (current_user.get("role") or "").lower() in ("finance", "audit", "auditor")
    user_company_ids = current_user.get("company_ids") or []
    if not is_privileged and not user_company_ids and current_user.get("company_id"):
        user_company_ids = [current_user["company_id"]]

    use_sb = SalesReceivablesSyncService(db)._use_supabase()

    try:
        if not use_sb:
            raise RuntimeError("In-memory SQLite session")
        client = get_supabase_admin_client()
        company_map, cat_map = get_supabase_mappings(client)

        sb_query = client.table("sales").select("*")

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
            sb_query = sb_query.gte("transaction_date", start_date.isoformat())
        if end_date:
            sb_query = sb_query.lte("transaction_date", end_date.isoformat())

        res = sb_query.order("transaction_date", desc=True).order("sales_id", desc=True).execute()
        rows = res.data or []

        return [
            SaleOut(
                sales_id=row["sales_id"],
                company_id=row.get("company_id"),
                company_name=company_map.get(row.get("company_id")) or "Unknown Company",
                category_id=row.get("category_id"),
                category_name=cat_map.get(row.get("category_id")) or "None",
                payment_method=row.get("payment_method"),
                payment_status=row.get("payment_status") or "Paid",
                deposit_status=row.get("deposit_status") or ("Deposited" if (row.get("payment_status") or "Paid") == "Paid" else "Not Deposited"),
                transaction_date=row.get("transaction_date"),
                cheque_no=row.get("cheque_number") or row.get("cheque_no") or row.get("reference_no"),
                amount=row.get("amount") or 0.0,
                particulars=row.get("particulars") or row.get("description") or "",
                created_at=row.get("created_at"),
                updated_at=row.get("updated_at"),
                **audit_fields(row)
            )
            for row in rows
        ]
    except HTTPException:
        raise
    except Exception:
        # Fallback to local SQLite if Supabase is unavailable
        query = (
            db.query(
                Sale,
                Company.company_name.label("company_name"),
                Category.name.label("category_name")
            )
            .outerjoin(Company, Sale.company_id == Company.company_id)
            .outerjoin(Category, Sale.category_id == Category.category_id)
        )

        if company_id:
            check_company_access(current_user, company_id)
            query = query.filter(Sale.company_id == company_id)
        elif company_name and company_name.lower() != "all companies":
            try:
                resolved_comp = resolve_company(db, company_name=company_name)
                check_company_access(current_user, resolved_comp.company_id)
                query = query.filter(Sale.company_id == resolved_comp.company_id)
            except HTTPException:
                raise
            except Exception:
                query = query.filter(func.lower(Company.company_name) == func.lower(company_name.strip()))
        elif user_company_ids:
            query = query.filter(Sale.company_id.in_(user_company_ids))
        elif not is_privileged:
            return []

        if category_id:
            query = query.filter(Sale.category_id == category_id)
        if start_date:
            query = query.filter(Sale.transaction_date >= start_date)
        if end_date:
            query = query.filter(Sale.transaction_date <= end_date)

        rows = query.order_by(Sale.transaction_date.desc(), Sale.sales_id.desc()).all()

        return [
            SaleOut(
                sales_id=sale.sales_id,
                company_id=sale.company_id,
                company_name=c_name,
                category_id=sale.category_id,
                category_name=cat_name or "None",
                payment_method=sale.payment_method,
                payment_status=sale.payment_status or "Paid",
                deposit_status=sale.deposit_status or ("Deposited" if (sale.payment_status or "Paid") == "Paid" else "Not Deposited"),
                transaction_date=sale.transaction_date,
                cheque_no=sale.cheque_no,
                amount=sale.amount,
                particulars=sale.particulars or "",
                created_at=sale.created_at,
                updated_at=sale.updated_at,
                **audit_fields(sale)
            )
            for sale, c_name, cat_name in rows
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


@router.get("/daily-summary", response_model=List[DailySalesSummaryOut], summary="Daily sales aggregation summary")
def get_sales_daily_summary(
    company_id: Optional[int] = Query(None, description="Filter by Company ID"),
    company_name: Optional[str] = Query(None, description="Filter by Company Name"),
    category_id: Optional[int] = Query(None, description="Filter by Category ID"),
    start_date: Optional[date] = Query(None, description="Filter from date"),
    end_date: Optional[date] = Query(None, description="Filter to date"),
    status: Optional[str] = Query(None, description="Filter by status"),
    view_type: Optional[str] = Query(None, description="View type ('deposit' or 'sales')"),
    search: Optional[str] = Query(None, description="Search keyword"),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db)
):
    # Normalize FastAPI Query parameters if called directly in tests/python code
    if hasattr(company_id, "default"):
        company_id = None
    if hasattr(company_name, "default"):
        company_name = None
    if hasattr(category_id, "default"):
        category_id = None
    if hasattr(start_date, "default") or not isinstance(start_date, date):
        start_date = None
    if hasattr(end_date, "default") or not isinstance(end_date, date):
        end_date = None

    is_privileged = (current_user.get("role") or "").lower() in ("finance", "audit", "auditor")
    user_company_ids = current_user.get("company_ids") or []
    if not is_privileged and not user_company_ids and current_user.get("company_id"):
        user_company_ids = [current_user["company_id"]]

    use_sb = SalesReceivablesSyncService(db)._use_supabase()
    raw_records = []

    try:
        if not use_sb:
            raise RuntimeError("In-memory SQLite session")
        client = get_supabase_admin_client()

        sb_query = client.table("sales").select("*")

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
            sb_query = sb_query.gte("transaction_date", start_date.isoformat())
        if end_date:
            sb_query = sb_query.lte("transaction_date", end_date.isoformat())

        res = sb_query.order("transaction_date", desc=True).order("sales_id", desc=True).execute()
        rows = res.data or []
        for r in rows:
            raw_records.append({
                "transaction_date": r.get("transaction_date"),
                "amount": r.get("amount") or 0.0,
                "particulars": r.get("particulars") or r.get("description") or "",
                "cheque_no": r.get("cheque_number") or r.get("cheque_no") or r.get("reference_no") or "",
                "audit_status": r.get("audit_status") or "Pending Audit",
                "deposit_status": r.get("deposit_status"),
            })
    except HTTPException:
        raise
    except Exception:
        query = db.query(Sale)
        if company_id:
            check_company_access(current_user, company_id)
            query = query.filter(Sale.company_id == company_id)
        elif company_name and company_name.lower() != "all companies":
            try:
                resolved_comp = resolve_company(db, company_name=company_name)
                check_company_access(current_user, resolved_comp.company_id)
                query = query.filter(Sale.company_id == resolved_comp.company_id)
            except HTTPException:
                raise
            except Exception:
                query = query.join(Company, Sale.company_id == Company.company_id).filter(
                    func.lower(Company.company_name) == func.lower(company_name.strip())
                )
        elif user_company_ids:
            query = query.filter(Sale.company_id.in_(user_company_ids))
        elif not is_privileged:
            return []

        if category_id:
            query = query.filter(Sale.category_id == category_id)
        if start_date:
            query = query.filter(Sale.transaction_date >= start_date)
        if end_date:
            query = query.filter(Sale.transaction_date <= end_date)

        rows = query.order_by(Sale.transaction_date.desc(), Sale.sales_id.desc()).all()
        for s in rows:
            raw_records.append({
                "transaction_date": s.transaction_date,
                "amount": s.amount,
                "particulars": s.particulars or "",
                "cheque_no": s.cheque_no or "",
                "audit_status": s.audit_status or "Pending Audit",
                "deposit_status": s.deposit_status,
            })

    # Group by date
    daily_groups = defaultdict(lambda: {
        "count": 0,
        "gross_total": Decimal("0.00"),
        "realized_cash": Decimal("0.00"),
        "audit_statuses": []
    })

    search_term = (search or "").strip().lower()
    is_deposit_view = (view_type or "").lower() == "deposit"

    for r in raw_records:
        rec_date = _to_date(r["transaction_date"])
        if not rec_date:
            continue

        parts = r["particulars"]
        chq = r["cheque_no"]

        if search_term:
            if search_term not in parts.lower() and search_term not in chq.lower():
                continue

        amt = Decimal(str(r["amount"] or 0))
        dep_raw = r.get("deposit_status")
        # In Scenario A: Only records marked 'Deposited' count toward realized/deposited cash
        if dep_raw is not None and str(dep_raw).strip():
            is_deposited = str(dep_raw).strip().lower() == "deposited"
        else:
            is_deposited = True

        realized = compute_paid_amount_from_particulars(parts, amt) if is_deposited else Decimal("0.00")

        if is_deposit_view and not is_deposited:
            continue

        gross = realized if is_deposit_view else amt

        daily_groups[rec_date]["count"] += 1
        daily_groups[rec_date]["gross_total"] += gross
        daily_groups[rec_date]["realized_cash"] += realized
        daily_groups[rec_date]["audit_statuses"].append(r["audit_status"])

    result = [
        DailySalesSummaryOut(
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



@router.post("", response_model=SaleOut, status_code=status.HTTP_201_CREATED, summary="Record a new sale")
def create_sale(
    sale_in: SaleCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db)
):
    if sale_in.amount < 1.00:
        raise HTTPException(status_code=422, detail="Amount must be at least 1.00 (cannot be 0 or less than 1).")

    if sale_in.transaction_date > date.today():
        raise HTTPException(status_code=400, detail="Transaction date cannot be in the future (maximum date is today).")

    parts = (sale_in.particulars or sale_in.description or "").strip()
    if not parts:
        raise HTTPException(status_code=422, detail="Particulars is required and cannot be blank.")

    cat_str = (sale_in.category or "").strip()
    if not sale_in.category_id and not cat_str:
        raise HTTPException(status_code=422, detail="Category is required and cannot be blank.")

    cheque = (sale_in.cheque_no or sale_in.chequeNo or "").strip() or None
    use_sb = SalesReceivablesSyncService(db)._use_supabase()

    try:
        if not use_sb:
            raise RuntimeError("In-memory SQLite session")
        client = get_supabase_admin_client()
        company_map, cat_map = get_supabase_mappings(client)

        # 1. Resolve Company reliably
        target_company = resolve_company(db, company_id=sale_in.company_id, company_name=sale_in.company)
        target_company_id = target_company.company_id
        target_company_name = target_company.company_name

        check_company_access(current_user, target_company_id)

        # 2. Resolve Category in Supabase
        resolved_category_id = sale_in.category_id
        category_name = "None"
        category_str = (sale_in.category or "").strip()

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
        payment_method_str = (sale_in.payment_method or "").strip() or None
        sb_insert = client.table("sales").insert({
            "company_id": target_company_id,
            "category_id": resolved_category_id,
            "payment_method": payment_method_str,
            "payment_status": sale_in.payment_status or "Paid",
            "deposit_status": sale_in.deposit_status or "Not Deposited",
            "transaction_date": sale_in.transaction_date.isoformat(),
            "cheque_number": cheque,
            "amount": float(sale_in.amount),
            "particulars": parts,
            "audit_status": "Pending Audit",
            "audited_by": None,
            "audited_at": None,
            "audit_remarks": None,
        }).execute()

        if not sb_insert.data:
            raise HTTPException(status_code=500, detail="Failed to insert sale into Supabase.")

        created_row = sb_insert.data[0]
        sb_sales_id = created_row["sales_id"]

        # Also backup to local SQLite
        try:
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

            local_sale = Sale(
                sales_id=sb_sales_id,
                company_id=target_company_id,
                category_id=resolved_category_id,
                payment_method=payment_method_str,
                payment_status=sale_in.payment_status or "Paid",
                deposit_status=sale_in.deposit_status or "Not Deposited",
                transaction_date=sale_in.transaction_date,
                cheque_no=cheque,
                amount=sale_in.amount,
                particulars=parts,
                audit_status="Pending Audit",
                audited_by=None,
                audited_at=None,
                audit_remarks=None,
            )
            db.merge(local_sale)
            db.commit()
        except Exception:
            db.rollback()

        # Credit settled portion to bank account if specified or company account exists
        try:
            from app.services.bank_service import BankService
            paid_portion = compute_paid_amount_from_particulars(parts, sale_in.amount)
            if paid_portion > Decimal("0.00"):
                bank_svc = BankService(db)
                if sale_in.bank_account_id:
                    bank_svc.record_deposit_by_account_id(
                        account_id=sale_in.bank_account_id,
                        amount=paid_portion,
                        particulars=f"Sales Collection: {parts}",
                        reference_no=cheque,
                        tx_date=sale_in.transaction_date.strftime("%m/%d/%y") if hasattr(sale_in.transaction_date, "strftime") else str(sale_in.transaction_date),
                    )
                elif target_company_name:
                    bank_svc.record_sale_cash_deposit(
                        company_name=target_company_name,
                        amount=paid_portion,
                        particulars=f"Sales Collection: {parts}",
                        reference_no=cheque,
                        tx_date=sale_in.transaction_date.strftime("%m/%d/%y") if hasattr(sale_in.transaction_date, "strftime") else str(sale_in.transaction_date),
                    )
                ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"company": target_company_name}})
        except Exception:
            pass

        ws_manager.broadcast_sync(
            {
                "type": "SALES_UPDATED",
                "company_id": target_company_id,
                "payload": {"sale_id": sb_sales_id, "action": "created"},
            }
        )

        # Auto-save particulars to company library
        try:
            for p_name in extract_particular_names(parts):
                save_company_particular_if_not_exists(
                    db, target_company_id, target_company_name, p_name, "Sales"
                )
        except Exception:
            pass

        actor_name = current_user.get("full_name") or current_user.get("name") or current_user.get("email") or f"User #{current_user.get('user_id')}"
        log_transaction(
            db, AuditAction.SALE_CREATED,
            user_id=current_user.get("user_id"), company_id=target_company_id,
            ip_address=request.client.host if request.client else "unknown",
            record_id=sb_sales_id, record_type="sale",
            extra={
                "amount": float(sale_in.amount),
                "transaction_date": sale_in.transaction_date.isoformat(),
                "particulars": parts,
                "actor_name": actor_name,
                "actor_role": current_user.get("role", "Staff"),
            },
        )

        return SaleOut(
            sales_id=created_row["sales_id"],
            company_id=created_row.get("company_id"),
            company_name=target_company_name,
            category_id=created_row.get("category_id"),
            category_name=category_name,
            payment_method=payment_method_str,
            payment_status=created_row.get("payment_status") or sale_in.payment_status or "Paid",
            deposit_status=created_row.get("deposit_status") or sale_in.deposit_status or "Not Deposited",
            transaction_date=created_row.get("transaction_date"),
            cheque_no=created_row.get("cheque_number"),
            amount=created_row.get("amount"),
            particulars=created_row.get("particulars"),
            created_at=created_row.get("created_at"),
            updated_at=created_row.get("updated_at"),
            **audit_fields(created_row)
        )

    except HTTPException:
        raise
    except Exception:
        # Fallback to local SQLite only if Supabase error occurs
        target_company = resolve_company(db, company_id=sale_in.company_id, company_name=sale_in.company)
        check_company_access(current_user, target_company.company_id)

        sale = Sale(
            company_id=target_company.company_id,
            category_id=sale_in.category_id,
            payment_method=(sale_in.payment_method or "").strip() or None,
            payment_status=sale_in.payment_status or "Paid",
            deposit_status=sale_in.deposit_status or "Not Deposited",
            transaction_date=sale_in.transaction_date,
            cheque_no=cheque,
            amount=sale_in.amount,
            particulars=parts,
            audit_status="Pending Audit",
            audited_by=None,
            audited_at=None,
            audit_remarks=None,
        )
        db.add(sale)
        db.commit()
        db.refresh(sale)

        # Auto-credit settled portion to company bank account
        try:
            from app.services.bank_service import BankService
            paid_portion = compute_paid_amount_from_particulars(parts, sale.amount)
            if paid_portion > Decimal("0.00"):
                bank_svc = BankService(db)
                if sale_in.bank_account_id:
                    bank_svc.record_deposit_by_account_id(
                        account_id=sale_in.bank_account_id,
                        amount=paid_portion,
                        particulars=f"Sales Collection: {sale.particulars}",
                        reference_no=cheque,
                        tx_date=sale.transaction_date.strftime("%m/%d/%y") if hasattr(sale.transaction_date, "strftime") else str(sale.transaction_date),
                    )
                else:
                    bank_svc.record_sale_cash_deposit(
                        company_name=target_company.company_name,
                        amount=paid_portion,
                        particulars=f"Sales Collection: {sale.particulars}",
                        reference_no=cheque,
                        tx_date=sale.transaction_date.strftime("%m/%d/%y") if hasattr(sale.transaction_date, "strftime") else str(sale.transaction_date),
                    )
                ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"company": target_company.company_name}})
        except Exception:
            pass

        ws_manager.broadcast_sync(
            {
                "type": "SALES_UPDATED",
                "company_id": sale.company_id,
                "payload": {"sale_id": sale.sales_id, "action": "created"},
            }
        )

        # Auto-save particulars to company library
        try:
            for p_name in extract_particular_names(parts):
                save_company_particular_if_not_exists(
                    db, target_company.company_id, target_company.company_name, p_name, "Sales"
                )
        except Exception:
            pass

        actor_name = current_user.get("full_name") or current_user.get("name") or current_user.get("email") or f"User #{current_user.get('user_id')}"
        log_transaction(
            db, AuditAction.SALE_CREATED,
            user_id=current_user.get("user_id"), company_id=target_company.company_id,
            ip_address=request.client.host if request.client else "unknown",
            record_id=sale.sales_id, record_type="sale",
            extra={
                "amount": float(sale.amount),
                "transaction_date": sale_in.transaction_date.isoformat(),
                "particulars": parts,
                "actor_name": actor_name,
                "actor_role": current_user.get("role", "Staff"),
            },
        )

        return SaleOut(
            sales_id=sale.sales_id,
            company_id=sale.company_id,
            company_name=target_company.company_name,
            category_id=sale.category_id,
            category_name="None",
            payment_method=sale.payment_method,
            payment_status=sale.payment_status or "Paid",
            deposit_status=sale.deposit_status or "Not Deposited",
            transaction_date=sale.transaction_date,
            cheque_no=sale.cheque_no,
            amount=sale.amount,
            particulars=sale.particulars,
            created_at=sale.created_at,
            updated_at=sale.updated_at,
            **audit_fields(sale)
        )


@router.get("/{sales_id}", response_model=SaleOut, summary="Get sale details")
def get_sale(
    sales_id: int,
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db)
):
    use_sb = SalesReceivablesSyncService(db)._use_supabase()
    if use_sb:
        try:
            client = get_supabase_admin_client()
            company_map, cat_map = get_supabase_mappings(client)
            res = client.table("sales").select("*").eq("sales_id", sales_id).execute()
            if res.data:
                row = res.data[0]
                check_company_access(current_user, row.get("company_id"))
                return SaleOut(
                    sales_id=row["sales_id"],
                    company_id=row.get("company_id"),
                    company_name=company_map.get(row.get("company_id")) or "Unknown",
                    category_id=row.get("category_id"),
                    category_name=cat_map.get(row.get("category_id")) or "None",
                    payment_method=row.get("payment_method"),
                    payment_status=row.get("payment_status") or "Paid",
                    deposit_status=row.get("deposit_status") or ("Deposited" if (row.get("payment_status") or "Paid") == "Paid" else "Not Deposited"),
                    transaction_date=row.get("transaction_date"),
                    cheque_no=row.get("cheque_number") or row.get("cheque_no"),
                    amount=row.get("amount") or 0.0,
                    particulars=row.get("particulars") or "",
                    created_at=row.get("created_at"),
                    updated_at=row.get("updated_at"),
                    **audit_fields(row)
                )
        except HTTPException:
            raise
        except Exception:
            pass

    result = (
        db.query(
            Sale,
            Company.company_name.label("company_name"),
            Category.name.label("category_name")
        )
        .outerjoin(Company, Sale.company_id == Company.company_id)
        .outerjoin(Category, Sale.category_id == Category.category_id)
        .filter(Sale.sales_id == sales_id)
        .first()
    )
    if not result:
        raise HTTPException(status_code=404, detail="Sale not found")
    sale, c_name, cat_name = result
    check_company_access(current_user, sale.company_id)
    return SaleOut(
        sales_id=sale.sales_id,
        company_id=sale.company_id,
        company_name=c_name,
        category_id=sale.category_id,
        category_name=cat_name or "None",
        payment_method=sale.payment_method,
        payment_status=sale.payment_status or "Paid",
        deposit_status=sale.deposit_status or ("Deposited" if (sale.payment_status or "Paid") == "Paid" else "Not Deposited"),
        transaction_date=sale.transaction_date,
        cheque_no=sale.cheque_no,
        amount=sale.amount,
        particulars=sale.particulars or "",
        created_at=sale.created_at,
        updated_at=sale.updated_at,
        **audit_fields(sale)
    )


@router.put("/{sales_id}", response_model=SaleOut, summary="Update an existing sale")
@router.patch("/{sales_id}", response_model=SaleOut, summary="Update an existing sale")
def update_sale(
    sales_id: int,
    sale_in: SaleUpdate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db)
):
    if sale_in.amount is not None and sale_in.amount < 1.00:
        raise HTTPException(status_code=422, detail="Amount must be at least 1.00 (cannot be 0 or less than 1).")

    if sale_in.transaction_date is not None and sale_in.transaction_date > date.today():
        raise HTTPException(status_code=400, detail="Transaction date cannot be in the future (maximum date is today).")

    existing_company_id = None
    existing_audit_status = None
    old_particulars = None
    old_amount = None
    existing_payment_method = None
    existing_payment_status = None
    existing_deposit_status = None
    existing_cheque_no = None
    sync_svc = SalesReceivablesSyncService(db)
    use_sb = sync_svc._use_supabase()
    client = None

    if use_sb:
        try:
            client = get_supabase_admin_client()
            res = (
                client.table("sales")
                .select("company_id, audit_status, particulars, amount, payment_method, payment_status, deposit_status, cheque_number")
                .eq("sales_id", sales_id)
                .limit(1)
                .execute()
            )
            if res.data:
                sb_existing = res.data[0]
                existing_company_id = sb_existing.get("company_id")
                existing_audit_status = sb_existing.get("audit_status")
                old_particulars = sb_existing.get("particulars")
                old_amount = sb_existing.get("amount")
                existing_payment_method = sb_existing.get("payment_method")
                existing_payment_status = sb_existing.get("payment_status")
                existing_deposit_status = sb_existing.get("deposit_status")
                existing_cheque_no = sb_existing.get("cheque_number") or sb_existing.get("cheque_no")
        except Exception:
            pass

    existing_local = db.query(Sale).filter(Sale.sales_id == sales_id).first()
    if existing_local:
        existing_company_id = existing_company_id or existing_local.company_id
        existing_audit_status = existing_audit_status or existing_local.audit_status
        if old_particulars is None:
            old_particulars = existing_local.particulars
        if old_amount is None:
            old_amount = existing_local.amount
        if existing_payment_method is None:
            existing_payment_method = existing_local.payment_method
        if existing_payment_status is None:
            existing_payment_status = existing_local.payment_status
        if existing_deposit_status is None:
            existing_deposit_status = existing_local.deposit_status
        if existing_cheque_no is None:
            existing_cheque_no = existing_local.cheque_no

    if existing_company_id:
        check_company_access(current_user, existing_company_id)

    if (existing_audit_status or "").strip().lower() == "verified":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This sale has been Verified by an Auditor and is locked as read-only.",
        )

    new_payment_status = sale_in.payment_status if sale_in.payment_status is not None else (existing_payment_status or "Paid")
    new_payment_method = (
        (sale_in.payment_method or "").strip()
        if sale_in.payment_method is not None
        else (existing_payment_method or "")
    )
    cheque = sale_in.cheque_no if sale_in.cheque_no is not None else sale_in.chequeNo
    new_cheque_no = (
        cheque.strip()
        if cheque is not None
        else (existing_cheque_no or "")
    )

    # AC-5: If payment status reverts to Unpaid or non-cheque Pending, auto reset deposit status to 'Not Deposited'
    is_pending_non_cheque = (new_payment_status == "Pending" and (new_payment_method.lower() != "cheque" or not new_cheque_no))
    if new_payment_status == "Unpaid" or is_pending_non_cheque:
        if sale_in.deposit_status is not None and sale_in.deposit_status == "Deposited":
            if new_payment_status == "Unpaid":
                raise HTTPException(
                    status_code=422,
                    detail="Unpaid sales cannot be marked as deposited. Please mark payment status as Paid first."
                )
            else:
                raise HTTPException(
                    status_code=422,
                    detail="Pending sales cannot be marked as deposited unless the payment method is Cheque and physically deposited awaiting clearance."
                )
        else:
            new_deposit_status = "Not Deposited"
    else:
        new_deposit_status = (
            sale_in.deposit_status
            if sale_in.deposit_status is not None
            else (existing_deposit_status or "Deposited")
        )

    # Invariant safety enforcement (AC-3, AC-4)
    if new_payment_status == "Unpaid" and new_deposit_status == "Deposited":
        raise HTTPException(
            status_code=422,
            detail="Unpaid sales cannot be marked as deposited. Please mark payment status as Paid first."
        )
    if new_payment_status == "Pending" and new_deposit_status == "Deposited":
        if new_payment_method.lower() != "cheque" or not new_cheque_no:
            raise HTTPException(
                status_code=422,
                detail="Pending sales cannot be marked as deposited unless the payment method is Cheque and physically deposited awaiting clearance."
            )

    update_payload = {
        "payment_status": new_payment_status,
        "deposit_status": new_deposit_status,
    }
    if sale_in.transaction_date:
        update_payload["transaction_date"] = sale_in.transaction_date.isoformat()
    if sale_in.amount is not None:
        update_payload["amount"] = float(sale_in.amount)
    parts = sale_in.particulars or sale_in.description
    if parts is not None:
        update_payload["particulars"] = parts.strip()
    if cheque is not None:
        update_payload["cheque_number"] = cheque.strip() if cheque.strip() else None

    # Update in Supabase
    updated_row = None
    if use_sb:
        try:
            client = client or get_supabase_admin_client()
            company_map, cat_map = get_supabase_mappings(client)

            category_str = (sale_in.category or "").strip()
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
            elif sale_in.category_id is not None:
                update_payload["category_id"] = sale_in.category_id

            if sale_in.payment_method is not None:
                update_payload["payment_method"] = (sale_in.payment_method or "").strip() or None

            if update_payload:
                sb_res = client.table("sales").update(update_payload).eq("sales_id", sales_id).execute()
                if sb_res.data:
                    updated_row = sb_res.data[0]
        except Exception as e:
            print(f"Supabase update error: {e}")
    else:
        if sale_in.category_id is not None:
            update_payload["category_id"] = sale_in.category_id
        if sale_in.payment_method is not None:
            update_payload["payment_method"] = (sale_in.payment_method or "").strip() or None

    # Also update in local SQLite
    sale = db.query(Sale).filter(Sale.sales_id == sales_id).first()
    if sale:
        if "transaction_date" in update_payload:
            sale.transaction_date = sale_in.transaction_date
        if "amount" in update_payload:
            sale.amount = sale_in.amount
        if "particulars" in update_payload:
            sale.particulars = update_payload["particulars"]
        if "cheque_number" in update_payload:
            sale.cheque_no = update_payload["cheque_number"]
        if "category_id" in update_payload:
            sale.category_id = update_payload["category_id"]
        if "payment_method" in update_payload:
            sale.payment_method = update_payload["payment_method"]
        if "payment_status" in update_payload:
            sale.payment_status = update_payload["payment_status"]
        if "deposit_status" in update_payload:
            sale.deposit_status = update_payload["deposit_status"]
        db.commit()
        db.refresh(sale)

    if not updated_row and not sale:
        raise HTTPException(status_code=404, detail="Sale not found")

    final_particulars = (
        (updated_row.get("particulars") if updated_row else None)
        if updated_row is not None and updated_row.get("particulars") is not None
        else (sale.particulars if sale else (old_particulars or ""))
    ) or ""
    final_amount = (
        updated_row.get("amount")
        if updated_row is not None and updated_row.get("amount") is not None
        else (sale.amount if sale else old_amount)
    )
    final_tx_date = sale_in.transaction_date or (sale.transaction_date if sale else None)
    final_payment_method = (
        update_payload.get("payment_method")
        if "payment_method" in update_payload
        else existing_payment_method
    )
    actor_email = current_user.get("email") or f"user-{current_user.get('user_id')}"

    # Auto-save updated particulars to company library
    if final_particulars:
        try:
            for p_name in extract_particular_names(final_particulars):
                save_company_particular_if_not_exists(
                    db, existing_company_id, None, p_name, "Sales"
                )
        except Exception:
            pass

    sync_svc.sync_sale_updated_to_receivables(
        sales_id,
        new_particulars=final_particulars,
        new_amount=final_amount,
        new_tx_date=final_tx_date,
        new_payment_method=final_payment_method,
        old_particulars=old_particulars,
        old_amount=old_amount,
        company_id=existing_company_id,
        actor_name=actor_email,
    )

    if sale:
        db.refresh(sale)
    if updated_row and use_sb and client is not None:
        try:
            refreshed = client.table("sales").select("*").eq("sales_id", sales_id).limit(1).execute()
            if refreshed.data:
                updated_row = refreshed.data[0]
        except Exception:
            pass

    actor_name = current_user.get("full_name") or current_user.get("name") or current_user.get("email") or f"User #{current_user.get('user_id')}"
    changes_dict = {k: str(v) for k, v in update_payload.items()}

    if updated_row:
        client = client or get_supabase_admin_client()
        company_map, cat_map = get_supabase_mappings(client)
        log_transaction(
            db, AuditAction.SALE_UPDATED,
            user_id=current_user.get("user_id"), company_id=updated_row.get("company_id"),
            ip_address=request.client.host if request.client else "unknown",
            record_id=sales_id, record_type="sale",
            extra={"changes": changes_dict, "actor_name": actor_name, "actor_role": current_user.get("role", "Staff")},
        )
        return SaleOut(
            sales_id=updated_row["sales_id"],
            company_id=updated_row.get("company_id"),
            company_name=company_map.get(updated_row.get("company_id")) or "Unknown",
            category_id=updated_row.get("category_id"),
            category_name=cat_map.get(updated_row.get("category_id")) or "None",
            payment_method=updated_row.get("payment_method"),
            payment_status=updated_row.get("payment_status") or new_payment_status,
            deposit_status=updated_row.get("deposit_status") or new_deposit_status,
            transaction_date=updated_row.get("transaction_date"),
            cheque_no=updated_row.get("cheque_number") or updated_row.get("cheque_no"),
            amount=updated_row.get("amount"),
            particulars=updated_row.get("particulars"),
            created_at=updated_row.get("created_at"),
            updated_at=updated_row.get("updated_at"),
            **audit_fields(updated_row)
        )

    company = db.query(Company).filter(Company.company_id == sale.company_id).first()
    category = db.query(Category).filter(Category.category_id == sale.category_id).first() if sale.category_id else None

    log_transaction(
        db, AuditAction.SALE_UPDATED,
        user_id=current_user.get("user_id"), company_id=sale.company_id,
        ip_address=request.client.host if request.client else "unknown",
        record_id=sales_id, record_type="sale",
        extra={"changes": changes_dict, "actor_name": actor_name, "actor_role": current_user.get("role", "Staff")},
    )
    return SaleOut(
        sales_id=sale.sales_id,
        company_id=sale.company_id,
        company_name=company.company_name if company else None,
        category_id=sale.category_id,
        category_name=category.name if category else "None",
        payment_method=sale.payment_method,
        payment_status=sale.payment_status or "Paid",
        deposit_status=sale.deposit_status or ("Deposited" if (sale.payment_status or "Paid") == "Paid" else "Not Deposited"),
        transaction_date=sale.transaction_date,
        cheque_no=sale.cheque_no,
        amount=sale.amount,
        particulars=sale.particulars,
        created_at=sale.created_at,
        updated_at=sale.updated_at,
        **audit_fields(sale)
    )


@router.patch("/{sales_id}/deposit-status", response_model=SaleOut, summary="Quick toggle sale deposit status")
def update_sale_deposit_status(
    sales_id: int,
    deposit_in: DepositStatusUpdate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db)
):
    target_deposit_status = deposit_in.deposit_status

    existing_company_id = None
    existing_audit_status = None
    existing_payment_status = None
    existing_payment_method = None
    existing_cheque_no = None

    sync_svc = SalesReceivablesSyncService(db)
    use_sb = sync_svc._use_supabase()
    client = None

    if use_sb:
        try:
            client = get_supabase_admin_client()
            res = (
                client.table("sales")
                .select("company_id, audit_status, payment_status, payment_method, cheque_number, cheque_no")
                .eq("sales_id", sales_id)
                .limit(1)
                .execute()
            )
            if res.data:
                sb_existing = res.data[0]
                existing_company_id = sb_existing.get("company_id")
                existing_audit_status = sb_existing.get("audit_status")
                existing_payment_status = sb_existing.get("payment_status")
                existing_payment_method = sb_existing.get("payment_method")
                existing_cheque_no = sb_existing.get("cheque_number") or sb_existing.get("cheque_no")
        except Exception:
            pass

    existing_local = db.query(Sale).filter(Sale.sales_id == sales_id).first()
    if existing_local:
        existing_company_id = existing_company_id or existing_local.company_id
        existing_audit_status = existing_audit_status or existing_local.audit_status
        existing_payment_status = existing_payment_status or existing_local.payment_status
        existing_payment_method = existing_payment_method or existing_local.payment_method
        existing_cheque_no = existing_cheque_no or existing_local.cheque_no

    if not existing_company_id and not existing_local:
        raise HTTPException(status_code=404, detail="Sale not found")

    check_company_access(current_user, existing_company_id)

    if (existing_audit_status or "").strip().lower() == "verified":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This sale has been Verified by an Auditor and is locked as read-only.",
        )

    cur_payment_status = (existing_payment_status or "Paid").strip()
    cur_payment_method = (existing_payment_method or "").strip().lower()
    cur_cheque_no = (existing_cheque_no or "").strip()

    # AC-3 and AC-4 validation
    if target_deposit_status == "Deposited":
        if cur_payment_status == "Unpaid":
            raise HTTPException(
                status_code=422,
                detail="Unpaid sales cannot be marked as deposited. Please mark payment status as Paid first."
            )
        elif cur_payment_status == "Pending":
            if cur_payment_method != "cheque" or not cur_cheque_no:
                raise HTTPException(
                    status_code=422,
                    detail="Pending sales cannot be marked as deposited unless the payment method is Cheque and physically deposited awaiting clearance."
                )

    # Persist update in Supabase
    if use_sb and client is not None:
        try:
            client.table("sales").update({"deposit_status": target_deposit_status}).eq("sales_id", sales_id).execute()
        except Exception as e:
            pass

    if existing_local:
        existing_local.deposit_status = target_deposit_status
        db.commit()
        db.refresh(existing_local)

    ws_manager.broadcast_sync(
        {
            "type": "SALES_UPDATED",
            "company_id": existing_company_id,
            "payload": {"sale_id": sales_id, "action": "deposit_status_updated", "deposit_status": target_deposit_status},
        }
    )

    log_transaction(
        db, AuditAction.SALE_UPDATED,
        user_id=current_user.get("user_id"), company_id=existing_company_id,
        ip_address=request.client.host if request.client else "unknown",
        record_id=sales_id, record_type="sale",
        extra={"deposit_status": target_deposit_status},
    )

    return get_sale(sales_id, current_user, db)


@router.patch("/{sales_id}/audit", response_model=SaleOut, summary="Save the audit review of a sale (Auditor only)")
def review_sale_audit(
    sales_id: int,
    review_in: AuditReviewIn,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_auditor_user),
    db: Session = Depends(get_db)
):
    apply_audit_review(
        db, current_user,
        model=Sale, pk_column="sales_id", supabase_table="sales",
        record_id=sales_id, payload=review_in, not_found="Sale not found",
    )
    SalesReceivablesSyncService(db).broadcast_sync_events(
        sale_id=sales_id,
        action=f"audit_{review_in.audit_status}",
        emit_sales=True,
        emit_receivables=True,
    )
    log_transaction(
        db, AuditAction.SALE_UPDATED,
        user_id=current_user.get("user_id"), company_id=None,
        ip_address=request.client.host if request.client else "unknown",
        record_id=sales_id, record_type="sale_audit_review",
        extra={"audit_status": review_in.audit_status},
    )
    return get_sale(sales_id, current_user, db)


@router.delete("/{sales_id}", status_code=status.HTTP_200_OK, summary="Delete a sale")
def delete_sale(
    sales_id: int,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db)
):
    deleted_from_supabase = False
    deleted_company_id = None
    existing_audit_status = None
    sync_svc = SalesReceivablesSyncService(db)
    use_sb = sync_svc._use_supabase()
    client = None

    if use_sb:
        try:
            client = get_supabase_admin_client()
            existing = (
                client.table("sales")
                .select("company_id, audit_status")
                .eq("sales_id", sales_id)
                .limit(1)
                .execute()
            )
            if existing.data:
                deleted_company_id = existing.data[0].get("company_id")
                existing_audit_status = existing.data[0].get("audit_status")
        except Exception as e:
            print(f"Supabase fetch before delete error: {e}")

    sale = db.query(Sale).filter(Sale.sales_id == sales_id).first()
    if sale:
        deleted_company_id = deleted_company_id or sale.company_id
        existing_audit_status = existing_audit_status or sale.audit_status

    if not deleted_company_id and not sale:
        raise HTTPException(status_code=404, detail="Sale not found")

    check_company_access(current_user, deleted_company_id)

    if (existing_audit_status or "").strip().lower() == "verified":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This sale has been Verified by an Auditor and cannot be deleted.",
        )

    # Cascade delete linked receivables and reverse bank deposits before removing parent sale
    sync_svc.sync_sale_deleted_to_receivables(sales_id, company_id=deleted_company_id)

    if client:
        try:
            sb_res = client.table("sales").delete().eq("sales_id", sales_id).execute()
            if sb_res.data and len(sb_res.data) > 0:
                deleted_from_supabase = True
        except Exception as e:
            print(f"Supabase delete error: {e}")

    sale = db.query(Sale).filter(Sale.sales_id == sales_id).first()
    if sale:
        db.delete(sale)
        db.commit()

    try:
        log_transaction(
            db, AuditAction.SALE_DELETED,
            user_id=current_user.get("user_id"), company_id=deleted_company_id,
            ip_address=request.client.host if request.client else "unknown",
            record_id=sales_id, record_type="sale",
        )
    except Exception as e:
        print(f"Audit log error on sale delete: {e}")

    return {
        "message": "Sale deleted successfully",
        "success": True,
        "sales_id": sales_id,
        "supabase_deleted": deleted_from_supabase
    }
