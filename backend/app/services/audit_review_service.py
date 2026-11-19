"""Save the Audit review result on a sale or expense (spec 0014)."""
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.cache import system_cache
from app.core.dependencies import AuthenticatedUser, check_company_access
from app.core.websocket import ws_manager
from app.db.supabase import get_supabase_admin_client
from app.models.user import User
from app.schemas.audit_review import PENDING_AUDIT, AuditReviewIn


def _auditor_name(db: Session, user: AuthenticatedUser) -> str:
    """The name stamped on the review comes from the signed in user, never from the request."""
    from app.core.user_name_resolver import resolve_real_name
    user_id = user.get("user_id")
    if user_id:
        db_user = db.query(User).filter(User.user_id == user_id).first()
        if db_user and (db_user.name or "").strip():
            return db_user.name.strip()
    if user.get("full_name") or user.get("name"):
        return user.get("full_name") or user.get("name")
    return resolve_real_name(user.get("email") or "Auditor")


def apply_audit_review(
    db: Session,
    user: AuthenticatedUser,
    *,
    model: Any,
    pk_column: str,
    supabase_table: str,
    record_id: int,
    payload: AuditReviewIn,
    not_found: str,
) -> None:
    """
    Update only the four audit columns of one sale or expense, in Supabase and in the local table.
    Raises 404 when the record is missing and 403 when the user has no access to its company.
    """
    pk_attr = getattr(model, pk_column)

    # 1. Find the record's company (Supabase first, local table as fallback).
    company_id: Optional[int] = None
    found_remote = False
    client = None
    try:
        client = get_supabase_admin_client()
        res = client.table(supabase_table).select("company_id").eq(pk_column, record_id).limit(1).execute()
        if res.data:
            found_remote = True
            company_id = res.data[0].get("company_id")
    except Exception:
        client = None

    local_row = db.query(model).filter(pk_attr == record_id).first()
    if local_row is not None and company_id is None:
        company_id = getattr(local_row, "company_id", None)
    if not found_remote and local_row is None:
        raise HTTPException(status_code=404, detail=not_found)

    if company_id is not None:
        check_company_access(user, company_id)

    # 2. Work out the values. The name and time are set here, on the server.
    status = payload.audit_status
    remarks = (payload.remarks or "").strip() or None
    if status == PENDING_AUDIT:
        audited_by, audited_at, remarks = None, None, None
    else:
        audited_by, audited_at = _auditor_name(db, user), datetime.now(timezone.utc)

    # 3. Save to Supabase.
    remote_saved = False
    if found_remote and client is not None:
        try:
            client.table(supabase_table).update({
                "audit_status": status,
                "audited_by": audited_by,
                "audited_at": audited_at.isoformat() if audited_at else None,
                "audit_remarks": remarks,
            }).eq(pk_column, record_id).execute()
            remote_saved = True
        except Exception as e:
            print(f"Supabase audit update error: {e}")

    # 4. Save to the local table.
    local_saved = False
    if local_row is not None:
        local_row.audit_status = status
        local_row.audited_by = audited_by
        local_row.audited_at = audited_at
        local_row.audit_remarks = remarks
        db.commit()
        local_saved = True

    if not remote_saved and not local_saved:
        raise HTTPException(status_code=500, detail="Could not save the audit status. Please try again.")

    # Keep any linked bank transactions and domain records in sync with the audit review
    propagate_audit_status(
        db,
        source_type=supabase_table,
        source_id=record_id,
        status=status,
        audited_by=audited_by,
        audited_at=audited_at,
        audit_remarks=remarks,
    )

    if supabase_table == "expenses":
        system_cache.invalidate_tag("petty_cash")
    system_cache.invalidate_tag("dashboard")

    # Tell every connected Finance, Audit and company screen to reload (spec 0016, AC-4).
    try:
        ws_manager.broadcast_sync({
            "type": "AUDIT_UPDATED",
            "payload": {"resource": supabase_table, "id": record_id},
        })
    except Exception as e:
        print(f"Audit websocket broadcast error: {e}")


def _set_audit_cols(obj: Any, status: str, audited_by: Optional[str], audited_at: Optional[datetime], audit_remarks: Optional[str]) -> None:
    obj.audit_status = status
    obj.audited_by = audited_by
    obj.audited_at = audited_at
    obj.audit_remarks = audit_remarks


def _sync_supabase_audit(table: str, pk_col: str, pk_val: Any, status: str, audited_by: Optional[str], audited_at: Optional[datetime], audit_remarks: Optional[str]) -> None:
    try:
        client = get_supabase_admin_client()
        if client:
            client.table(table).update({
                "audit_status": status,
                "audited_by": audited_by,
                "audited_at": audited_at.isoformat() if audited_at else None,
                "audit_remarks": audit_remarks,
            }).eq(pk_col, pk_val).execute()
    except Exception:
        pass


def propagate_audit_status(
    db: Session,
    *,
    source_type: str,
    source_id: Any,
    status: str,
    audited_by: Optional[str],
    audited_at: Optional[datetime],
    audit_remarks: Optional[str],
    _visited: Optional[set] = None,
) -> None:
    """
    Bidirectionally propagate audit_status across linked domain records,
    sales/expenses, and bank_transactions without recursion cycles.
    """
    if _visited is None:
        _visited = set()
    key = (source_type, str(source_id))
    if key in _visited:
        return
    _visited.add(key)

    from app.models.bank import BankTransaction
    from app.models.bills import Bill, BillPayment
    from app.models.finance import Expense, Sale
    from app.models.lending import Borrower, LendingTransaction
    from app.models.loan import Loan, LoanRepayment
    from app.models.petty_cash import PettyCashTopUp
    from app.models.receivable import Receivable, ReceivablePayment
    from app.models.tenant import TenantLease, TenantLeasePayment

    events_to_broadcast: set[str] = set()

    def _update_bank_txs(q_filter) -> None:
        txs = db.query(BankTransaction).filter(q_filter).all()
        for btx in txs:
            if ("bank_transactions", str(btx.id)) not in _visited:
                _visited.add(("bank_transactions", str(btx.id)))
                _set_audit_cols(btx, status, audited_by, audited_at, audit_remarks)
                events_to_broadcast.add("BANK_UPDATED")

    def _update_sale(sale_id: int) -> None:
        if ("sales", str(sale_id)) in _visited:
            return
        sale = db.query(Sale).filter(Sale.sales_id == sale_id).first()
        if sale:
            _set_audit_cols(sale, status, audited_by, audited_at, audit_remarks)
            _sync_supabase_audit("sales", "sales_id", sale_id, status, audited_by, audited_at, audit_remarks)
            events_to_broadcast.add("SALES_UPDATED")
        propagate_audit_status(
            db, source_type="sales", source_id=sale_id,
            status=status, audited_by=audited_by, audited_at=audited_at, audit_remarks=audit_remarks,
            _visited=_visited,
        )

    def _update_expense(expense_id: int) -> None:
        if ("expenses", str(expense_id)) in _visited:
            return
        exp = db.query(Expense).filter(Expense.expense_id == expense_id).first()
        if exp:
            _set_audit_cols(exp, status, audited_by, audited_at, audit_remarks)
            _sync_supabase_audit("expenses", "expense_id", expense_id, status, audited_by, audited_at, audit_remarks)
            events_to_broadcast.add("EXPENSES_UPDATED")
        propagate_audit_status(
            db, source_type="expenses", source_id=expense_id,
            status=status, audited_by=audited_by, audited_at=audited_at, audit_remarks=audit_remarks,
            _visited=_visited,
        )

    try:
        if source_type == "sales":
            sid = int(source_id)
            _update_bank_txs(BankTransaction.source_sale_id == sid)

            for rec in db.query(Receivable).filter(Receivable.sale_id == sid).all():
                if ("receivables", str(rec.receivable_id)) not in _visited:
                    _visited.add(("receivables", str(rec.receivable_id)))
                    _set_audit_cols(rec, status, audited_by, audited_at, audit_remarks)
                    events_to_broadcast.add("RECEIVABLES_UPDATED")
                    for pmt in db.query(ReceivablePayment).filter(ReceivablePayment.receivable_id == rec.receivable_id).all():
                        _update_bank_txs(BankTransaction.source_receivable_payment_id == pmt.payment_id)

            for tlp in db.query(TenantLeasePayment).filter(TenantLeasePayment.sale_id == sid).all():
                if ("tenants", str(tlp.lease_id)) not in _visited:
                    _visited.add(("tenants", str(tlp.lease_id)))
                    lease = db.query(TenantLease).filter(TenantLease.lease_id == tlp.lease_id).first()
                    if lease:
                        _set_audit_cols(lease, status, audited_by, audited_at, audit_remarks)
                        _sync_supabase_audit("tenant_leases", "lease_id", tlp.lease_id, status, audited_by, audited_at, audit_remarks)
                        events_to_broadcast.add("TENANTS_UPDATED")

            for lt in db.query(LendingTransaction).filter(LendingTransaction.sale_id == sid).all():
                if ("lending", str(lt.borrower_id)) not in _visited:
                    _visited.add(("lending", str(lt.borrower_id)))
                    bor = db.query(Borrower).filter(Borrower.borrower_id == lt.borrower_id).first()
                    if bor:
                        _set_audit_cols(bor, status, audited_by, audited_at, audit_remarks)
                        events_to_broadcast.add("LENDING_UPDATED")

        elif source_type == "expenses":
            eid = int(source_id)
            _update_bank_txs(BankTransaction.source_expense_id == eid)

            for bp in db.query(BillPayment).filter(BillPayment.expense_id == eid).all():
                if ("bills", str(bp.bill_id)) not in _visited:
                    _visited.add(("bills", str(bp.bill_id)))
                    bill = db.query(Bill).filter(Bill.bill_id == bp.bill_id).first()
                    if bill:
                        _set_audit_cols(bill, status, audited_by, audited_at, audit_remarks)
                        events_to_broadcast.add("BILLS_UPDATED")

            for bor in db.query(Borrower).filter(Borrower.release_expense_id == eid).all():
                if ("lending", str(bor.borrower_id)) not in _visited:
                    _visited.add(("lending", str(bor.borrower_id)))
                    _set_audit_cols(bor, status, audited_by, audited_at, audit_remarks)
                    events_to_broadcast.add("LENDING_UPDATED")

            for rep in db.query(LoanRepayment).filter(LoanRepayment.expense_id == eid).all():
                if ("loan_repayment", str(rep.loan_repayment_id)) not in _visited:
                    _visited.add(("loan_repayment", str(rep.loan_repayment_id)))
                    _set_audit_cols(rep, status, audited_by, audited_at, audit_remarks)
                    _update_bank_txs(BankTransaction.source_loan_repayment_id == rep.loan_repayment_id)
                    events_to_broadcast.add("LOANS_UPDATED")

            for topup in db.query(PettyCashTopUp).filter(
                (PettyCashTopUp.petty_cash_expense_id == eid)
                | (PettyCashTopUp.reimbursement_expense_id == eid)
                | (PettyCashTopUp.existing_expense_id == eid)
            ).all():
                if ("petty_cash_topup", str(topup.topup_id)) not in _visited:
                    _visited.add(("petty_cash_topup", str(topup.topup_id)))
                    _set_audit_cols(topup, status, audited_by, audited_at, audit_remarks)
                    _update_bank_txs(BankTransaction.source_topup_id == topup.topup_id)
                    events_to_broadcast.add("PETTY_CASH_UPDATED")

        elif source_type == "bank_transactions":
            btx = db.query(BankTransaction).filter(BankTransaction.id == str(source_id)).first()
            if btx:
                if btx.source_sale_id:
                    _update_sale(btx.source_sale_id)
                if btx.source_expense_id:
                    _update_expense(btx.source_expense_id)
                if btx.source_receivable_payment_id:
                    pmt = db.query(ReceivablePayment).filter(ReceivablePayment.payment_id == btx.source_receivable_payment_id).first()
                    if pmt and ("receivables", str(pmt.receivable_id)) not in _visited:
                        _visited.add(("receivables", str(pmt.receivable_id)))
                        rec = db.query(Receivable).filter(Receivable.receivable_id == pmt.receivable_id).first()
                        if rec:
                            _set_audit_cols(rec, status, audited_by, audited_at, audit_remarks)
                            events_to_broadcast.add("RECEIVABLES_UPDATED")
                            if rec.sale_id:
                                _update_sale(rec.sale_id)
                if btx.source_loan_repayment_id:
                    rep = db.query(LoanRepayment).filter(LoanRepayment.loan_repayment_id == btx.source_loan_repayment_id).first()
                    if rep and ("loan_repayment", str(rep.loan_repayment_id)) not in _visited:
                        _visited.add(("loan_repayment", str(rep.loan_repayment_id)))
                        _set_audit_cols(rep, status, audited_by, audited_at, audit_remarks)
                        events_to_broadcast.add("LOANS_UPDATED")
                        if rep.expense_id:
                            _update_expense(rep.expense_id)
                        _update_bank_txs(BankTransaction.source_loan_repayment_id == rep.loan_repayment_id)
                if btx.source_loan_id:
                    if ("loan", str(btx.source_loan_id)) not in _visited:
                        _visited.add(("loan", str(btx.source_loan_id)))
                        ln = db.query(Loan).filter(Loan.loan_id == btx.source_loan_id).first()
                        if ln:
                            _set_audit_cols(ln, status, audited_by, audited_at, audit_remarks)
                            events_to_broadcast.add("LOANS_UPDATED")
                        _update_bank_txs(BankTransaction.source_loan_id == btx.source_loan_id)
                if btx.source_topup_id:
                    if ("petty_cash_topup", str(btx.source_topup_id)) not in _visited:
                        _visited.add(("petty_cash_topup", str(btx.source_topup_id)))
                        topup = db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == btx.source_topup_id).first()
                        if topup:
                            _set_audit_cols(topup, status, audited_by, audited_at, audit_remarks)
                            events_to_broadcast.add("PETTY_CASH_UPDATED")
                            for eid in (topup.petty_cash_expense_id, topup.reimbursement_expense_id, topup.existing_expense_id):
                                if eid:
                                    _update_expense(eid)
                        _update_bank_txs(BankTransaction.source_topup_id == btx.source_topup_id)

        elif source_type == "bills":
            bid = int(source_id)
            for bp in db.query(BillPayment).filter(BillPayment.bill_id == bid).all():
                if bp.expense_id:
                    _update_expense(bp.expense_id)

        elif source_type == "receivables":
            rid = int(source_id)
            rec = db.query(Receivable).filter(Receivable.receivable_id == rid).first()
            if rec and rec.sale_id:
                _update_sale(rec.sale_id)
            for pmt in db.query(ReceivablePayment).filter(ReceivablePayment.receivable_id == rid).all():
                _update_bank_txs(BankTransaction.source_receivable_payment_id == pmt.payment_id)

        elif source_type in ("loan", "loans"):
            lid = int(source_id)
            _update_bank_txs(BankTransaction.source_loan_id == lid)
            ln = db.query(Loan).filter(Loan.loan_id == lid).first()
            if ln and ln.loan_ref_no:
                _update_bank_txs(
                    (BankTransaction.source_loan_id.is_(None))
                    & (BankTransaction.cheque_no == ln.loan_ref_no)
                    & (BankTransaction.particulars.like("Loan:%"))
                )

        elif source_type in ("loan_repayment", "loans_repayments"):
            rep_id = int(source_id)
            rep = db.query(LoanRepayment).filter(LoanRepayment.loan_repayment_id == rep_id).first()
            if rep and rep.expense_id:
                _update_expense(rep.expense_id)
            _update_bank_txs(BankTransaction.source_loan_repayment_id == rep_id)

        elif source_type == "lending":
            bor_id = int(source_id)
            bor = db.query(Borrower).filter(Borrower.borrower_id == bor_id).first()
            if bor and bor.release_expense_id:
                _update_expense(bor.release_expense_id)
            for lt in db.query(LendingTransaction).filter(LendingTransaction.borrower_id == bor_id).all():
                if lt.sale_id:
                    _update_sale(lt.sale_id)

        elif source_type == "tenants":
            lease_id = int(source_id)
            for tlp in db.query(TenantLeasePayment).filter(TenantLeasePayment.lease_id == lease_id).all():
                if tlp.sale_id:
                    _update_sale(tlp.sale_id)

        elif source_type in ("petty_cash_topup", "petty_cash_topups"):
            tid = int(source_id)
            topup = db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == tid).first()
            if topup:
                for eid in (topup.petty_cash_expense_id, topup.reimbursement_expense_id, topup.existing_expense_id):
                    if eid:
                        _update_expense(eid)
            _update_bank_txs(BankTransaction.source_topup_id == tid)

        db.commit()
    except Exception as e:
        print(f"Audit propagation warning ({source_type}:{source_id}): {e}")

    for ev in events_to_broadcast:
        try:
            ws_manager.broadcast_sync({"type": ev, "payload": {"action": "audited", "source_type": source_type, "source_id": source_id}})
        except Exception:
            pass
