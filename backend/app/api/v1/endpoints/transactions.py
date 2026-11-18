from datetime import date, datetime, timezone
from decimal import Decimal
from typing import List, Optional, Set
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_, and_, text
from sqlalchemy.orm import Session, joinedload

from app.core.dependencies import (
    AuthenticatedUser,
    check_company_access,
    get_authorized_company_scope,
    require_business_reader,
    require_business_writer,
)
from app.core.company_resolver import resolve_company, normalize_company_id
from app.core.cache import system_cache
from app.core.websocket import ws_manager
from app.db.session import get_db
from app.db.supabase import get_supabase_admin_client
from app.models.bank import BankAccount, BankTransaction
from app.models.bills import BillPayment
from app.models.company import Company
from app.models.finance import Expense, Sale
from app.models.loan import Loan, LoanRepayment
from app.models.petty_cash import PettyCashTopUp
from app.models.tenant import TenantLease, TenantLeasePayment
from app.schemas.transaction import TransactionOut
from app.services.audit_service import AuditAction, log_transaction
from app.services.bank_service import BankService, entry_source_supported
from app.services.daily_remark_cascade import purge_orphan_daily_remark
from app.services.income_bank_links import assert_not_linked_expense, assert_not_linked_sale, expense_sources, sale_sources
from app.services.petty_cash_service import PettyCashService, INITIAL_PETTY_CASH_DESCRIPTION
from app.services.sales_receivables_sync import SalesReceivablesSyncService, compute_paid_amount_from_particulars, parse_sale_lines

router = APIRouter()
logger = logging.getLogger(__name__)


def _resolve_company_scope(
    db: Session,
    current_user: AuthenticatedUser,
    company_name: Optional[str] = None,
    company_id: Optional[int] = None,
) -> tuple[Optional[int], Optional[str], Optional[Set[int]]]:
    """Returns (single_company_id, single_company_name, authorized_company_ids_set)."""
    req_cid: Optional[int] = None
    target_cname: Optional[str] = None

    if company_name and company_name.strip().lower() not in ("all", "all companies", ""):
        comp = resolve_company(db, company_name=company_name)
        check_company_access(current_user, comp.company_id)
        req_cid = comp.company_id
        target_cname = comp.company_name
    elif company_id is not None:
        check_company_access(current_user, company_id)
        comp = db.query(Company).filter(Company.company_id == company_id).first()
        if not comp:
            raise HTTPException(status_code=404, detail=f"Company with ID {company_id} not found.")
        req_cid = comp.company_id
        target_cname = comp.company_name

    scope_list = get_authorized_company_scope(current_user, requested_company_id=req_cid)
    if scope_list is None:
        return req_cid, target_cname, None
    return req_cid, target_cname, set(scope_list)


@router.get("", response_model=List[TransactionOut], summary="Live database-backed unified transactions ledger")
def list_transactions(
    company_name: Optional[str] = Query(None, description="Filter by company name"),
    company_id: Optional[int] = Query(None, description="Filter by company ID"),
    start_date: Optional[date] = Query(None, description="Filter from date"),
    end_date: Optional[date] = Query(None, description="Filter to date"),
    type: Optional[str] = Query(None, description="Filter by transaction type: Sales, Expense, Loan, Bank, Petty Cash, Income"),
    audit_status: Optional[str] = Query(None, description="Filter by audit status"),
    search: Optional[str] = Query(None, description="Search query in particulars/ref/cheque"),
    limit: Optional[int] = Query(5000, description="Max items to return (default and maximum 5000)", ge=1, le=5000),
    offset: int = Query(0, description="Items to skip", ge=0),
    response: Response = None,
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    target_cid, target_cname, allowed_cids = _resolve_company_scope(
        db, current_user, company_name=company_name, company_id=company_id
    )

    type_filter = (type or "").strip().lower()

    # Pre-load company ID to Name map
    comp_q = db.query(Company)
    if target_cid:
        comp_q = comp_q.filter(Company.company_id == target_cid)
    elif allowed_cids is not None:
        comp_q = comp_q.filter(Company.company_id.in_(allowed_cids))
    companies = comp_q.all()
    comp_map = {c.company_id: c.company_name for c in companies}
    name_to_cid = {c.company_name.lower(): c.company_id for c in companies}
    allowed_cnames_lower = [c.company_name.lower() for c in companies]

    def _visible(cid: Optional[int]) -> bool:
        """True when a row owned by company `cid` may be shown to this user for this request."""
        if cid is None:
            return False
        if target_cid is not None and cid != target_cid:
            return False
        if allowed_cids is not None and cid not in allowed_cids:
            return False
        return True

    # Map all companies for borrower/lender/funder labels when restricted and loans or petty cash are included
    if (allowed_cids is not None or target_cid) and (
        not type_filter or type_filter in ("loan", "loans", "petty cash", "petty_cash")
    ):
        all_comps = db.query(Company.company_id, Company.company_name).all()
        for cid, cname in all_comps:
            comp_map.setdefault(cid, cname)
            name_to_cid.setdefault(cname.lower(), cid)

    # Pre-load Bank Account ID to Bank Name map
    bank_acc_q = db.query(BankAccount)
    if target_cid:
        bank_acc_q = bank_acc_q.filter(BankAccount.company_id == target_cid)
    elif allowed_cids is not None:
        bank_acc_q = bank_acc_q.filter(BankAccount.company_id.in_(allowed_cids))
    bank_accs = bank_acc_q.all()
    bank_name_map = {b.id: f"{b.bank_name} - {b.account_name}" for b in bank_accs}

    query_cap = max((offset or 0) + (limit or 5000), 5000)

    items: List[TransactionOut] = []

    # ─────────────────────────────────────────────────────────────────────────────
    # 1. SALES (All sales with accurate payment and deposit synchronization)
    # ─────────────────────────────────────────────────────────────────────────────
    if not type_filter or type_filter in ("sales", "income"):
        sale_q = db.query(Sale).options(joinedload(Sale.category))
        if target_cid:
            sale_q = sale_q.filter(Sale.company_id == target_cid)
        elif allowed_cids is not None:
            sale_q = sale_q.filter(Sale.company_id.in_(allowed_cids))

        if start_date:
            sale_q = sale_q.filter(Sale.transaction_date >= start_date)
        if end_date:
            sale_q = sale_q.filter(Sale.transaction_date <= end_date)

        sales = sale_q.order_by(Sale.transaction_date.desc(), Sale.sales_id.desc()).limit(query_cap).all()
        sale_ids = [s.sales_id for s in sales]
        sources = sale_sources(db, sale_ids)

        # Derive paid amounts using SalesReceivablesSyncService rather than missing Sale.amount_paid
        sync_svc = SalesReceivablesSyncService(db)
        paid_by_sale = sync_svc.compute_paid_amounts((s.sales_id, s.particulars or "", s.amount) for s in sales)

        for s in sales:
            cname = comp_map.get(s.company_id, "Unknown Company")
            src_mod = sources.get(s.sales_id)
            particulars_clean = s.particulars or ""
            amount_val = float(s.amount or 0)
            amt_d = Decimal(str(s.amount or 0))

            p_status = (s.payment_status or "").strip().lower()
            d_status = (s.deposit_status or "").strip().lower()

            if p_status == "unpaid":
                paid_val = 0.0
            elif p_status == "paid":
                paid_val = amount_val
            else:
                if s.sales_id in paid_by_sale:
                    val = float(paid_by_sale[s.sales_id])
                    if p_status in ("pending", "partially paid") and val == amount_val and amount_val > 0:
                        lines = parse_sale_lines(particulars_clean, amt_d)
                        if not lines:
                            val = 0.0
                    paid_val = val
                else:
                    paid_d = compute_paid_amount_from_particulars(particulars_clean, amt_d)
                    if p_status in ("pending", "partially paid") and paid_d == amt_d and amt_d > 0:
                        paid_val = 0.0
                    else:
                        paid_val = float(paid_d)

            is_deposited = d_status == "deposited"
            deposit_amt = paid_val if is_deposited else 0.0

            sale_date_iso = s.transaction_date.isoformat() if s.transaction_date else None

            items.append(
                TransactionOut(
                    id=f"sale_{s.sales_id}",
                    refNo=f"SL-{s.sales_id:04d}",
                    chequeNo=s.cheque_no or "",
                    date=sale_date_iso or "",
                    saleDate=sale_date_iso,
                    type="Sales",
                    company=cname,
                    description=particulars_clean,
                    particulars=particulars_clean,
                    amount=amount_val,
                    withdrawal=0.0,
                    deposit=deposit_amt,
                    category=s.category.name if s.category else "Sales",
                    paymentMethod=s.payment_method,
                    status=s.payment_status or "Paid",
                    auditStatus=s.audit_status or "Pending Audit",
                    auditedBy=s.audited_by,
                    auditNotes=s.audit_remarks,
                    auditDate=s.audited_at.isoformat() if s.audited_at else None,
                    createdAt=s.created_at.isoformat() if s.created_at else None,
                    updatedAt=s.updated_at.isoformat() if s.updated_at else None,
                    paidAmount=paid_val,
                    bankAccountId=s.bank_account_id,
                    bankName=bank_name_map.get(s.bank_account_id),
                    depositStatus=s.deposit_status or "Not Deposited",
                    depositDate=s.deposit_date.isoformat() if s.deposit_date else None,
                    remarks=s.remarks,
                    sourceModule=src_mod or "Sales",
                    awaitingAudit=False,
                )
            )

    # ─────────────────────────────────────────────────────────────────────────────
    # 2. EXPENSES (All expenses with bills & lending source tracking)
    # ─────────────────────────────────────────────────────────────────────────────
    if not type_filter or type_filter in ("expense", "expenses"):
        exp_q = db.query(Expense).options(joinedload(Expense.category))
        if target_cid:
            exp_q = exp_q.filter(Expense.company_id == target_cid)
        elif allowed_cids is not None:
            exp_q = exp_q.filter(Expense.company_id.in_(allowed_cids))

        if start_date:
            exp_q = exp_q.filter(Expense.expense_date >= start_date)
        if end_date:
            exp_q = exp_q.filter(Expense.expense_date <= end_date)

        expenses = exp_q.order_by(Expense.expense_date.desc(), Expense.expense_id.desc()).limit(query_cap).all()
        exp_ids = [e.expense_id for e in expenses]
        lending_sources = expense_sources(db, exp_ids)

        bill_exp_ids = set()
        if exp_ids:
            bill_payments = db.query(BillPayment.expense_id).filter(BillPayment.expense_id.in_(exp_ids)).all()
            bill_exp_ids = {bp[0] for bp in bill_payments}

        for e in expenses:
            cname = comp_map.get(e.company_id, "Unknown Company")
            src_mod = lending_sources.get(e.expense_id)
            # Bank funded reimbursement payouts are shown by their petty_ row in Section 3
            if e.linked_topup_id and (e.payment_method or "").strip().lower() == "bank reimbursement":
                continue
            if not src_mod and e.expense_id in bill_exp_ids:
                src_mod = "Bills"
            elif not src_mod and e.linked_topup_id:
                src_mod = "Petty Cash"

            amount_val = float(e.amount or 0)

            # Avoid Decimal("0.00") boolean falsiness
            if e.amount_paid is not None:
                paid_val = float(e.amount_paid)
            else:
                paid_val = amount_val

            status_str = "Paid" if paid_val >= amount_val and amount_val > 0 else "Partially Paid" if paid_val > 0 else "Unpaid"

            # Only disbursed bank expenses withdraw from bank account
            withdrawal_amt = paid_val if e.bank_account_id else 0.0

            exp_date_iso = e.expense_date.isoformat() if e.expense_date else None

            items.append(
                TransactionOut(
                    id=f"exp_{e.expense_id}",
                    refNo=f"EXP-{e.expense_id:04d}",
                    chequeNo="",
                    date=exp_date_iso or "",
                    saleDate=exp_date_iso,
                    type="Expense",
                    company=cname,
                    description=e.particulars or "",
                    particulars=e.particulars or "",
                    amount=amount_val,
                    withdrawal=withdrawal_amt,
                    deposit=0.0,
                    category=e.category.name if e.category else "Expense",
                    paymentMethod=e.payment_method,
                    status=status_str,
                    auditStatus=e.audit_status or "Pending Audit",
                    auditedBy=e.audited_by,
                    auditNotes=e.audit_remarks,
                    auditDate=e.audited_at.isoformat() if e.audited_at else None,
                    createdAt=e.created_at.isoformat() if e.created_at else None,
                    updatedAt=e.updated_at.isoformat() if e.updated_at else None,
                    paidAmount=paid_val,
                    bankAccountId=e.bank_account_id,
                    bankName=bank_name_map.get(e.bank_account_id),
                    depositStatus=None,
                    depositDate=None,
                    remarks=e.remarks,
                    sourceModule=src_mod or "Expense",
                    awaitingAudit=False,
                )
            )

    # ─────────────────────────────────────────────────────────────────────────────
    # 3. PETTY CASH TOP-UPS (Direct movements to petty cash)
    # ─────────────────────────────────────────────────────────────────────────────
    if not type_filter or type_filter in ("petty cash", "petty_cash"):
        pct_q = db.query(PettyCashTopUp).outerjoin(BankAccount, PettyCashTopUp.bank_account_id == BankAccount.id)
        if target_cid:
            pct_q = pct_q.filter(or_(PettyCashTopUp.company_id == target_cid, BankAccount.company_id == target_cid))
        elif allowed_cids is not None:
            pct_q = pct_q.filter(or_(PettyCashTopUp.company_id.in_(allowed_cids), BankAccount.company_id.in_(allowed_cids)))

        if start_date:
            pct_q = pct_q.filter(PettyCashTopUp.topup_date >= start_date)
        if end_date:
            pct_q = pct_q.filter(PettyCashTopUp.topup_date <= end_date)

        pct_q = pct_q.filter(
            func.lower(func.coalesce(PettyCashTopUp.request_type, "topup")) != "disbursement",
            ~func.lower(func.coalesce(PettyCashTopUp.status, "")).in_(["cancelled", "canceled", "transfer cancelled"]),
        )
        topups = pct_q.order_by(PettyCashTopUp.topup_date.desc(), PettyCashTopUp.topup_id.desc()).limit(query_cap).all()

        # Batch resolve owning & co-owner companies of each funding bank (may be outside the user's scope)
        funding_bank_ids = {p.bank_account_id for p in topups if p.bank_account_id}
        funder_by_bank = {}
        co_owner_cids_by_bank = {}
        if funding_bank_ids:
            for acc in db.query(BankAccount).filter(BankAccount.id.in_(funding_bank_ids)).all():
                funder_by_bank[acc.id] = acc.company_id
                bank_name_map.setdefault(acc.id, f"{acc.bank_name} - {acc.account_name}")
                co_cids = set()
                if acc.company_id is not None:
                    co_cids.add(acc.company_id)
                for co_name in acc.company_names or []:
                    resolved_cid = name_to_cid.get(str(co_name).strip().lower())
                    if resolved_cid is not None:
                        co_cids.add(resolved_cid)
                co_owner_cids_by_bank[acc.id] = co_cids
        for p in topups:
            # Filter out opening floats
            if (p.description or "").strip().lower() == INITIAL_PETTY_CASH_DESCRIPTION:
                continue

            req_type = (p.request_type or "topup").strip().lower()
            # Exclude disbursements - they already create an Expense row in Section 2
            if req_type == "disbursement":
                continue

            amt = float(p.amount or 0)
            st = (p.status or "Pending").strip()
            st_lower = st.lower()

            # Reimbursements only move bank money when disbursed (reimbursed)
            if req_type in ("reimbursement", "replenishment"):
                if amt <= 0 or st_lower != "reimbursed":
                    continue
                # If funded directly from cash, its expense is already in Section 2
                if getattr(p, "payment_method_option", None) == "petty_cash":
                    continue

            cname = comp_map.get(p.company_id, "Unknown Company")
            p_date_iso = p.topup_date.isoformat() if p.topup_date else None

            # Cancelled transfers were reversed in the bank, so they are not cash movements
            if st_lower in ("cancelled", "canceled", "transfer cancelled"):
                continue

            if st_lower in ("disapproved by audit", "disapproved"):
                row_status = "Disapproved"
                base_withdrawal = 0.0
                row_awaiting = False
                row_audit_status = "Flagged"
                row_paid = 0.0
            elif st_lower in ("rejected by finance", "rejected"):
                row_status = "Rejected"
                base_withdrawal = 0.0
                row_awaiting = False
                row_audit_status = "Pending Audit"
                row_paid = 0.0
            elif st_lower in ("transfer in transit", "return pending"):
                # Bank cash already left the funding account
                row_status = "In Transit"
                base_withdrawal = amt if p.bank_account_id else 0.0
                row_awaiting = False
                row_audit_status = "Verified" if p.reviewed_by else "Pending Audit"
                row_paid = amt
            elif st_lower in ("transfer received", "reimbursed", "settled", "approved"):
                row_status = "Paid"
                base_withdrawal = amt if p.bank_account_id else 0.0
                row_awaiting = False
                row_audit_status = "Verified" if p.reviewed_by else "Pending Audit"
                row_paid = amt
            elif "pending" in st_lower:
                row_status = "Pending"
                base_withdrawal = 0.0
                row_awaiting = True
                row_audit_status = "Pending Audit"
                row_paid = 0.0
            else:
                row_status = "Paid"
                base_withdrawal = amt if p.bank_account_id else 0.0
                row_awaiting = False
                row_audit_status = "Verified" if p.reviewed_by else "Pending Audit"
                row_paid = amt

            # Determine which company views to emit (accounting for shared co-owned banks)
            funder_cid = funder_by_bank.get(p.bank_account_id) if p.bank_account_id else None
            co_owners = co_owner_cids_by_bank.get(p.bank_account_id, set()) if p.bank_account_id else set()
            is_cross_company = funder_cid is not None and p.company_id not in co_owners

            emit_specs = []
            if is_cross_company:
                funder_visible = _visible(funder_cid)
                recipient_visible = _visible(p.company_id)
                if funder_visible:
                    emit_specs.append((f"petty_{p.topup_id}", comp_map.get(funder_cid, "Unknown Company"), p.bank_account_id, base_withdrawal, False))
                if recipient_visible:
                    rec_id = f"petty_{p.topup_id}:recipient" if funder_visible else f"petty_{p.topup_id}"
                    emit_specs.append((rec_id, cname, None, 0.0, funder_visible))
            elif _visible(p.company_id):
                emit_specs.append((f"petty_{p.topup_id}", cname, p.bank_account_id, base_withdrawal, False))

            for out_id, out_cname, out_bank_id, out_withdrawal, is_mirror in emit_specs:
                items.append(
                    TransactionOut(
                        id=out_id,
                        refNo=f"PC-{p.topup_id:04d}",
                        chequeNo="",
                        date=p_date_iso or "",
                        saleDate=p_date_iso,
                        type="Petty Cash",
                        company=out_cname,
                        description=p.description or f"Petty Cash {p.request_type or 'Top-Up'}",
                        particulars=p.description or f"Petty Cash {p.request_type or 'Top-Up'}",
                        amount=amt,
                        withdrawal=out_withdrawal,
                        deposit=0.0,
                        category="Petty Cash",
                        paymentMethod="Bank Transfer" if p.bank_account_id else "Cash",
                        status=row_status,
                        auditStatus=row_audit_status,
                        auditedBy=p.reviewed_by,
                        auditNotes=p.remark,
                        auditDate=p.reviewed_at.isoformat() if p.reviewed_at else None,
                        createdAt=p.created_at.isoformat() if p.created_at else None,
                        paidAmount=row_paid,
                        bankAccountId=out_bank_id,
                        bankName=bank_name_map.get(out_bank_id) if out_bank_id else None,
                        remarks=p.remark or p.finance_remark,
                        isMirrorRow=is_mirror,
                        sourceModule="Petty Cash",
                        awaitingAudit=row_awaiting,
                    )
                )

    # ─────────────────────────────────────────────────────────────────────────────
    # 4. MANUAL BANK TRANSACTIONS (Direct entries not duplicating Sale/Expense)
    # ─────────────────────────────────────────────────────────────────────────────
    if not type_filter or type_filter == "bank":
        bt_q = db.query(BankTransaction).options(joinedload(BankTransaction.account)).filter(
            BankTransaction.source_sale_id.is_(None),
            BankTransaction.source_expense_id.is_(None),
        )

        if entry_source_supported(db):
            bt_q = bt_q.filter(
                or_(
                    text("bank_transactions.entry_source = 'manual'"),
                    and_(
                        text("bank_transactions.entry_source IS NULL"),
                        ~BankTransaction.particulars.ilike("loan%"),
                        ~BankTransaction.particulars.ilike("%petty cash%"),
                        ~BankTransaction.particulars.ilike("Intercompany Transfer%"),
                        ~BankTransaction.particulars.ilike("Intercompany Repayment%"),
                        ~BankTransaction.particulars.ilike("%intercompany%"),
                        ~BankTransaction.category.in_(["Loan Repayment", "Loan"]),
                    ),
                )
            )
        else:
            # Fallback: strictly exclude automated loan, petty cash, and intercompany transfers
            bt_q = bt_q.filter(
                ~BankTransaction.particulars.ilike("loan%"),
                ~BankTransaction.particulars.ilike("%petty cash%"),
                ~BankTransaction.particulars.ilike("Intercompany Transfer%"),
                ~BankTransaction.particulars.ilike("Intercompany Repayment%"),
                ~BankTransaction.particulars.ilike("%intercompany%"),
                ~BankTransaction.category.in_(["Loan Repayment", "Loan"]),
            )

        if target_cname:
            bt_q = bt_q.filter(
                or_(
                    func.lower(BankTransaction.company_name) == target_cname.lower(),
                    and_(
                        BankTransaction.company_name.is_(None),
                        BankTransaction.account.has(
                            and_(
                                func.lower(BankAccount.company_name) == target_cname.lower(),
                                or_(BankAccount.company_names_json.is_(None), BankAccount.company_names_json == ""),
                            )
                        ),
                    ),
                )
            )
        elif allowed_cids is not None:
            bt_q = bt_q.filter(
                or_(
                    func.lower(BankTransaction.company_name).in_(allowed_cnames_lower) if allowed_cnames_lower else text("1=0"),
                    and_(
                        BankTransaction.company_name.is_(None),
                        BankTransaction.account.has(
                            and_(
                                BankAccount.company_id.in_(allowed_cids),
                                or_(BankAccount.company_names_json.is_(None), BankAccount.company_names_json == ""),
                            )
                        ),
                    ),
                )
            )

        if start_date:
            bt_q = bt_q.filter(
                or_(
                    BankTransaction.transaction_date.is_(None),
                    BankTransaction.transaction_date == "",
                    BankTransaction.transaction_date.like("%/%"),
                    func.substr(BankTransaction.transaction_date, 1, 10) >= start_date.isoformat(),
                )
            )
        if end_date:
            bt_q = bt_q.filter(
                or_(
                    BankTransaction.transaction_date.is_(None),
                    BankTransaction.transaction_date == "",
                    BankTransaction.transaction_date.like("%/%"),
                    func.substr(BankTransaction.transaction_date, 1, 10) <= end_date.isoformat(),
                )
            )

        manual_entries = bt_q.order_by(BankTransaction.created_at.desc()).limit(query_cap).all()
        for b in manual_entries:
            clean_bt_id = b.id if str(b.id).startswith("tx-") else f"tx-{b.id}"

            is_shared_account = bool(b.account and (b.account.company_names_json or "").strip())
            comp_entry = b.company_name or (None if is_shared_account else (b.account.company_name if b.account else None))
            comp_cid = name_to_cid.get(comp_entry.lower()) if comp_entry else (None if is_shared_account else (b.account.company_id if b.account else None))

            # Strict company isolation
            if target_cid and comp_cid != target_cid:
                continue
            if allowed_cids is not None:
                if comp_cid is None or comp_cid not in allowed_cids:
                    continue

            deposit_val = float(b.deposit or 0)
            withdrawal_val = float(b.withdrawal or 0)
            amount_val = deposit_val if deposit_val > 0 else withdrawal_val

            tx_date = b.transaction_date or ""
            if "/" in tx_date:
                try:
                    parts = tx_date.split("/")
                    if len(parts) == 3:
                        m, d, y = parts
                        if len(y) == 2:
                            y = "20" + y
                        tx_date = f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
                except Exception:
                    pass

            if start_date and tx_date:
                try:
                    if date.fromisoformat(tx_date[:10]) < start_date:
                        continue
                except Exception:
                    pass
            if end_date and tx_date:
                try:
                    if date.fromisoformat(tx_date[:10]) > end_date:
                        continue
                except Exception:
                    pass

            clean_suffix = str(b.id).replace("tx-", "")

            items.append(
                TransactionOut(
                    id=clean_bt_id,
                    refNo=f"BNK-{clean_suffix}",
                    chequeNo=b.cheque_no or "",
                    date=tx_date,
                    saleDate=tx_date,
                    type="Bank",
                    company=comp_entry or "Bank Account",
                    description=b.particulars,
                    particulars=b.particulars,
                    amount=amount_val,
                    withdrawal=withdrawal_val,
                    deposit=deposit_val,
                    category=b.category or "Bank Transfer",
                    status="Paid",
                    auditStatus=b.audit_status or "Pending Audit",
                    auditedBy=b.audited_by,
                    auditNotes=b.audit_remarks,
                    auditDate=b.audited_at.isoformat() if b.audited_at else None,
                    createdAt=b.created_at.isoformat() if b.created_at else None,
                    bankAccountId=b.bank_account_id,
                    bankName=bank_name_map.get(b.bank_account_id),
                    paidAmount=amount_val,
                    remarks=b.remarks,
                    sourceModule="Bank",
                    awaitingAudit=False,
                )
            )

    # ─────────────────────────────────────────────────────────────────────────────
    # 5. LOANS (Disbursements and Repayments between companies)
    # ─────────────────────────────────────────────────────────────────────────────
    if not type_filter or type_filter in ("loan", "loans"):
        loan_q = db.query(Loan).options(joinedload(Loan.repayments))

        # Only disbursed loans appear in ledger cash movements (Spec 0046)
        loan_q = loan_q.filter(
            func.lower(Loan.status).in_(["disbursed", "paid", "partially paid", "fully paid", "overdue"])
        )

        if target_cid:
            loan_q = loan_q.filter(or_(Loan.borrower == target_cid, Loan.lender == target_cid))
        elif allowed_cids is not None:
            loan_q = loan_q.filter(or_(Loan.borrower.in_(allowed_cids), Loan.lender.in_(allowed_cids)))

        if start_date:
            loan_q = loan_q.filter(Loan.loan_date >= start_date)
        if end_date:
            loan_q = loan_q.filter(Loan.loan_date <= end_date)

        loans = loan_q.order_by(Loan.loan_date.desc(), Loan.loan_id.desc()).limit(query_cap).all()

        # Batch load actual disbursement bank transactions (via cheque_no == loan_ref_no)
        # and deterministic own-first / shared-fallback borrower bank accounts (matches loans.py)
        loan_refs = [ln.loan_ref_no for ln in loans if ln.loan_ref_no]
        borrower_cids = {ln.borrower for ln in loans if ln.borrower}
        disb_bank_by_loan = {}
        if loan_refs:
            disb_rows = (
                db.query(BankTransaction.cheque_no, BankAccount)
                .join(BankAccount, BankAccount.id == BankTransaction.bank_account_id)
                .filter(BankTransaction.cheque_no.in_(loan_refs), BankTransaction.deposit > 0)
                .order_by(BankTransaction.created_at.asc(), BankTransaction.id.asc())
                .all()
            )
            by_ref_loans = {}
            for ln in loans:
                if ln.loan_ref_no:
                    by_ref_loans.setdefault(ln.loan_ref_no, []).append(ln)
            for ref, acc in disb_rows:
                acc_owners = {acc.company_id} if acc.company_id is not None else set()
                for co_name in acc.company_names or []:
                    resolved_cid = name_to_cid.get(str(co_name).strip().lower())
                    if resolved_cid is not None:
                        acc_owners.add(resolved_cid)
                for ln in by_ref_loans.get(ref, []):
                    if ln.loan_id not in disb_bank_by_loan and ln.borrower in acc_owners:
                        disb_bank_by_loan[ln.loan_id] = acc

        borrower_acc_map = {}
        if borrower_cids:
            all_borrower_accs = (
                db.query(BankAccount)
                .filter(
                    or_(
                        BankAccount.company_id.in_(borrower_cids),
                        BankAccount.company_names_json.isnot(None),
                    )
                )
                .order_by(BankAccount.created_at.asc(), BankAccount.id.asc())
                .all()
            )
            # First pass: company's own single-owner bank
            for acc in all_borrower_accs:
                if not (acc.company_names_json or "").strip() and acc.company_id in borrower_cids:
                    borrower_acc_map.setdefault(acc.company_id, acc)
            # Second pass: primary owner or co-owner shared bank
            for acc in all_borrower_accs:
                if acc.company_id in borrower_cids:
                    borrower_acc_map.setdefault(acc.company_id, acc)
                for co_name in acc.company_names or []:
                    resolved_cid = name_to_cid.get(str(co_name).strip().lower())
                    if resolved_cid in borrower_cids:
                        borrower_acc_map.setdefault(resolved_cid, acc)

        for ln in loans:
            borrower_name = comp_map.get(ln.borrower, "Borrower")
            lender_name = comp_map.get(ln.lender, "Lender")
            principal = float(ln.principal_amount or 0)
            ln_date = ln.loan_date.isoformat() if ln.loan_date else datetime.now(timezone.utc).date().isoformat()

            # Pre-disbursement audit approval is not ledger audit.
            # Keep auditStatus as "Pending Audit" to prevent auto-auditing.
            loan_audit_st = "Pending Audit"

            # Borrower's bank account for receiving loan deposit
            borrower_acc = disb_bank_by_loan.get(ln.loan_id) or borrower_acc_map.get(ln.borrower)
            borrower_bank_id = borrower_acc.id if borrower_acc else None
            borrower_bank_name = (
                bank_name_map.get(borrower_bank_id)
                or (f"{borrower_acc.bank_name} - {borrower_acc.account_name}" if borrower_acc else None)
            )

            # Borrower's side: Deposit
            if _visible(ln.borrower):
                items.append(
                    TransactionOut(
                        id=f"loan_{ln.loan_id}",
                        refNo=ln.loan_ref_no or f"LN-{ln.loan_id:04d}",
                        chequeNo="",
                        date=ln_date,
                        saleDate=ln_date,
                        type="Loan",
                        company=borrower_name,
                        description=f"Loan disbursed from {lender_name}: {ln.description or ''}".strip(),
                        particulars=ln.description or f"Loan received from {lender_name}",
                        amount=principal,
                        withdrawal=0.0,
                        deposit=principal,
                        category="Loan",
                        status="Paid",
                        auditStatus=loan_audit_st,
                        auditedBy=None,
                        auditNotes=ln.audit_remark,
                        auditDate=None,
                        bankAccountId=borrower_bank_id,
                        bankName=borrower_bank_name,
                        remarks=ln.finance_remark,
                        awaitingAudit=False,
                    )
                )

            # Lender's side: Withdrawal
            if ln.lender and _visible(ln.lender) and ln.lender != ln.borrower:
                items.append(
                    TransactionOut(
                        id=f"loan_{ln.loan_id}:lender",
                        refNo=ln.loan_ref_no or f"LN-{ln.loan_id:04d}",
                        chequeNo="",
                        date=ln_date,
                        saleDate=ln_date,
                        type="Loan",
                        company=lender_name,
                        description=f"Loan disbursed to {borrower_name}: {ln.description or ''}".strip(),
                        particulars=f"Loan disbursed to {borrower_name}",
                        amount=principal,
                        withdrawal=principal,
                        deposit=0.0,
                        category="Loan",
                        status="Paid",
                        auditStatus=loan_audit_st,
                        auditedBy=None,
                        auditNotes=ln.audit_remark,
                        auditDate=None,
                        bankAccountId=ln.bank_account_id,
                        bankName=bank_name_map.get(ln.bank_account_id),
                        remarks=ln.finance_remark,
                        isMirrorRow=True,
                        awaitingAudit=False,
                    )
                )

            # Loan Repayments
            for rep in ln.repayments or []:
                rep_amt = float(rep.amount or 0)
                if rep_amt <= 0:
                    continue
                rep_date = rep.payment_date.isoformat() if rep.payment_date else ln_date
                if start_date and rep.payment_date and rep.payment_date < start_date:
                    continue
                if end_date and rep.payment_date and rep.payment_date > end_date:
                    continue

                if ln.lender and _visible(ln.lender):
                    items.append(
                        TransactionOut(
                            id=f"loan_rep_{rep.loan_repayment_id}:lender",
                            refNo=rep.reference_no or ln.loan_ref_no or f"REP-{rep.loan_repayment_id}",
                            chequeNo=rep.reference_no or "",
                            date=rep_date,
                            saleDate=rep_date,
                            type="Loan",
                            company=lender_name,
                            description=f"Loan repayment from {borrower_name}",
                            particulars=f"Loan repayment from {borrower_name}",
                            amount=rep_amt,
                            withdrawal=0.0,
                            deposit=rep_amt,
                            category="Loan Repayment",
                            status="Paid",
                            auditStatus="Pending Audit",
                            bankAccountId=ln.bank_account_id,
                            bankName=bank_name_map.get(ln.bank_account_id),
                            isMirrorRow=True,
                            awaitingAudit=False,
                        )
                    )

    # ─────────────────────────────────────────────────────────────────────────────
    # 6. TENANT LEASE PAYMENTS (Direct rent payments not already tracked as Sale)
    # ─────────────────────────────────────────────────────────────────────────────
    if not type_filter or type_filter in ("sales", "income"):
        tenant_pmt_q = (
            db.query(TenantLeasePayment)
            .join(TenantLease)
            .options(joinedload(TenantLeasePayment.lease))
            .filter(
                TenantLeasePayment.sale_id.is_(None),
                func.lower(TenantLeasePayment.status) != "missed",
                TenantLeasePayment.amount > 0,
            )
        )
        if target_cid:
            tenant_pmt_q = tenant_pmt_q.filter(TenantLease.company_id == target_cid)
        elif allowed_cids is not None:
            tenant_pmt_q = tenant_pmt_q.filter(TenantLease.company_id.in_(allowed_cids))

        if start_date:
            tenant_pmt_q = tenant_pmt_q.filter(TenantLeasePayment.payment_date >= start_date)
        if end_date:
            tenant_pmt_q = tenant_pmt_q.filter(TenantLeasePayment.payment_date <= end_date)

        for pmt in tenant_pmt_q.order_by(TenantLeasePayment.payment_date.desc(), TenantLeasePayment.payment_id.desc()).limit(query_cap).all():
            lease = pmt.lease
            cname = comp_map.get(lease.company_id, "Unknown Company")
            amt = float(pmt.amount or 0)
            pmt_date_iso = pmt.payment_date.isoformat() if pmt.payment_date else None
            items.append(
                TransactionOut(
                    id=f"tenant_lease_{lease.lease_id}_pmt_{pmt.payment_id}",
                    refNo=lease.tenant_ref or f"TNT-{pmt.payment_id:04d}",
                    chequeNo="",
                    date=pmt_date_iso or "",
                    saleDate=pmt_date_iso,
                    type="Income",
                    company=cname,
                    description=f"Rent Payment - {lease.tenant_name} ({lease.unit_name})",
                    particulars=f"Rent Payment - {lease.tenant_name} ({lease.unit_name})",
                    amount=amt,
                    withdrawal=0.0,
                    deposit=amt,
                    category="Rental Income",
                    paymentMethod=pmt.method or "Cash",
                    status="Paid",
                    auditStatus=lease.audit_status or "Pending Audit",
                    auditedBy=lease.audited_by,
                    auditNotes=lease.audit_remarks,
                    auditDate=lease.audited_at.isoformat() if lease.audited_at else None,
                    createdAt=pmt.created_at.isoformat() if pmt.created_at else None,
                    paidAmount=amt,
                    bankAccountId=lease.bank_account_id,
                    bankName=bank_name_map.get(lease.bank_account_id),
                    sourceModule="Tenants",
                    awaitingAudit=False,
                )
            )

    # Filter by search string if provided
    if search:
        s_term = search.strip().lower()
        items = [
            it
            for it in items
            if s_term in it.particulars.lower()
            or s_term in it.description.lower()
            or s_term in it.refNo.lower()
            or s_term in (it.chequeNo or "").lower()
            or s_term in it.company.lower()
        ]

    # Filter by audit_status if provided
    if audit_status:
        a_term = audit_status.strip().lower()
        items = [it for it in items if it.auditStatus.strip().lower() == a_term]

    # Sort items chronologically descending (date, then id)
    items.sort(key=lambda x: (x.date, x.createdAt or x.date, x.id), reverse=True)

    total_count = len(items)
    if response is not None:
        response.headers["X-Total-Count"] = str(total_count)

    if limit is None:
        limit = 5000
    items = items[offset: offset + limit]

    return items


@router.delete("/{transaction_id}", summary="Cascade delete a transaction across Transaction ledger and Bank")
def delete_transaction(
    transaction_id: str,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    """
    Deletes the underlying record (Sale, Expense, Bank Transaction, Loan, or Petty Cash),
    automatically cascading to bank balances, ledger entries, and linked records with zero ghost data.
    """
    tx_id_str = transaction_id.strip()

    # Reject direct deletion of loan repayments
    if tx_id_str.startswith("loan_rep_"):
        raise HTTPException(
            status_code=400,
            detail="Loan repayments cannot be deleted directly from Transactions. Please manage repayments via the Loans module.",
        )

    # 1. Manual Bank Transaction
    if tx_id_str.startswith("tx-") or (not tx_id_str.startswith(("exp_", "sale_", "loan_", "petty_")) and not tx_id_str.isdigit()):
        bt = db.query(BankTransaction).filter(BankTransaction.id == tx_id_str).first()
        if not bt and tx_id_str.startswith("tx-"):
            bt = db.query(BankTransaction).filter(BankTransaction.id == tx_id_str[3:]).first()

        if bt:
            # Must not delete linked bank transaction directly
            if bt.source_sale_id is not None or bt.source_expense_id is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot delete a bank transaction linked to a sale or expense directly. Delete the underlying sale or expense.",
                )

            # Strict company access check
            comp_id = bt.account.company_id if bt.account else None
            if not comp_id and bt.company_name:
                comp = db.query(Company).filter(func.lower(Company.company_name) == bt.company_name.lower()).first()
                if comp:
                    comp_id = comp.company_id

            if comp_id is not None:
                check_company_access(current_user, comp_id)
            elif not (current_user.get("role") in ("admin", "owner") or current_user.get("is_admin")):
                raise HTTPException(status_code=403, detail="Not authorized to delete this bank transaction.")

            if (bt.audit_status or "").strip().lower() == "verified":
                raise HTTPException(status_code=409, detail="Verified bank transactions cannot be deleted without audit unlock.")

            account = db.query(BankAccount).filter(BankAccount.id == bt.bank_account_id).first()
            account_id = bt.bank_account_id
            deleted_id = bt.id

            db.delete(bt)
            if account:
                BankService(db)._sync_balance(account)
            db.commit()

            try:
                log_transaction(
                    db,
                    AuditAction.BANK_TRANSACTION_DELETED,
                    user_id=current_user.get("user_id"),
                    company_id=comp_id,
                    ip_address=request.client.host if request.client else "unknown",
                    record_id=str(deleted_id),
                    record_type="bank_transaction",
                )
            except Exception as exc:
                logger.warning("Audit log failed for bank transaction delete %s: %s", deleted_id, exc)

            ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"account_id": account_id}})
            return {"success": True, "detail": "Bank transaction deleted and account balance updated."}

    # 2. Expense Record - delegate to canonical guarded delete_expense
    if tx_id_str.startswith("exp_"):
        eid_str = tx_id_str.replace("exp_", "")
        if eid_str.isdigit():
            eid = int(eid_str)
            # Check if linked to a BillPayment
            linked_bp = db.query(BillPayment).filter(BillPayment.expense_id == eid).first()
            if linked_bp:
                raise HTTPException(
                    status_code=409,
                    detail="This expense is linked to a bill payment and cannot be deleted directly from Transactions. Please delete the payment via the Bills module.",
                )
            from app.api.v1.endpoints.expenses import delete_expense
            return delete_expense(expense_id=eid, request=request, current_user=current_user, db=db)

    # 3. Sale Record - delegate to canonical guarded delete_sale
    if tx_id_str.startswith("sale_"):
        sid_str = tx_id_str.replace("sale_", "")
        if sid_str.isdigit():
            sid = int(sid_str)
            from app.api.v1.endpoints.sales import delete_sale
            return delete_sale(sales_id=sid, request=request, current_user=current_user, db=db)

    # 4. Petty Cash Top-Up
    if tx_id_str.startswith("petty_"):
        pid_str = tx_id_str.replace("petty_", "")
        if pid_str.isdigit():
            pid = int(pid_str)
            pct = db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == pid).first()
            if pct:
                check_company_access(current_user, pct.company_id)
                pct_cid = pct.company_id
                # Delegate to canonical guarded delete_topup
                PettyCashService(db).delete_topup(pid)

                try:
                    log_transaction(
                        db,
                        AuditAction.PETTY_CASH_TOPUP_DELETED,
                        user_id=current_user.get("user_id"),
                        company_id=pct_cid,
                        ip_address=request.client.host if request.client else "unknown",
                        record_id=pid,
                        record_type="petty_cash_topup",
                    )
                except Exception as exc:
                    logger.warning("Audit log failed for petty cash top-up delete %s: %s", pid, exc)

                return {"success": True, "detail": "Petty cash entry deleted."}

    # 5. Loan Record
    if tx_id_str.startswith("loan_"):
        lid_str = tx_id_str.replace("loan_", "").split(":")[0]
        if lid_str.isdigit():
            lid = int(lid_str)
            ln = db.query(Loan).filter(Loan.loan_id == lid).first()
            if ln:
                if ln.borrower:
                    check_company_access(current_user, ln.borrower)
                if ln.lender:
                    check_company_access(current_user, ln.lender)

                # Approved and disbursed loans cannot be deleted directly
                existing_st = (ln.status or "").strip().lower()
                if existing_st not in {"pending approval", "pending finance endorsement"}:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Approved loans cannot be deleted (current status: {ln.status}).",
                    )

                client = None
                try:
                    client = get_supabase_admin_client()
                    if client:
                        client.table("loan").delete().eq("loan_id", lid).execute()
                except Exception as exc:
                    logger.warning("Supabase delete loan error %s: %s", lid, exc)

                borrower_cid = ln.borrower
                db.delete(ln)
                db.commit()

                system_cache.invalidate_tag("loans")
                system_cache.invalidate_tag("notifications")

                try:
                    log_transaction(
                        db,
                        AuditAction.LOAN_DELETED,
                        user_id=current_user.get("user_id"),
                        company_id=borrower_cid,
                        ip_address=request.client.host if request.client else "unknown",
                        record_id=lid,
                        record_type="loan",
                    )
                except Exception as exc:
                    logger.warning("Audit log failed for loan delete %s: %s", lid, exc)

                ws_manager.broadcast_sync({"type": "LOAN_DELETED", "payload": {"loan_id": lid}})
                return {"success": True, "detail": "Loan deleted."}

    # Fallback if raw numeric ID was passed: check Sale then Expense
    if tx_id_str.isdigit():
        num_id = int(tx_id_str)
        sale = db.query(Sale).filter(Sale.sales_id == num_id).first()
        if sale:
            from app.api.v1.endpoints.sales import delete_sale
            return delete_sale(sales_id=num_id, request=request, current_user=current_user, db=db)
        exp = db.query(Expense).filter(Expense.expense_id == num_id).first()
        if exp:
            linked_bp = db.query(BillPayment).filter(BillPayment.expense_id == num_id).first()
            if linked_bp:
                raise HTTPException(
                    status_code=409,
                    detail="This expense is linked to a bill payment and cannot be deleted directly from Transactions. Please delete the payment via the Bills module.",
                )
            from app.api.v1.endpoints.expenses import delete_expense
            return delete_expense(expense_id=num_id, request=request, current_user=current_user, db=db)

    raise HTTPException(status_code=404, detail=f"Transaction '{transaction_id}' not found.")
