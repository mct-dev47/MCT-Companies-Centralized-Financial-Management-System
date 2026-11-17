from __future__ import annotations
import calendar
import time
from datetime import date
from typing import Optional, Dict, Any, List, Tuple
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy import case, func, or_, desc
from sqlalchemy.orm import Session

from app.core.dependencies import (
    AuthenticatedUser,
    require_business_reader,
    check_company_access,
    get_authorized_company_scope,
)
from app.core.company_resolver import resolve_company, normalize_company_id
from app.core.cache import system_cache
from app.db.session import get_db
from app.models.company import Company
from app.models.finance import Sale, Expense, Category, CompanyCategory
from app.models.bills import Bill
from app.models.loan import Loan
from app.schemas.dashboard import (
    DashboardSummaryResponse,
    DashboardMetricSummary,
    MonthlyProfitLossItem,
    CategoryBreakdownItem,
    DashboardTransactionOut,
)

router = APIRouter()

# 60-second in-memory server cache to minimize database/Supabase load
CACHE_TTL_SECONDS = 60


def invalidate_dashboard_cache() -> None:
    system_cache.invalidate_tag("dashboard")


def _format_month_label(ym: str) -> Tuple[str, str]:
    """Given 'YYYY-MM', returns ('Oct 2026', 'Oct \'26')."""
    try:
        parts = ym.split("-")
        y = int(parts[0])
        m = int(parts[1])
        name = calendar.month_abbr[m]
        return f"{name} {y}", f"{name} '{str(y)[-2:]}"
    except Exception:
        return ym, ym


@router.get(
    "/summary",
    response_model=DashboardSummaryResponse,
    summary="Get optimized real dashboard summary metrics and charts",
)
def get_dashboard_summary(
    company_id: Optional[int] = Query(None, description="Optional Company ID"),
    company_name: Optional[str] = Query(None, description="Optional Company Name"),
    start_date: Optional[date] = Query(None, description="Filter start date"),
    end_date: Optional[date] = Query(None, description="Filter end date"),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
) -> DashboardSummaryResponse:
    # Normalize FastAPI Query parameters if called directly in tests/python code
    if hasattr(company_id, "default"):
        company_id = None
    if hasattr(company_name, "default"):
        company_name = None
    if hasattr(start_date, "default") or not isinstance(start_date, date):
        start_date = None
    if hasattr(end_date, "default") or not isinstance(end_date, date):
        end_date = None

    # 1. Resolve company scope
    target_cid = None
    target_cname = "All Authorized Companies"

    if company_id:
        target_cid = normalize_company_id(company_id)
        check_company_access(current_user, target_cid)
        comp = db.query(Company).filter(Company.company_id == target_cid).first()
        if comp:
            target_cname = comp.company_name
    elif company_name and company_name.strip().lower() != "all companies":
        resolved_comp = resolve_company(db, company_name=company_name)
        target_cid = resolved_comp.company_id
        target_cname = resolved_comp.company_name
        check_company_access(current_user, target_cid)

    authorized_cids = get_authorized_company_scope(current_user, target_cid)

    # If scoped to specific companies
    if authorized_cids is not None:
        if not authorized_cids:
            return DashboardSummaryResponse(
                company_name=target_cname,
                company_id=target_cid,
                metrics=DashboardMetricSummary(),
                monthly_pnl=[],
                income_categories=[],
                expense_categories=[],
                recent_transactions=[],
            )
        scoped_ids = authorized_cids
    else:
        # User is admin/audit/owner with all-company access
        scoped_ids = None

    # Resolve display company name if single company
    if scoped_ids and len(scoped_ids) == 1:
        comp = db.query(Company).filter(Company.company_id == scoped_ids[0]).first()
        if comp:
            target_cname = comp.company_name
            target_cid = comp.company_id

    # 2. Check 60s in-memory server cache
    sorted_ids = tuple(sorted(scoped_ids)) if scoped_ids is not None else "ALL"
    cache_key = f"dashboard:{sorted_ids}_{start_date}_{end_date}"
    cached_val = system_cache.get(cache_key)
    if cached_val is not None:
        return cached_val

    # 3. Build optimized SQL aggregate queries
    dialect_name = db.bind.dialect.name if db.bind else "sqlite"
    month_fn_sales = (
        func.to_char(Sale.transaction_date, "YYYY-MM")
        if dialect_name == "postgresql"
        else func.strftime("%Y-%m", Sale.transaction_date)
    )
    month_fn_expense = (
        func.to_char(Expense.expense_date, "YYYY-MM")
        if dialect_name == "postgresql"
        else func.strftime("%Y-%m", Expense.expense_date)
    )

    # Base filters
    sales_filters = []
    expense_filters = []
    bills_filters = []
    loans_filters = []

    if scoped_ids:
        sales_filters.append(Sale.company_id.in_(scoped_ids))
        expense_filters.append(Expense.company_id.in_(scoped_ids))
        bills_filters.append(Bill.company_id.in_(scoped_ids))
        loans_filters.append(or_(Loan.borrower.in_(scoped_ids), Loan.lender.in_(scoped_ids)))

    if start_date:
        sales_filters.append(Sale.transaction_date >= start_date)
        expense_filters.append(Expense.expense_date >= start_date)
    if end_date:
        sales_filters.append(Sale.transaction_date <= end_date)
        expense_filters.append(Expense.expense_date <= end_date)

    # Aggregate: Sales total + flagged/overdue + pending in a single pass
    sales_agg = db.query(
        func.coalesce(func.sum(Sale.amount), 0.0),
        func.coalesce(func.sum(case((or_(Sale.audit_status == "Flagged", Sale.payment_status == "Overdue"), 1), else_=0)), 0),
        func.coalesce(func.sum(case((Sale.payment_status == "Pending", 1), else_=0)), 0),
    ).filter(*sales_filters).first()
    total_sales_val = float(sales_agg[0] or 0.0) if sales_agg else 0.0
    flagged_sales_count = int(sales_agg[1] or 0) if sales_agg else 0
    pending_sales = int(sales_agg[2] or 0) if sales_agg else 0

    # Aggregate: Expenses total + flagged in a single pass
    exp_agg = db.query(
        func.coalesce(func.sum(Expense.amount), 0.0),
        func.coalesce(func.sum(case((Expense.audit_status == "Flagged", 1), else_=0)), 0),
    ).filter(*expense_filters).first()
    total_expense_val = float(exp_agg[0] or 0.0) if exp_agg else 0.0
    flagged_expense_count = int(exp_agg[1] or 0) if exp_agg else 0

    # Aggregate: Bills overdue + unpaid in a single pass
    bills_agg = db.query(
        func.coalesce(func.sum(case((func.lower(Bill.status) == "overdue", 1), else_=0)), 0),
        func.coalesce(func.sum(case((func.lower(Bill.status) == "unpaid", 1), else_=0)), 0),
    ).filter(*bills_filters).first()
    overdue_bills_count = int(bills_agg[0] or 0) if bills_agg else 0
    pending_bills = int(bills_agg[1] or 0) if bills_agg else 0

    # Aggregate: Loans overdue + pending in a single pass
    loans_agg = db.query(
        func.coalesce(func.sum(case((func.lower(Loan.status) == "overdue", 1), else_=0)), 0),
        func.coalesce(func.sum(case((func.lower(Loan.status).like("pending%"), 1), else_=0)), 0),
    ).filter(*loans_filters).first()
    overdue_loans_count = int(loans_agg[0] or 0) if loans_agg else 0
    pending_loans = int(loans_agg[1] or 0) if loans_agg else 0

    overdue_total = flagged_sales_count + flagged_expense_count + overdue_bills_count + overdue_loans_count
    due_soon_total = pending_sales + pending_bills + pending_loans

    # Aggregate: Petty Cash Balance
    if scoped_ids:
        petty_balance = db.query(func.coalesce(func.sum(Company.petty_cash), 0.0)).filter(
            Company.company_id.in_(scoped_ids)
        ).scalar() or 0.0
    else:
        petty_balance = db.query(func.coalesce(func.sum(Company.petty_cash), 0.0)).scalar() or 0.0

    # Monthly P&L grouped by month
    monthly_income_rows = db.query(
        month_fn_sales.label("ym"),
        func.coalesce(func.sum(Sale.amount), 0.0).label("total")
    ).filter(*sales_filters).group_by(month_fn_sales).all()

    monthly_expense_rows = db.query(
        month_fn_expense.label("ym"),
        func.coalesce(func.sum(Expense.amount), 0.0).label("total")
    ).filter(*expense_filters).group_by(month_fn_expense).all()

    month_income_map = {r.ym: float(r.total) for r in monthly_income_rows if r.ym}
    month_expense_map = {r.ym: float(r.total) for r in monthly_expense_rows if r.ym}
    all_months = sorted(set(list(month_income_map.keys()) + list(month_expense_map.keys())))

    monthly_pnl: List[MonthlyProfitLossItem] = []
    for ym in all_months:
        inc = month_income_map.get(ym, 0.0)
        exp = month_expense_map.get(ym, 0.0)
        label, short_label = _format_month_label(ym)
        monthly_pnl.append(
            MonthlyProfitLossItem(
                key=ym,
                label=label,
                short_label=short_label,
                income=inc,
                expenses=exp,
                profit=inc - exp,
            )
        )

    # Category summaries: strictly scoped to the company's real categories in company_categories
    comp_cat_query = db.query(
        CompanyCategory.category_type,
        CompanyCategory.name,
    )
    if scoped_ids:
        comp_cat_query = comp_cat_query.filter(CompanyCategory.company_id.in_(scoped_ids))
    comp_cat_rows = comp_cat_query.order_by(CompanyCategory.name).all()

    valid_sales_cats: Dict[str, str] = {}
    valid_expense_cats: Dict[str, str] = {}
    for ctype, cname in comp_cat_rows:
        cleaned_name = (cname or "").strip()
        if not cleaned_name:
            continue
        norm_type = (ctype or "").strip().lower()
        key = cleaned_name.lower()
        if norm_type == "sales" and key not in valid_sales_cats:
            valid_sales_cats[key] = cleaned_name
        elif norm_type == "expense" and key not in valid_expense_cats:
            valid_expense_cats[key] = cleaned_name

    # Income category breakdown (only if company has created sales categories)
    income_categories: List[CategoryBreakdownItem] = []
    if valid_sales_cats:
        cat_sales_rows = (
            db.query(
                Category.name.label("cat_name"),
                func.coalesce(func.sum(Sale.amount), 0.0).label("cat_total"),
            )
            .join(Category, Sale.category_id == Category.category_id)
            .filter(*sales_filters)
            .group_by(Category.name)
            .all()
        )
        sales_totals_by_key: Dict[str, float] = {}
        for r in cat_sales_rows:
            if r.cat_name:
                k = r.cat_name.strip().lower()
                sales_totals_by_key[k] = sales_totals_by_key.get(k, 0.0) + float(r.cat_total or 0.0)

        categorized_sales_total = sum(
            sales_totals_by_key.get(k, 0.0) for k in valid_sales_cats
        )
        for k, canonical_name in valid_sales_cats.items():
            amount = sales_totals_by_key.get(k, 0.0)
            pct = (amount / categorized_sales_total * 100.0) if categorized_sales_total > 0 else 0.0
            income_categories.append(
                CategoryBreakdownItem(
                    category=canonical_name,
                    amount=amount,
                    percentage=round(pct, 1),
                )
            )
        income_categories.sort(key=lambda item: (-item.amount, item.category.lower()))

    # Expense category breakdown (only if company has created expense categories)
    expense_categories: List[CategoryBreakdownItem] = []
    if valid_expense_cats:
        cat_exp_rows = (
            db.query(
                Category.name.label("cat_name"),
                func.coalesce(func.sum(Expense.amount), 0.0).label("cat_total"),
            )
            .join(Category, Expense.category_id == Category.category_id)
            .filter(*expense_filters)
            .group_by(Category.name)
            .all()
        )
        expense_totals_by_key: Dict[str, float] = {}
        for r in cat_exp_rows:
            if r.cat_name:
                k = r.cat_name.strip().lower()
                expense_totals_by_key[k] = expense_totals_by_key.get(k, 0.0) + float(r.cat_total or 0.0)

        categorized_expense_total = sum(
            expense_totals_by_key.get(k, 0.0) for k in valid_expense_cats
        )
        for k, canonical_name in valid_expense_cats.items():
            amount = expense_totals_by_key.get(k, 0.0)
            pct = (amount / categorized_expense_total * 100.0) if categorized_expense_total > 0 else 0.0
            expense_categories.append(
                CategoryBreakdownItem(
                    category=canonical_name,
                    amount=amount,
                    percentage=round(pct, 1),
                )
            )
        expense_categories.sort(key=lambda item: (-item.amount, item.category.lower()))

    # Recent 10 Transactions
    company_name_map = {c.company_id: c.company_name for c in db.query(Company).all()}
    recent_sales = db.query(
        Sale,
        Category.name.label("category_name")
    ).outerjoin(Category, Sale.category_id == Category.category_id).filter(
        *sales_filters
    ).order_by(Sale.transaction_date.desc(), Sale.sales_id.desc()).limit(10).all()

    recent_expenses = db.query(
        Expense,
        Category.name.label("category_name")
    ).outerjoin(Category, Expense.category_id == Category.category_id).filter(
        *expense_filters
    ).order_by(Expense.expense_date.desc(), Expense.expense_id.desc()).limit(10).all()

    recent_txs: List[DashboardTransactionOut] = []
    for s, cat_name in recent_sales:
        amt = float(s.amount or 0.0)
        cname = company_name_map.get(s.company_id, target_cname)
        recent_txs.append(
            DashboardTransactionOut(
                id=f"sale_{s.sales_id}",
                ref_no=s.cheque_no or f"SL-{s.sales_id}",
                cheque_no=s.cheque_no,
                date=s.transaction_date.isoformat() if s.transaction_date else "",
                type="Sales",
                company=cname,
                description=s.particulars or "Sales Transaction",
                amount=amt,
                withdrawal=0.0,
                deposit=amt,
                category=cat_name or "Sales",
                payment_method=s.payment_method or "Cash",
                status=s.payment_status or "Paid",
                audit_status=s.audit_status or "Pending Audit",
                created_at=s.created_at.isoformat() if s.created_at else None,
            )
        )

    for e, cat_name in recent_expenses:
        amt = float(e.amount or 0.0)
        cname = company_name_map.get(e.company_id, target_cname)
        recent_txs.append(
            DashboardTransactionOut(
                id=f"expense_{e.expense_id}",
                ref_no=e.reference_no or e.cheque_no or f"EXP-{e.expense_id}",
                cheque_no=e.cheque_no,
                date=e.expense_date.isoformat() if e.expense_date else "",
                type="Expense",
                company=cname,
                description=e.description or "Expense Transaction",
                amount=amt,
                withdrawal=amt,
                deposit=0.0,
                category=cat_name or "Other",
                payment_method=e.payment_method or "Cash",
                status="Paid",
                audit_status=e.audit_status or "Pending Audit",
                created_at=e.created_at.isoformat() if e.created_at else None,
            )
        )

    # Sort combined latest first and cap to 10
    recent_txs.sort(key=lambda x: (x.date, x.created_at or ""), reverse=True)
    recent_txs = recent_txs[:10]

    # Metrics bundle
    total_sales_float = float(total_sales_val)
    total_expense_float = float(total_expense_val)
    response_payload = DashboardSummaryResponse(
        company_name=target_cname,
        company_id=target_cid,
        metrics=DashboardMetricSummary(
            total_cash=total_sales_float,
            total_expense=total_expense_float,
            net_income=total_sales_float - total_expense_float,
            overdue_count=overdue_total,
            due_soon_count=due_soon_total,
            petty_cash_balance=float(petty_balance),
        ),
        monthly_pnl=monthly_pnl,
        income_categories=income_categories,
        expense_categories=expense_categories,
        recent_transactions=recent_txs,
    )

    # Cache for 60 seconds with mutation invalidation tags
    system_cache.set(
        cache_key,
        response_payload,
        ttl=CACHE_TTL_SECONDS,
        tags=["dashboard", "categories", "sales", "expenses", "petty_cash", "loans", "bills"],
    )
    return response_payload
