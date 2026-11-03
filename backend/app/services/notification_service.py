"""
notification_service.py
-----------------------
Stateless, zero-storage in-app notification service.

Computes notifications and due-date reminders on the fly from live database
records across:
1. Bills (overdue, due today, due tomorrow, due soon reminders + payments)
2. Lending / Borrowers (overdue maturity, missed daily/monthly installments,
   daily/monthly installments due today/tomorrow/soon + repayments)
3. Inter-company Loans (overdue, due today, due tomorrow, due soon, pending
   approvals, finance/audit workflow, repayments)
4. Tenant Leases (overdue, due today, due tomorrow, due soon rent + payments)
5. Petty Cash (pending finance/audit requests, approvals/rejections, low wallet balance)
6. Sales / Deposits & Expenses Audit alerts
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.core.cache import system_cache
from app.models.audit_log import AuditLog
from app.models.company import Company
from app.models.loan import Loan, LoanRepayment
from app.schemas.notification import NotificationOut
from app.services.finance_service import FinanceCalculator

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Notification type constants
# ---------------------------------------------------------------------------

class NotificationType:
    # Bills
    BILL_OVERDUE                = "BILL_OVERDUE"
    BILL_DUE_TODAY              = "BILL_DUE_TODAY"
    BILL_DUE_TOMORROW           = "BILL_DUE_TOMORROW"
    BILL_DUE_SOON               = "BILL_DUE_SOON"
    BILL_PAID                   = "BILL_PAID"
    BILL_PARTIALLY_PAID         = "BILL_PARTIALLY_PAID"

    # Lending (Micro-lending / Borrowers)
    LENDING_OVERDUE             = "LENDING_OVERDUE"
    LENDING_INSTALLMENT_OVERDUE = "LENDING_INSTALLMENT_OVERDUE"
    LENDING_DUE_TODAY           = "LENDING_DUE_TODAY"
    LENDING_DUE_TOMORROW        = "LENDING_DUE_TOMORROW"
    LENDING_DUE_SOON            = "LENDING_DUE_SOON"
    LENDING_PAYMENT_RECEIVED    = "LENDING_PAYMENT_RECEIVED"
    LENDING_FULLY_SETTLED       = "LENDING_FULLY_SETTLED"

    # Inter-company Loans
    LOAN_PENDING_APPROVAL       = "LOAN_PENDING_APPROVAL"
    LOAN_OVERDUE                = "LOAN_OVERDUE"
    LOAN_DUE_TODAY              = "LOAN_DUE_TODAY"
    LOAN_DUE_TOMORROW           = "LOAN_DUE_TOMORROW"
    LOAN_DUE_SOON               = "LOAN_DUE_SOON"
    LOAN_REPAYMENT_RECEIVED     = "LOAN_REPAYMENT_RECEIVED"
    LOAN_REPAYMENT_SENT         = "LOAN_REPAYMENT_SENT"
    LOAN_FULLY_SETTLED          = "LOAN_FULLY_SETTLED"
    LOAN_REQUEST_FINANCE        = "LOAN_REQUEST_FINANCE"
    LOAN_ENDORSED_AUDIT         = "LOAN_ENDORSED_AUDIT"
    LOAN_APPROVED_SUPERVISOR    = "LOAN_APPROVED_SUPERVISOR"
    LOAN_REJECTED_SUPERVISOR    = "LOAN_REJECTED_SUPERVISOR"

    # Tenants
    TENANT_OVERDUE              = "TENANT_OVERDUE"
    TENANT_DUE_TODAY            = "TENANT_DUE_TODAY"
    TENANT_DUE_TOMORROW         = "TENANT_DUE_TOMORROW"
    TENANT_DUE_SOON             = "TENANT_DUE_SOON"
    TENANT_PAYMENT_RECEIVED     = "TENANT_PAYMENT_RECEIVED"

    # Petty Cash
    PETTY_CASH_REQUEST          = "PETTY_CASH_REQUEST"
    PETTY_CASH_AUDIT            = "PETTY_CASH_AUDIT"
    PETTY_CASH_APPROVED         = "PETTY_CASH_APPROVED"
    PETTY_CASH_REJECTED         = "PETTY_CASH_REJECTED"
    PETTY_CASH_LOW_BALANCE      = "PETTY_CASH_LOW_BALANCE"

    # Deposits & Audit
    DEPOSIT_VERIFIED            = "DEPOSIT_VERIFIED"


OVERDUE_TYPES = {
    NotificationType.BILL_OVERDUE,
    NotificationType.LENDING_OVERDUE,
    NotificationType.LENDING_INSTALLMENT_OVERDUE,
    NotificationType.LOAN_OVERDUE,
    NotificationType.TENANT_OVERDUE,
}

DUE_TODAY_TYPES = {
    NotificationType.BILL_DUE_TODAY,
    NotificationType.LENDING_DUE_TODAY,
    NotificationType.LOAN_DUE_TODAY,
    NotificationType.TENANT_DUE_TODAY,
}

DUE_SOON_TYPES = {
    NotificationType.BILL_DUE_TOMORROW,
    NotificationType.BILL_DUE_SOON,
    NotificationType.LENDING_DUE_TOMORROW,
    NotificationType.LENDING_DUE_SOON,
    NotificationType.LOAN_DUE_TOMORROW,
    NotificationType.LOAN_DUE_SOON,
    NotificationType.TENANT_DUE_TOMORROW,
    NotificationType.TENANT_DUE_SOON,
    NotificationType.PETTY_CASH_LOW_BALANCE,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_id(*parts: Any) -> str:
    """
    Produce a deterministic, stable notification ID from its source data
    so the frontend can track read/dismiss state in local storage.
    Format: "<type>-<part1>-<part2>-..."
    """
    return "-".join(str(p) for p in parts)


def _normalize_dt(dt: Optional[datetime]) -> datetime:
    if not dt:
        return datetime.min.replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _urgency_priority(notification_type: str) -> int:
    """
    Sort priority so active due-date reminders (Overdue -> Due Today -> Due Soon)
    always surface prominently at the top of the notification panel.
    """
    if notification_type in OVERDUE_TYPES:
        return 0
    if notification_type in DUE_TODAY_TYPES:
        return 1
    if notification_type in DUE_SOON_TYPES:
        return 2
    return 3


def _parse_details(details_str: Optional[str]) -> dict:
    if not details_str:
        return {}
    try:
        return json.loads(details_str)
    except Exception:
        return {}


def _calculate_loan_balance(loan: Loan, total_repaid: Decimal) -> Decimal:
    principal = loan.principal_amount or Decimal("0.00")
    rate = loan.interest_rate or Decimal("0.00")
    interest = FinanceCalculator.calculate_loan_interest(principal, rate)
    total_payable = FinanceCalculator.calculate_loan_total_payable(principal, interest)
    return FinanceCalculator.calculate_loan_remaining_balance(total_payable, total_repaid)


def _company_name(db: Session, company_id: Optional[int], name_map: Optional[dict] = None) -> str:
    if not company_id:
        return "All Companies"
    if name_map is not None and company_id in name_map:
        return name_map[company_id]
    name = db.query(Company.company_name).filter(Company.company_id == company_id).scalar()
    return name or f"Company #{company_id}"


def _is_filcap_company(company_name: str) -> bool:
    low = (company_name or "").strip().lower()
    return "filcap" in low or "filcam" in low


def _parse_date_safe(val: Any) -> Optional[date]:
    if not val:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    try:
        return date.fromisoformat(str(val).split("T")[0][:10])
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class NotificationService:

    def __init__(self, db: Session):
        self.db = db

    def _get_company_names_map(self) -> dict[int, str]:
        try:
            return dict(self.db.query(Company.company_id, Company.company_name).all())
        except Exception:
            return {}

    def _load_loans_context(
        self,
        company_id: Optional[int],
    ) -> tuple[list[Loan], dict[int, Loan], dict[int, Decimal], list[tuple[LoanRepayment, Loan]]]:
        """
        Consolidated loader for Loan and LoanRepayment records.
        Executes at most 2 SQL queries (1 for Loan, 1 for LoanRepayment) instead of 6.
        """
        try:
            q = self.db.query(Loan)
            if company_id is not None:
                q = q.filter(or_(Loan.borrower == company_id, Loan.lender == company_id))
            loans = q.order_by(Loan.created_at.desc(), Loan.loan_id.desc()).all()
            loans_by_id = {l.loan_id: l for l in loans}

            repayments_map: dict[int, Decimal] = {}
            recent_repayments: list[tuple[LoanRepayment, Loan]] = []

            if loans_by_id:
                rep_rows = (
                    self.db.query(LoanRepayment)
                    .filter(LoanRepayment.loan_id.in_(list(loans_by_id.keys())))
                    .order_by(LoanRepayment.created_at.desc(), LoanRepayment.loan_repayment_id.desc())
                    .all()
                )
                for rep in rep_rows:
                    amt = Decimal(str(rep.amount or 0))
                    repayments_map[rep.loan_id] = repayments_map.get(rep.loan_id, Decimal("0.00")) + amt
                    if len(recent_repayments) < 30 and rep.loan_id in loans_by_id:
                        recent_repayments.append((rep, loans_by_id[rep.loan_id]))

            return loans, loans_by_id, repayments_map, recent_repayments
        except Exception as exc:
            logger.warning("Error loading consolidated loan context: %s", exc)
            return [], {}, {}, []

    def _load_audit_logs(
        self,
        company_id: Optional[int],
    ) -> tuple[list[AuditLog], list[AuditLog]]:
        """
        Consolidated loader for AuditLog records needed by loan repayment fallbacks
        and deposit/sales verification notifications (1 query instead of 2).
        """
        try:
            q = self.db.query(AuditLog).filter(
                AuditLog.action.in_(["LOAN_UPDATED", "SALE_UPDATED", "SALE_CREATED"]),
                AuditLog.details.isnot(None),
            )
            if company_id is not None:
                q = q.filter(AuditLog.company_id == company_id)
            rows = q.order_by(AuditLog.created_at.desc()).limit(80).all()
            loan_audit_rows = [r for r in rows if r.action == "LOAN_UPDATED"][:50]
            sale_audit_rows = [r for r in rows if r.action in ("SALE_UPDATED", "SALE_CREATED")][:30]
            return loan_audit_rows, sale_audit_rows
        except Exception as exc:
            logger.warning("Error loading consolidated audit logs: %s", exc)
            return [], []

    def _load_petty_cash_topups(self, company_id: Optional[int]):
        """
        Consolidated loader for PettyCashTopUp records (1 query instead of 3-4).
        Used by both workflow notifications and low-balance calculations.
        """
        try:
            from app.models.petty_cash import PettyCashTopUp

            q = self.db.query(PettyCashTopUp)
            if company_id is not None:
                q = q.filter(PettyCashTopUp.company_id == company_id)
            return q.order_by(PettyCashTopUp.created_at.desc()).all()
        except Exception as exc:
            logger.warning("Error loading petty cash topups: %s", exc)
            return []

    # ── Public API ────────────────────────────────────────────────────────────

    def get_notifications(
        self,
        *,
        company_id: Optional[int] = None,
        user_role: Optional[str] = None,
        user_scope_key: Optional[str] = None,
        notification_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[NotificationOut]:
        effective_role = (user_role or "supervisor").strip().lower() or "supervisor"
        if effective_role == "admin":
            return []

        scope_ident = user_scope_key or f"r:{effective_role}:c:{company_id}"
        base_cache_key = f"notifs_v2:{scope_ident}"

        deduped = system_cache.get(base_cache_key)
        if deduped is None:
            raw_notifications: list[NotificationOut] = []

            name_map = self._get_company_names_map()
            loans, loans_by_id, repayments_map, recent_repayments = self._load_loans_context(company_id)
            loan_audit_rows, sale_audit_rows = self._load_audit_logs(company_id)
            petty_cash_topups = self._load_petty_cash_topups(company_id)

            # 1. Bills due-date reminders & payment notifications
            raw_notifications.extend(self._bill_notifications(company_id, name_map))

            # 2. Lending (Borrower) due-date reminders, installment alerts & repayments
            raw_notifications.extend(self._lending_notifications(company_id, effective_role, name_map))

            # 3. Inter-company loan due-date reminders, pending approvals, workflow & repayments
            raw_notifications.extend(
                self._due_date_notifications(company_id, name_map, repayments_map, loans=loans)
            )
            raw_notifications.extend(
                self._pending_approval_notifications(company_id, name_map, loans=loans)
            )
            raw_notifications.extend(
                self._repayment_notifications(
                    company_id,
                    name_map,
                    recent_repayments=recent_repayments,
                    loans_by_id=loans_by_id,
                    audit_rows=loan_audit_rows,
                )
            )
            raw_notifications.extend(
                self._loan_workflow_notifications(effective_role, company_id, name_map, loans=loans)
            )

            # 4. Tenant lease due-date reminders & rent payment notifications
            raw_notifications.extend(self._tenant_notifications(company_id, name_map))

            # 5. Petty cash workflow & low balance notifications
            raw_notifications.extend(
                self._petty_cash_workflow_notifications(
                    effective_role, company_id, name_map, topups=petty_cash_topups
                )
            )
            raw_notifications.extend(
                self._petty_cash_low_balance_notifications(
                    company_id, name_map, topups=petty_cash_topups
                )
            )

            # 6. Sales / Deposit audit notifications
            raw_notifications.extend(
                self._deposit_workflow_notifications(
                    effective_role, company_id, name_map, audit_rows=sale_audit_rows
                )
            )

            # Deduplicate by notification_id
            deduped = []
            seen_ids: set[str] = set()
            for item in raw_notifications:
                if item.notification_id not in seen_ids:
                    seen_ids.add(item.notification_id)
                    deduped.append(item)

            deduped.sort(
                key=lambda n: (
                    _urgency_priority(n.notification_type),
                    -_normalize_dt(n.created_at).timestamp(),
                )
            )
            system_cache.set(base_cache_key, deduped, ttl=15, tags=["notifications"])

        filtered = deduped
        if notification_type:
            nt = notification_type.upper()
            filtered = [n for n in deduped if n.notification_type == nt]

        return filtered[offset: offset + limit]

    def get_unread_count(
        self,
        *,
        company_id: Optional[int] = None,
        user_role: Optional[str] = None,
        user_scope_key: Optional[str] = None,
        recipient_user_id: Optional[int] = None,
    ) -> int:
        if (user_role or "").strip().lower() == "admin":
            return 0

        if recipient_user_id is not None:
            from sqlalchemy import select, func
            from app.models.notification import Notification
            
            q = select(func.count(Notification.notification_id)).where(
                Notification.recipient_user_id == recipient_user_id,
                Notification.read_at.is_(None),
            )
            if company_id is not None:
                q = q.where(Notification.company_id == company_id)
            count = self.db.scalar(q)
            if count is not None and count > 0:
                return int(count)

            has_any = self.db.scalar(
                select(func.count(Notification.notification_id)).where(
                    Notification.recipient_user_id == recipient_user_id
                )
            )
            if has_any and has_any > 0:
                return 0

        return len(
            self.get_notifications(
                company_id=company_id,
                user_role=user_role,
                user_scope_key=user_scope_key,
                limit=10_000,
            )
        )

    # ── Source 1: Bills (Due-date reminders & payments) ──────────────────────

    def _bill_notifications(
        self,
        company_id: Optional[int],
        name_map: Optional[dict] = None,
    ) -> list[NotificationOut]:
        results: list[NotificationOut] = []
        today = date.today()
        now_utc = datetime.now(timezone.utc)

        try:
            from app.models.bills import Bill
            from app.services.bills_service import BillsService

            bills_svc = BillsService(self.db)
            q = self.db.query(Bill).options(selectinload(Bill.payments))
            if company_id is not None:
                q = q.filter(Bill.company_id == company_id)
            bills = q.order_by(Bill.created_at.desc(), Bill.bill_id.desc()).all()

            for b in bills:
                try:
                    cname = _company_name(self.db, b.company_id, name_map)
                    periods = bills_svc._periods(b, as_of=today, include_future=1, validate_payments=False)
                    periods_by_key = {p["period_key"]: p for p in periods}
                    next_p = bills_svc._next_period(b, as_of=today, periods=periods)
                    computed_status = bills_svc._status(b, as_of=today, periods=periods)

                    due_d = (next_p["period_date"] if next_p else None) or b.due_date
                    if due_d and computed_status != "paid" and next_p is not None:
                        period_key = next_p["period_key"]
                        period_label = next_p["period_label"]

                        rem_amt = Decimal("0.00")
                        if next_p.get("remaining_amount") and next_p["remaining_amount"] > Decimal("0.00"):
                            rem_amt = Decimal(str(next_p["remaining_amount"]))
                        elif next_p.get("billed_amount") and next_p["billed_amount"] > Decimal("0.00"):
                            rem_amt = Decimal(str(next_p["billed_amount"]))
                        elif b.amount and b.amount > Decimal("0.00"):
                            rem_amt = Decimal(str(b.amount))

                        amt_str = f" Amount due: ₱{rem_amt:,.2f}." if rem_amt > Decimal("0.00") else ""
                        is_partial = bool(next_p.get("partially_paid")) or computed_status == "partially paid"
                        partial_tag = " (Partially Paid)" if is_partial else ""

                        diff_days = (due_d - today).days
                        reminder_window = max(int(b.due_date_reminder or 3), 7)

                        if diff_days < 0:
                            days_overdue = abs(diff_days)
                            results.append(NotificationOut(
                                notification_id=_make_id(NotificationType.BILL_OVERDUE, b.bill_id, period_key),
                                notification_type=NotificationType.BILL_OVERDUE,
                                title=f"Overdue Bill{partial_tag}: {b.bill_name}",
                                message=(
                                    f"{b.bill_name} ({cname}) for {period_label} was due on "
                                    f"{due_d.strftime('%b %d, %Y')} ({days_overdue} day{'s' if days_overdue != 1 else ''} overdue)."
                                    f"{amt_str}"
                                ),
                                company_id=b.company_id,
                                reference_type="bill",
                                reference_id=b.bill_id,
                                is_read=False,
                                created_at=now_utc - timedelta(minutes=min(days_overdue, 60)),
                            ))
                        elif diff_days == 0:
                            results.append(NotificationOut(
                                notification_id=_make_id(NotificationType.BILL_DUE_TODAY, b.bill_id, period_key),
                                notification_type=NotificationType.BILL_DUE_TODAY,
                                title=f"Bill Due Today{partial_tag}: {b.bill_name}",
                                message=(
                                    f"{b.bill_name} ({cname}) for {period_label} is due TODAY "
                                    f"({due_d.strftime('%b %d, %Y')})!{amt_str}"
                                ),
                                company_id=b.company_id,
                                reference_type="bill",
                                reference_id=b.bill_id,
                                is_read=False,
                                created_at=now_utc,
                            ))
                        elif diff_days == 1:
                            results.append(NotificationOut(
                                notification_id=_make_id(NotificationType.BILL_DUE_TOMORROW, b.bill_id, period_key),
                                notification_type=NotificationType.BILL_DUE_TOMORROW,
                                title=f"Bill Due Tomorrow{partial_tag}: {b.bill_name}",
                                message=(
                                    f"{b.bill_name} ({cname}) for {period_label} is due tomorrow "
                                    f"({due_d.strftime('%b %d, %Y')}).{amt_str}"
                                ),
                                company_id=b.company_id,
                                reference_type="bill",
                                reference_id=b.bill_id,
                                is_read=False,
                                created_at=now_utc - timedelta(minutes=5),
                            ))
                        elif 1 < diff_days <= reminder_window:
                            results.append(NotificationOut(
                                notification_id=_make_id(NotificationType.BILL_DUE_SOON, b.bill_id, period_key),
                                notification_type=NotificationType.BILL_DUE_SOON,
                                title=f"Bill Due in {diff_days} Days{partial_tag}: {b.bill_name}",
                                message=(
                                    f"{b.bill_name} ({cname}) for {period_label} is due on "
                                    f"{due_d.strftime('%b %d, %Y')} ({diff_days} days left).{amt_str}"
                                ),
                                company_id=b.company_id,
                                reference_type="bill",
                                reference_id=b.bill_id,
                                is_read=False,
                                created_at=now_utc - timedelta(minutes=10 + diff_days),
                            ))

                    # Recent bill payments (top 2 newest)
                    payments = sorted(
                        b.payments or [],
                        key=lambda p: (p.payment_date or date.min, p.bill_payment_id or 0),
                        reverse=True,
                    )[:2]
                    for p in payments:
                        p_period = periods_by_key.get(p.period_key)
                        is_period_paid = bool(p_period["paid"]) if p_period else (computed_status == "paid")
                        ntype = NotificationType.BILL_PAID if is_period_paid else NotificationType.BILL_PARTIALLY_PAID
                        title = f"Bill Payment Recorded: {b.bill_name}" if is_period_paid else f"Partial Bill Payment: {b.bill_name}"
                        p_label = p_period["period_label"] if p_period else p.period_key
                        p_amount = p.amount or Decimal("0.00")
                        ts = p.created_at or (
                            datetime.combine(p.payment_date, datetime.min.time()).replace(tzinfo=timezone.utc)
                            if p.payment_date
                            else now_utc
                        )
                        results.append(NotificationOut(
                            notification_id=_make_id(ntype, b.bill_id, p.bill_payment_id),
                            notification_type=ntype,
                            title=title,
                            message=(
                                f"Payment of ₱{p_amount:,.2f} recorded for {b.bill_name} ({cname}) "
                                f"— {p_label} via {p.payment_method or 'Cash'}."
                            ),
                            company_id=b.company_id,
                            reference_type="bill",
                            reference_id=b.bill_id,
                            is_read=False,
                            created_at=ts,
                        ))
                except Exception as inner_exc:
                    logger.warning("Bill notification error for bill %s: %s", getattr(b, "bill_id", "?"), inner_exc)
        except Exception as exc:
            logger.warning("Error computing bill notifications: %s", exc)

        return results

    # ── Source 2: Lending (Borrowers due-date reminders & payments) ──────────

    def _lending_notifications(
        self,
        company_id: Optional[int],
        user_role: Optional[str],
        name_map: Optional[dict] = None,
    ) -> list[NotificationOut]:
        results: list[NotificationOut] = []
        if name_map is None:
            name_map = self._get_company_names_map()

        # Find FilCap company_id if registered
        filcap_cid: Optional[int] = None
        for cid, cname in name_map.items():
            if _is_filcap_company(cname):
                filcap_cid = cid
                break

        # If a specific non-FilCap company is queried, skip lending
        if company_id is not None and filcap_cid is not None and company_id != filcap_cid:
            cname = name_map.get(company_id, "")
            if not _is_filcap_company(cname):
                return results

        today = date.today()
        today_iso = today.isoformat()
        now_utc = datetime.now(timezone.utc)

        try:
            from app.services.lending_service import LendingService

            borrowers = LendingService.get_borrowers(self.db, company_id=company_id)

            for b in borrowers:
                try:
                    bid = int(b.get("borrower_id") or b.get("loanId") or b.get("id") or 0)
                    bname = str(b.get("borrowerName") or "Borrower").strip()
                    ref = str(b.get("borrowerRefNo") or b.get("loanRefNo") or f"BOR-{bid}")
                    rem = Decimal(str(b.get("remainingBalance", 0)))
                    freq = str(b.get("paymentFrequency") or "Daily").strip().capitalize()
                    target = Decimal(str(b.get("installmentTarget", 0)))
                    penalties = Decimal(str(b.get("totalPenalties", 0)))
                    missed_count = int(b.get("missedCyclesCount") or 0)
                    compliance = str(b.get("complianceStatus") or "Compliant")
                    due_d = _parse_date_safe(b.get("dueDate"))
                    start_d = _parse_date_safe(b.get("dateBorrowed"))
                    repayments = b.get("dailyPayments") or []
                    status_str = str(b.get("status") or "Active").lower()

                    if rem > Decimal("0.00") and status_str not in ("completed", "fully paid"):
                        # A. Overall Loan Maturity Due Date Reminders
                        if due_d:
                            diff_days = (due_d - today).days
                            if diff_days < 0:
                                days_overdue = abs(diff_days)
                                results.append(NotificationOut(
                                    notification_id=_make_id(NotificationType.LENDING_OVERDUE, bid),
                                    notification_type=NotificationType.LENDING_OVERDUE,
                                    title=f"Overdue Lending Facility: {bname}",
                                    message=(
                                        f"{bname} ({ref}) maturity due date was {due_d.strftime('%b %d, %Y')} "
                                        f"({days_overdue} day{'s' if days_overdue != 1 else ''} overdue). "
                                        f"Remaining balance: ₱{rem:,.2f}."
                                    ),
                                    company_id=filcap_cid,
                                    reference_type="lending",
                                    reference_id=bid,
                                    is_read=False,
                                    created_at=now_utc - timedelta(minutes=min(days_overdue, 60)),
                                ))
                            elif diff_days == 0:
                                results.append(NotificationOut(
                                    notification_id=_make_id(NotificationType.LENDING_DUE_TODAY, "maturity", bid, today_iso),
                                    notification_type=NotificationType.LENDING_DUE_TODAY,
                                    title=f"Lending Maturity Due Today: {bname}",
                                    message=(
                                        f"{bname} ({ref}) lending facility matures TODAY ({due_d.strftime('%b %d, %Y')})! "
                                        f"Remaining balance: ₱{rem:,.2f}."
                                    ),
                                    company_id=filcap_cid,
                                    reference_type="lending",
                                    reference_id=bid,
                                    is_read=False,
                                    created_at=now_utc,
                                ))
                            elif diff_days == 1:
                                results.append(NotificationOut(
                                    notification_id=_make_id(NotificationType.LENDING_DUE_TOMORROW, "maturity", bid, due_d.isoformat()),
                                    notification_type=NotificationType.LENDING_DUE_TOMORROW,
                                    title=f"Lending Maturity Due Tomorrow: {bname}",
                                    message=(
                                        f"{bname} ({ref}) lending facility matures tomorrow ({due_d.strftime('%b %d, %Y')}). "
                                        f"Remaining balance: ₱{rem:,.2f}."
                                    ),
                                    company_id=filcap_cid,
                                    reference_type="lending",
                                    reference_id=bid,
                                    is_read=False,
                                    created_at=now_utc - timedelta(minutes=5),
                                ))
                            elif 1 < diff_days <= 7:
                                results.append(NotificationOut(
                                    notification_id=_make_id(NotificationType.LENDING_DUE_SOON, "maturity", bid, due_d.isoformat()),
                                    notification_type=NotificationType.LENDING_DUE_SOON,
                                    title=f"Lending Maturity Due in {diff_days} Days: {bname}",
                                    message=(
                                        f"{bname} ({ref}) lending facility matures on {due_d.strftime('%b %d, %Y')} "
                                        f"({diff_days} days left). Remaining balance: ₱{rem:,.2f}."
                                    ),
                                    company_id=filcap_cid,
                                    reference_type="lending",
                                    reference_id=bid,
                                    is_read=False,
                                    created_at=now_utc - timedelta(minutes=10 + diff_days),
                                ))

                        # B. Installment / Schedule Cycle Reminders
                        if freq == "Daily":
                            if missed_count > 0:
                                pen_text = f" Accrued penalties: ₱{penalties:,.2f}." if penalties > Decimal("0.00") else ""
                                results.append(NotificationOut(
                                    notification_id=_make_id(NotificationType.LENDING_INSTALLMENT_OVERDUE, bid, missed_count),
                                    notification_type=NotificationType.LENDING_INSTALLMENT_OVERDUE,
                                    title=f"Missed Daily Installments ({missed_count}d): {bname}",
                                    message=(
                                        f"{bname} ({ref}) has {missed_count} missed daily installment"
                                        f"{'s' if missed_count != 1 else ''} ({compliance}). "
                                        f"Daily target: ₱{target:,.2f}.{pen_text}"
                                    ),
                                    company_id=filcap_cid,
                                    reference_type="lending",
                                    reference_id=bid,
                                    is_read=False,
                                    created_at=now_utc - timedelta(minutes=2),
                                ))

                            # Check today's daily installment
                            if start_d and start_d <= today and (not due_d or today <= due_d) and target > Decimal("0.00"):
                                paid_today = sum(
                                    (
                                        Decimal(str(r.get("amount", 0)))
                                        for r in repayments
                                        if str(r.get("cycle_due_date") or r.get("date") or r.get("payment_date") or "").split("T")[0] == today_iso
                                    ),
                                    Decimal("0.00"),
                                )
                                if paid_today < target:
                                    rem_today = min(rem, max(Decimal("0.00"), target - paid_today))
                                    if rem_today > Decimal("0.00"):
                                        results.append(NotificationOut(
                                            notification_id=_make_id(NotificationType.LENDING_DUE_TODAY, "daily", bid, today_iso),
                                            notification_type=NotificationType.LENDING_DUE_TODAY,
                                            title=f"Daily Installment Due Today: {bname}",
                                            message=(
                                                f"{bname} ({ref}) has a daily lending installment of "
                                                f"₱{rem_today:,.2f} due today ({today.strftime('%b %d, %Y')})."
                                            ),
                                            company_id=filcap_cid,
                                            reference_type="lending",
                                            reference_id=bid,
                                            is_read=False,
                                            created_at=now_utc - timedelta(minutes=1),
                                        ))
                        else:
                            # Monthly schedule cycles
                            progress = LendingService.get_monthly_progress(
                                b.get("dateBorrowed"),
                                b.get("dueDate"),
                                b.get("totalAmountPayable", 0),
                                repayments,
                                term_days=int(b.get("termDays") or 2),
                            )
                            for m_info in progress.get("monthDetails", []):
                                m_rem = Decimal(str(m_info.get("remaining", 0)))
                                if m_rem <= Decimal("0.00"):
                                    continue
                                c_due_d = _parse_date_safe(m_info.get("dueDate"))
                                if not c_due_d:
                                    continue
                                m_idx = m_info.get("month_index", 1)
                                c_diff = (c_due_d - today).days

                                if c_diff < 0:
                                    days_ov = abs(c_diff)
                                    results.append(NotificationOut(
                                        notification_id=_make_id(NotificationType.LENDING_INSTALLMENT_OVERDUE, bid, f"M{m_idx}"),
                                        notification_type=NotificationType.LENDING_INSTALLMENT_OVERDUE,
                                        title=f"Overdue Monthly Installment (Month {m_idx}): {bname}",
                                        message=(
                                            f"{bname} ({ref}) — Month {m_idx} installment of ₱{m_rem:,.2f} "
                                            f"was due on {c_due_d.strftime('%b %d, %Y')} "
                                            f"({days_ov} day{'s' if days_ov != 1 else ''} overdue)."
                                        ),
                                        company_id=filcap_cid,
                                        reference_type="lending",
                                        reference_id=bid,
                                        is_read=False,
                                        created_at=now_utc - timedelta(minutes=3),
                                    ))
                                elif c_diff == 0:
                                    results.append(NotificationOut(
                                        notification_id=_make_id(NotificationType.LENDING_DUE_TODAY, bid, f"M{m_idx}"),
                                        notification_type=NotificationType.LENDING_DUE_TODAY,
                                        title=f"Monthly Installment Due Today (Month {m_idx}): {bname}",
                                        message=(
                                            f"{bname} ({ref}) — Month {m_idx} installment of ₱{m_rem:,.2f} "
                                            f"is due TODAY ({c_due_d.strftime('%b %d, %Y')})!"
                                        ),
                                        company_id=filcap_cid,
                                        reference_type="lending",
                                        reference_id=bid,
                                        is_read=False,
                                        created_at=now_utc - timedelta(minutes=1),
                                    ))
                                elif c_diff == 1:
                                    results.append(NotificationOut(
                                        notification_id=_make_id(NotificationType.LENDING_DUE_TOMORROW, bid, f"M{m_idx}"),
                                        notification_type=NotificationType.LENDING_DUE_TOMORROW,
                                        title=f"Monthly Installment Due Tomorrow (Month {m_idx}): {bname}",
                                        message=(
                                            f"{bname} ({ref}) — Month {m_idx} installment of ₱{m_rem:,.2f} "
                                            f"is due tomorrow ({c_due_d.strftime('%b %d, %Y')})."
                                        ),
                                        company_id=filcap_cid,
                                        reference_type="lending",
                                        reference_id=bid,
                                        is_read=False,
                                        created_at=now_utc - timedelta(minutes=6),
                                    ))
                                elif 1 < c_diff <= 7:
                                    results.append(NotificationOut(
                                        notification_id=_make_id(NotificationType.LENDING_DUE_SOON, bid, f"M{m_idx}"),
                                        notification_type=NotificationType.LENDING_DUE_SOON,
                                        title=f"Monthly Installment Due in {c_diff} Days: {bname}",
                                        message=(
                                            f"{bname} ({ref}) — Month {m_idx} installment of ₱{m_rem:,.2f} "
                                            f"is due on {c_due_d.strftime('%b %d, %Y')} ({c_diff} days left)."
                                        ),
                                        company_id=filcap_cid,
                                        reference_type="lending",
                                        reference_id=bid,
                                        is_read=False,
                                        created_at=now_utc - timedelta(minutes=10 + c_diff),
                                    ))

                    # C. Recent Lending Repayment Transactions
                    for r in repayments[:2]:
                        amt_paid = Decimal(str(r.get("amount", 0)))
                        if amt_paid <= Decimal("0.00"):
                            continue
                        tx_id = r.get("transaction_id") or r.get("id")
                        tx_ref = r.get("transaction_ref_no") or r.get("transactionRefNo") or f"TX-{tx_id}"
                        pen_paid = Decimal(str(r.get("penalty_portion") or r.get("penalty") or 0))
                        method = r.get("method") or "Cash"
                        is_settled = rem <= Decimal("0.00")
                        ntype = NotificationType.LENDING_FULLY_SETTLED if is_settled else NotificationType.LENDING_PAYMENT_RECEIVED
                        title = f"Lending Facility Settled: {bname}" if is_settled else f"Lending Payment Received: {bname}"
                        pen_str = f" (+₱{pen_paid:,.2f} late fee)" if pen_paid > Decimal("0.00") else ""
                        ts_raw = r.get("timestamp") or r.get("payment_date") or r.get("date")
                        ts_dt = now_utc - timedelta(hours=1)
                        if ts_raw:
                            try:
                                ts_dt = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
                                if ts_dt.tzinfo is None:
                                    ts_dt = ts_dt.replace(tzinfo=timezone.utc)
                            except Exception:
                                pass
                        results.append(NotificationOut(
                            notification_id=_make_id(ntype, bid, tx_id),
                            notification_type=ntype,
                            title=title,
                            message=(
                                f"{bname} ({ref}) paid ₱{amt_paid:,.2f}{pen_str} via {method} ({tx_ref}). "
                                f"Remaining balance: ₱{rem:,.2f}."
                            ),
                            company_id=filcap_cid,
                            reference_type="lending",
                            reference_id=bid,
                            is_read=False,
                            created_at=ts_dt,
                        ))
                except Exception as b_exc:
                    logger.warning("Lending notification error for borrower %s: %s", b.get("id"), b_exc)
        except Exception as exc:
            logger.warning("Error computing lending notifications: %s", exc)

        return results

    # ── Source 3: Inter-Company Loan Due-Date Notifications ──────────────────

    def _due_date_notifications(
        self,
        company_id: Optional[int],
        name_map: Optional[dict] = None,
        repayments_map: Optional[dict] = None,
        loans: Optional[list[Loan]] = None,
    ) -> list[NotificationOut]:
        today = date.today()
        tomorrow = today + timedelta(days=1)
        now_utc = datetime.now(timezone.utc)

        if loans is None:
            q = self.db.query(Loan).filter(Loan.due_date.isnot(None))
            if company_id is not None:
                q = q.filter(or_(Loan.borrower == company_id, Loan.lender == company_id))
            loans = q.all()
        else:
            loans = [l for l in loans if l.due_date is not None]

        results: list[NotificationOut] = []

        if repayments_map is None:
            _, _, repayments_map, _ = self._load_loans_context(company_id)
        if name_map is None:
            name_map = self._get_company_names_map()

        for loan in loans:
            try:
                status_low = (loan.status or "").lower()
                if "reject" in status_low or "disapprov" in status_low:
                    continue

                repaid = repayments_map.get(loan.loan_id, Decimal("0.00"))
                balance = _calculate_loan_balance(loan, repaid)
                if balance <= Decimal("0.00"):
                    continue

                borrower_name = _company_name(self.db, loan.borrower, name_map)
                lender_name = _company_name(self.db, loan.lender, name_map) if loan.lender else "Corporate Treasury"
                ref = loan.loan_ref_no or str(loan.loan_id)

                if loan.due_date < today:
                    days_overdue = (today - loan.due_date).days

                    if company_id is None or company_id == loan.borrower:
                        results.append(NotificationOut(
                            notification_id=_make_id(NotificationType.LOAN_OVERDUE, "borrower", loan.loan_id),
                            notification_type=NotificationType.LOAN_OVERDUE,
                            title="Overdue Loan Payment",
                            message=(
                                f"Your loan from {lender_name} (Ref: {ref}) is overdue by "
                                f"{days_overdue} day{'s' if days_overdue != 1 else ''}. "
                                f"Outstanding balance: ₱{balance:,.2f}. Please settle immediately."
                            ),
                            company_id=loan.borrower,
                            reference_type="loan",
                            reference_id=loan.loan_id,
                            is_read=False,
                            created_at=now_utc - timedelta(minutes=min(days_overdue, 60)),
                        ))

                    if loan.lender and (company_id is None or company_id == loan.lender):
                        results.append(NotificationOut(
                            notification_id=_make_id(NotificationType.LOAN_OVERDUE, "lender", loan.loan_id),
                            notification_type=NotificationType.LOAN_OVERDUE,
                            title="Overdue Loan — Payment Not Received",
                            message=(
                                f"{borrower_name}'s loan (Ref: {ref}) is overdue by "
                                f"{days_overdue} day{'s' if days_overdue != 1 else ''}. "
                                f"Outstanding balance: ₱{balance:,.2f}."
                            ),
                            company_id=loan.lender,
                            reference_type="loan",
                            reference_id=loan.loan_id,
                            is_read=False,
                            created_at=now_utc - timedelta(minutes=min(days_overdue, 60)),
                        ))

                elif loan.due_date == today:
                    if company_id is None or company_id == loan.borrower:
                        results.append(NotificationOut(
                            notification_id=_make_id(NotificationType.LOAN_DUE_TODAY, "borrower", loan.loan_id),
                            notification_type=NotificationType.LOAN_DUE_TODAY,
                            title="Loan Payment Due Today",
                            message=(
                                f"Your loan from {lender_name} (Ref: {ref}) is due today. "
                                f"Outstanding balance: ₱{balance:,.2f}."
                            ),
                            company_id=loan.borrower,
                            reference_type="loan",
                            reference_id=loan.loan_id,
                            is_read=False,
                            created_at=now_utc,
                        ))

                    if loan.lender and (company_id is None or company_id == loan.lender):
                        results.append(NotificationOut(
                            notification_id=_make_id(NotificationType.LOAN_DUE_TODAY, "lender", loan.loan_id),
                            notification_type=NotificationType.LOAN_DUE_TODAY,
                            title="Loan Payment Expected Today",
                            message=(
                                f"{borrower_name}'s loan (Ref: {ref}) is due today. "
                                f"Outstanding balance: ₱{balance:,.2f}."
                            ),
                            company_id=loan.lender,
                            reference_type="loan",
                            reference_id=loan.loan_id,
                            is_read=False,
                            created_at=now_utc,
                        ))

                elif loan.due_date == tomorrow:
                    if company_id is None or company_id == loan.borrower:
                        results.append(NotificationOut(
                            notification_id=_make_id(NotificationType.LOAN_DUE_TOMORROW, "borrower", loan.loan_id),
                            notification_type=NotificationType.LOAN_DUE_TOMORROW,
                            title="Loan Payment Due Tomorrow",
                            message=(
                                f"Your loan from {lender_name} (Ref: {ref}) is due tomorrow. "
                                f"Outstanding balance: ₱{balance:,.2f}. Please prepare payment."
                            ),
                            company_id=loan.borrower,
                            reference_type="loan",
                            reference_id=loan.loan_id,
                            is_read=False,
                            created_at=now_utc - timedelta(minutes=5),
                        ))

                    if loan.lender and (company_id is None or company_id == loan.lender):
                        results.append(NotificationOut(
                            notification_id=_make_id(NotificationType.LOAN_DUE_TOMORROW, "lender", loan.loan_id),
                            notification_type=NotificationType.LOAN_DUE_TOMORROW,
                            title="Loan Payment Expected Tomorrow",
                            message=(
                                f"{borrower_name}'s loan (Ref: {ref}) is due tomorrow. "
                                f"Outstanding balance: ₱{balance:,.2f}."
                            ),
                            company_id=loan.lender,
                            reference_type="loan",
                            reference_id=loan.loan_id,
                            is_read=False,
                            created_at=now_utc - timedelta(minutes=5),
                        ))

                elif today < loan.due_date <= today + timedelta(days=7):
                    days_left = (loan.due_date - today).days
                    if company_id is None or company_id == loan.borrower:
                        results.append(NotificationOut(
                            notification_id=_make_id(NotificationType.LOAN_DUE_SOON, "borrower", loan.loan_id),
                            notification_type=NotificationType.LOAN_DUE_SOON,
                            title=f"Loan Payment Due Soon ({days_left} Days)",
                            message=(
                                f"Your loan from {lender_name} (Ref: {ref}) is due on "
                                f"{loan.due_date.strftime('%b %d, %Y')} ({days_left} days left). "
                                f"Outstanding balance: ₱{balance:,.2f}."
                            ),
                            company_id=loan.borrower,
                            reference_type="loan",
                            reference_id=loan.loan_id,
                            is_read=False,
                            created_at=now_utc - timedelta(minutes=10 + days_left),
                        ))

                    if loan.lender and (company_id is None or company_id == loan.lender):
                        results.append(NotificationOut(
                            notification_id=_make_id(NotificationType.LOAN_DUE_SOON, "lender", loan.loan_id),
                            notification_type=NotificationType.LOAN_DUE_SOON,
                            title=f"Loan Payment Expected Soon ({days_left} Days)",
                            message=(
                                f"{borrower_name}'s loan (Ref: {ref}) is due on "
                                f"{loan.due_date.strftime('%b %d, %Y')} ({days_left} days left). "
                                f"Outstanding balance: ₱{balance:,.2f}."
                            ),
                            company_id=loan.lender,
                            reference_type="loan",
                            reference_id=loan.loan_id,
                            is_read=False,
                            created_at=now_utc - timedelta(minutes=10 + days_left),
                        ))

            except Exception as exc:
                logger.warning("Due-date notification error for loan %s: %s", loan.loan_id, exc)

        return results

    # ── Source 3B: Pending Approval Notifications (live loan records) ────────

    def _pending_approval_notifications(
        self,
        company_id: Optional[int],
        name_map: Optional[dict] = None,
        loans: Optional[list[Loan]] = None,
    ) -> list[NotificationOut]:
        if loans is None:
            q = self.db.query(Loan).filter(Loan.status.ilike("%pending%"))
            if company_id is not None:
                q = q.filter(or_(Loan.borrower == company_id, Loan.lender == company_id))
            pending_loans = q.all()
        else:
            pending_loans = [l for l in loans if "pending" in (l.status or "").lower()]

        results: list[NotificationOut] = []

        if name_map is None:
            name_map = self._get_company_names_map()

        for loan in pending_loans:
            try:
                borrower_name = _company_name(self.db, loan.borrower, name_map)
                lender_name = _company_name(self.db, loan.lender, name_map) if loan.lender else "Corporate Treasury"
                ref = loan.loan_ref_no or str(loan.loan_id)
                amount = loan.principal_amount or Decimal("0.00")

                if loan.lender and (company_id is None or company_id == loan.lender):
                    results.append(NotificationOut(
                        notification_id=_make_id(NotificationType.LOAN_PENDING_APPROVAL, "lender", loan.loan_id),
                        notification_type=NotificationType.LOAN_PENDING_APPROVAL,
                        title="Loan Approval Required",
                        message=(
                            f"{borrower_name} requested an inter-company loan of ₱{amount:,.2f} "
                            f"(Ref: {ref}) requiring your authorization."
                        ),
                        company_id=loan.lender,
                        reference_type="loan",
                        reference_id=loan.loan_id,
                        is_read=False,
                        created_at=loan.created_at or datetime.now(timezone.utc),
                    ))

                if company_id is None or company_id == loan.borrower:
                    results.append(NotificationOut(
                        notification_id=_make_id(NotificationType.LOAN_PENDING_APPROVAL, "borrower", loan.loan_id),
                        notification_type=NotificationType.LOAN_PENDING_APPROVAL,
                        title="Loan Request Pending Approval",
                        message=(
                            f"Your loan request of ₱{amount:,.2f} to {lender_name} "
                            f"(Ref: {ref}) is awaiting approval ({loan.status})."
                        ),
                        company_id=loan.borrower,
                        reference_type="loan",
                        reference_id=loan.loan_id,
                        is_read=False,
                        created_at=loan.created_at or datetime.now(timezone.utc),
                    ))
            except Exception as exc:
                logger.warning("Pending approval notification error for loan %s: %s", loan.loan_id, exc)

        return results

    # ── Source 3C: Repayment Notifications (LoanRepayment + AuditLog) ────────

    def _repayment_notifications(
        self,
        company_id: Optional[int],
        name_map: Optional[dict] = None,
        recent_repayments: Optional[list[tuple[LoanRepayment, Loan]]] = None,
        loans_by_id: Optional[dict[int, Loan]] = None,
        audit_rows: Optional[list[AuditLog]] = None,
    ) -> list[NotificationOut]:
        results: list[NotificationOut] = []
        if name_map is None:
            name_map = self._get_company_names_map()

        seen_repayment_ids: set[int] = set()

        # 1. Direct LoanRepayment table records
        try:
            if recent_repayments is None:
                rep_q = self.db.query(LoanRepayment, Loan).join(Loan, LoanRepayment.loan_id == Loan.loan_id)
                if company_id is not None:
                    rep_q = rep_q.filter(or_(Loan.borrower == company_id, Loan.lender == company_id))
                rep_rows = rep_q.order_by(LoanRepayment.created_at.desc()).limit(30).all()
            else:
                rep_rows = recent_repayments

            for rep, loan in rep_rows:
                seen_repayment_ids.add(int(rep.loan_repayment_id))
                amount_paid = rep.amount or Decimal("0.00")
                remaining = rep.remaining_balance if rep.remaining_balance is not None else Decimal("0.00")
                borrower_name = _company_name(self.db, loan.borrower, name_map)
                lender_name = _company_name(self.db, loan.lender, name_map) if loan.lender else "Corporate Treasury"
                ref = loan.loan_ref_no or str(loan.loan_id)
                is_full = remaining <= Decimal("0.00")
                ts = rep.created_at or datetime.combine(rep.payment_date, datetime.min.time()).replace(tzinfo=timezone.utc)

                if loan.lender and (company_id is None or company_id == loan.lender):
                    n_type = NotificationType.LOAN_FULLY_SETTLED if is_full else NotificationType.LOAN_REPAYMENT_RECEIVED
                    n_title = "Loan Fully Settled" if is_full else "Loan Repayment Received"
                    n_msg = (
                        f"{borrower_name} has fully settled their loan (Ref: {ref}). Final payment: ₱{amount_paid:,.2f}."
                        if is_full
                        else f"{borrower_name} made a payment of ₱{amount_paid:,.2f} on loan (Ref: {ref}). Remaining balance: ₱{remaining:,.2f}."
                    )
                    results.append(NotificationOut(
                        notification_id=_make_id(n_type, "lender", rep.loan_repayment_id),
                        notification_type=n_type,
                        title=n_title,
                        message=n_msg,
                        company_id=loan.lender,
                        reference_type="loan_repayment",
                        reference_id=rep.loan_repayment_id,
                        is_read=False,
                        created_at=ts,
                    ))

                if company_id is None or company_id == loan.borrower:
                    b_type = NotificationType.LOAN_FULLY_SETTLED if is_full else NotificationType.LOAN_REPAYMENT_SENT
                    b_title = "Loan Fully Settled" if is_full else "Loan Payment Recorded"
                    b_msg = (
                        f"Your payment of ₱{amount_paid:,.2f} for loan (Ref: {ref}) to {lender_name} has been recorded. Loan is now fully settled."
                        if is_full
                        else f"Your payment of ₱{amount_paid:,.2f} for loan (Ref: {ref}) to {lender_name} has been recorded. Remaining balance: ₱{remaining:,.2f}."
                    )
                    results.append(NotificationOut(
                        notification_id=_make_id(b_type, "borrower", rep.loan_repayment_id),
                        notification_type=b_type,
                        title=b_title,
                        message=b_msg,
                        company_id=loan.borrower,
                        reference_type="loan_repayment",
                        reference_id=rep.loan_repayment_id,
                        is_read=False,
                        created_at=ts,
                    ))
        except Exception as exc:
            logger.warning("Direct loan repayment notification error: %s", exc)

        # 2. Fallback from AuditLog for any historical repayments
        try:
            if audit_rows is None:
                q = self.db.query(AuditLog).filter(
                    AuditLog.action == "LOAN_UPDATED",
                    AuditLog.details.isnot(None),
                )
                if company_id is not None:
                    q = q.filter(AuditLog.company_id == company_id)
                audit_rows = q.order_by(AuditLog.created_at.desc()).limit(50).all()

            parsed_items: list[tuple[AuditLog, dict, int]] = []
            needed_loan_ids: set[int] = set()

            for row in audit_rows:
                details = _parse_details(row.details)
                if details.get("record_type") == "loan_repayment" and details.get("record_id"):
                    rep_id = details.get("repayment_id")
                    if rep_id and int(rep_id) in seen_repayment_ids:
                        continue
                    lid = int(details["record_id"])
                    parsed_items.append((row, details, lid))
                    needed_loan_ids.add(lid)

            known_loans: dict[int, Loan] = dict(loans_by_id or {})
            missing_loan_ids = needed_loan_ids - set(known_loans.keys())
            if missing_loan_ids:
                found_loans = self.db.query(Loan).filter(Loan.loan_id.in_(list(missing_loan_ids))).all()
                for l in found_loans:
                    known_loans[l.loan_id] = l

            for row, details, loan_id in parsed_items:
                loan = known_loans.get(loan_id)
                if not loan:
                    continue

                repayment_id = details.get("repayment_id")
                amount_paid = Decimal(str(details.get("amount", "0")))
                remaining = Decimal(str(details.get("remaining_balance", "0")))

                borrower_name = _company_name(self.db, loan.borrower, name_map)
                lender_name = _company_name(self.db, loan.lender, name_map)
                ref = loan.loan_ref_no or str(loan_id)
                is_full = remaining <= Decimal("0.00")
                ts = row.created_at or datetime.now(timezone.utc)

                if loan.lender and (company_id is None or company_id == loan.lender):
                    n_type = NotificationType.LOAN_FULLY_SETTLED if is_full else NotificationType.LOAN_REPAYMENT_RECEIVED
                    n_title = "Loan Fully Settled" if is_full else "Loan Repayment Received"
                    n_msg = (
                        f"{borrower_name} has fully settled their loan (Ref: {ref}). Final payment: ₱{amount_paid:,.2f}."
                        if is_full
                        else f"{borrower_name} made a payment of ₱{amount_paid:,.2f} on loan (Ref: {ref}). Remaining balance: ₱{remaining:,.2f}."
                    )
                    results.append(NotificationOut(
                        notification_id=_make_id(n_type, "lender", repayment_id or row.audit_log_id),
                        notification_type=n_type,
                        title=n_title,
                        message=n_msg,
                        company_id=loan.lender,
                        reference_type="loan_repayment",
                        reference_id=repayment_id or loan_id,
                        is_read=False,
                        created_at=ts,
                    ))

                if company_id is None or company_id == loan.borrower:
                    b_type = NotificationType.LOAN_FULLY_SETTLED if is_full else NotificationType.LOAN_REPAYMENT_SENT
                    b_title = "Loan Fully Settled" if is_full else "Payment Recorded"
                    b_msg = (
                        f"Your payment of ₱{amount_paid:,.2f} for loan (Ref: {ref}) to {lender_name} has been recorded. Loan is now fully settled."
                        if is_full
                        else f"Your payment of ₱{amount_paid:,.2f} for loan (Ref: {ref}) to {lender_name} has been recorded. Remaining balance: ₱{remaining:,.2f}."
                    )
                    results.append(NotificationOut(
                        notification_id=_make_id(b_type, "borrower", repayment_id or row.audit_log_id),
                        notification_type=b_type,
                        title=b_title,
                        message=b_msg,
                        company_id=loan.borrower,
                        reference_type="loan_repayment",
                        reference_id=repayment_id or loan_id,
                        is_read=False,
                        created_at=ts,
                    ))
        except Exception as exc:
            logger.warning("Audit repayment notification error: %s", exc)

        return results

    # ── Source 3D: Role-based Loan Workflow Notifications ────────────────────

    def _loan_workflow_notifications(
        self,
        user_role: Optional[str],
        company_id: Optional[int],
        name_map: Optional[dict] = None,
        loans: Optional[list[Loan]] = None,
    ) -> list[NotificationOut]:
        results: list[NotificationOut] = []
        if name_map is None:
            name_map = self._get_company_names_map()
        role = (user_role or "supervisor").strip().lower() or "supervisor"

        try:
            if loans is None:
                q = self.db.query(Loan)
                if company_id is not None:
                    q = q.filter(or_(Loan.borrower == company_id, Loan.lender == company_id))
                loans = q.order_by(Loan.created_at.desc()).all()

            if role in ("finance", "admin"):
                pending_finance = [
                    l for l in loans
                    if l.status in ("Pending Finance Endorsement", "Pending Approval")
                    and (company_id is None or l.borrower == company_id or l.lender == company_id)
                ][:20]
                for loan in pending_finance:
                    borrower_name = _company_name(self.db, loan.borrower, name_map)
                    ref = loan.loan_ref_no or str(loan.loan_id)
                    amt = loan.principal_amount or Decimal("0.00")
                    results.append(NotificationOut(
                        notification_id=_make_id(NotificationType.LOAN_REQUEST_FINANCE, loan.loan_id),
                        notification_type=NotificationType.LOAN_REQUEST_FINANCE,
                        title="New Loan Request (Finance Endorsement)",
                        message=f"{borrower_name} requested a loan of ₱{amt:,.2f} (Ref: {ref}) awaiting your review and endorsement.",
                        company_id=loan.borrower,
                        reference_type="loan",
                        reference_id=loan.loan_id,
                        is_read=False,
                        created_at=loan.created_at or datetime.now(timezone.utc),
                    ))

            if role in ("audit", "auditor", "admin"):
                pending_audit = sorted(
                    [
                        l for l in loans
                        if l.status == "Pending Audit Approval"
                        and (company_id is None or l.borrower == company_id or l.lender == company_id)
                    ],
                    key=lambda l: _normalize_dt(l.updated_at or l.created_at),
                    reverse=True,
                )[:20]
                for loan in pending_audit:
                    borrower_name = _company_name(self.db, loan.borrower, name_map)
                    lender_name = _company_name(self.db, loan.lender, name_map) if loan.lender else "Corporate Treasury"
                    ref = loan.loan_ref_no or str(loan.loan_id)
                    amt = loan.principal_amount or Decimal("0.00")
                    results.append(NotificationOut(
                        notification_id=_make_id(NotificationType.LOAN_ENDORSED_AUDIT, loan.loan_id),
                        notification_type=NotificationType.LOAN_ENDORSED_AUDIT,
                        title="Loan Endorsed for Audit Review",
                        message=f"Loan request of ₱{amt:,.2f} for {borrower_name} from {lender_name} (Ref: {ref}) was endorsed by Finance and awaits compliance approval.",
                        company_id=loan.borrower,
                        reference_type="loan",
                        reference_id=loan.loan_id,
                        is_read=False,
                        created_at=loan.endorsed_at or loan.updated_at or datetime.now(timezone.utc),
                    ))

            if role in ("supervisor", "company", "admin"):
                supervisor_loans = sorted(
                    [
                        l for l in loans
                        if l.status in ("Approved", "Disapproved by Audit", "Rejected by Finance")
                        and (company_id is None or l.borrower == company_id)
                    ],
                    key=lambda l: _normalize_dt(l.updated_at or l.created_at),
                    reverse=True,
                )[:20]
                for loan in supervisor_loans:
                    lender_name = _company_name(self.db, loan.lender, name_map) if loan.lender else "Corporate Treasury"
                    ref = loan.loan_ref_no or str(loan.loan_id)
                    amt = loan.principal_amount or Decimal("0.00")
                    is_approved = loan.status == "Approved"
                    ntype = NotificationType.LOAN_APPROVED_SUPERVISOR if is_approved else NotificationType.LOAN_REJECTED_SUPERVISOR
                    title = "Loan Request Approved" if is_approved else f"Loan Request {loan.status}"
                    if is_approved:
                        msg = f"Your loan request of ₱{amt:,.2f} from {lender_name} (Ref: {ref}) has been approved by Internal Audit. Funds disbursed to your account."
                    else:
                        reason = loan.audit_remark or loan.finance_remark or "Request declined."
                        msg = f"Your loan request (Ref: {ref}) of ₱{amt:,.2f} was {loan.status.lower()}: {reason}"
                    results.append(NotificationOut(
                        notification_id=_make_id(ntype, loan.loan_id, loan.status.replace(" ", "_")),
                        notification_type=ntype,
                        title=title,
                        message=msg,
                        company_id=loan.borrower,
                        reference_type="loan",
                        reference_id=loan.loan_id,
                        is_read=False,
                        created_at=loan.audit_reviewed_at or loan.endorsed_at or loan.updated_at or datetime.now(timezone.utc),
                    ))
        except Exception as exc:
            logger.warning("Error computing loan workflow notifications: %s", exc)

        return results

    # ── Source 4: Tenant Lease Due-Date & Rent Payment Notifications ─────────

    def _tenant_notifications(
        self,
        company_id: Optional[int],
        name_map: Optional[dict] = None,
    ) -> list[NotificationOut]:
        results: list[NotificationOut] = []
        if name_map is None:
            name_map = self._get_company_names_map()

        today = date.today()
        now_utc = datetime.now(timezone.utc)

        try:
            from app.models.tenant import TenantLease
            from app.services.tenant_service import add_period_clamped, count_periods

            q = self.db.query(TenantLease).options(selectinload(TenantLease.payments))
            if company_id is not None:
                q = q.filter(TenantLease.company_id == company_id)
            leases = q.order_by(TenantLease.lease_id.desc()).all()

            for lease in leases:
                try:
                    if (lease.status or "").lower() == "completed":
                        continue

                    cname = _company_name(self.db, lease.company_id, name_map)
                    tname = lease.tenant_name
                    unit = lease.unit_name
                    rent = Decimal(str(lease.rent_amount or 0))
                    total_payable = Decimal(str(lease.total_amount_payable or rent))
                    paid_total = sum(
                        (
                            Decimal(str(p.amount or 0))
                            for p in (lease.payments or [])
                            if (p.status or "Paid").lower() != "missed"
                        ),
                        Decimal("0.00"),
                    )
                    rem_total = max(Decimal("0.00"), total_payable - paid_total)
                    if rem_total <= Decimal("0.00"):
                        continue

                    # Determine next unpaid period due date
                    mode = lease.repeat_mode or "None"
                    next_due: Optional[date] = lease.due_date
                    due_amt = rem_total

                    if mode in ("Daily", "Monthly", "Quarterly", "Annually") and lease.due_date and lease.lease_end_date and rent > Decimal("0.00"):
                        n_periods = count_periods(lease.due_date, lease.lease_end_date, mode)
                        completed_periods = int(paid_total // rent)
                        if completed_periods < n_periods:
                            next_due = add_period_clamped(lease.due_date, mode, completed_periods)
                            paid_in_current = paid_total - (Decimal(str(completed_periods)) * rent)
                            due_amt = max(Decimal("0.00"), rent - paid_in_current)

                    if next_due:
                        diff_days = (next_due - today).days
                        if diff_days < 0:
                            days_ov = abs(diff_days)
                            results.append(NotificationOut(
                                notification_id=_make_id(NotificationType.TENANT_OVERDUE, lease.lease_id, next_due.isoformat()),
                                notification_type=NotificationType.TENANT_OVERDUE,
                                title=f"Overdue Tenant Rent: {tname}",
                                message=(
                                    f"{tname} ({unit} • {cname}) rent of ₱{due_amt:,.2f} was due on "
                                    f"{next_due.strftime('%b %d, %Y')} ({days_ov} day{'s' if days_ov != 1 else ''} overdue)."
                                ),
                                company_id=lease.company_id,
                                reference_type="tenant",
                                reference_id=lease.lease_id,
                                is_read=False,
                                created_at=now_utc - timedelta(minutes=min(days_ov, 60)),
                            ))
                        elif diff_days == 0:
                            results.append(NotificationOut(
                                notification_id=_make_id(NotificationType.TENANT_DUE_TODAY, lease.lease_id, next_due.isoformat()),
                                notification_type=NotificationType.TENANT_DUE_TODAY,
                                title=f"Tenant Rent Due Today: {tname}",
                                message=(
                                    f"{tname} ({unit} • {cname}) rent of ₱{due_amt:,.2f} is due TODAY "
                                    f"({next_due.strftime('%b %d, %Y')})!"
                                ),
                                company_id=lease.company_id,
                                reference_type="tenant",
                                reference_id=lease.lease_id,
                                is_read=False,
                                created_at=now_utc,
                            ))
                        elif diff_days == 1:
                            results.append(NotificationOut(
                                notification_id=_make_id(NotificationType.TENANT_DUE_TOMORROW, lease.lease_id, next_due.isoformat()),
                                notification_type=NotificationType.TENANT_DUE_TOMORROW,
                                title=f"Tenant Rent Due Tomorrow: {tname}",
                                message=(
                                    f"{tname} ({unit} • {cname}) rent of ₱{due_amt:,.2f} is due tomorrow "
                                    f"({next_due.strftime('%b %d, %Y')})."
                                ),
                                company_id=lease.company_id,
                                reference_type="tenant",
                                reference_id=lease.lease_id,
                                is_read=False,
                                created_at=now_utc - timedelta(minutes=5),
                            ))
                        elif 1 < diff_days <= 7:
                            results.append(NotificationOut(
                                notification_id=_make_id(NotificationType.TENANT_DUE_SOON, lease.lease_id, next_due.isoformat()),
                                notification_type=NotificationType.TENANT_DUE_SOON,
                                title=f"Tenant Rent Due in {diff_days} Days: {tname}",
                                message=(
                                    f"{tname} ({unit} • {cname}) rent of ₱{due_amt:,.2f} is due on "
                                    f"{next_due.strftime('%b %d, %Y')} ({diff_days} days left)."
                                ),
                                company_id=lease.company_id,
                                reference_type="tenant",
                                reference_id=lease.lease_id,
                                is_read=False,
                                created_at=now_utc - timedelta(minutes=10 + diff_days),
                            ))

                    # Recent rent payments (sorted newest first)
                    sorted_payments = sorted(
                        lease.payments or [],
                        key=lambda p: (p.payment_date or date.min, p.payment_id or 0),
                        reverse=True,
                    )[:2]
                    for p in sorted_payments:
                        if (p.status or "Paid").lower() == "missed" or (p.amount or 0) <= 0:
                            continue
                        ts = p.created_at or datetime.combine(p.payment_date, datetime.min.time()).replace(tzinfo=timezone.utc)
                        results.append(NotificationOut(
                            notification_id=_make_id(NotificationType.TENANT_PAYMENT_RECEIVED, lease.lease_id, p.payment_id),
                            notification_type=NotificationType.TENANT_PAYMENT_RECEIVED,
                            title=f"Tenant Rent Received: {tname}",
                            message=(
                                f"{tname} ({unit}) paid ₱{Decimal(str(p.amount)):,.2f} via {p.method or 'Cash'}."
                            ),
                            company_id=lease.company_id,
                            reference_type="tenant",
                            reference_id=lease.lease_id,
                            is_read=False,
                            created_at=ts,
                        ))
                except Exception as l_exc:
                    logger.warning("Tenant notification error for lease %s: %s", lease.lease_id, l_exc)
        except Exception as exc:
            logger.warning("Error computing tenant notifications: %s", exc)

        return results

    # ── Source 5: Role-based Petty Cash Workflow & Low Balance Notifications ─

    def _petty_cash_workflow_notifications(
        self,
        user_role: Optional[str],
        company_id: Optional[int],
        name_map: Optional[dict] = None,
        topups: Optional[list] = None,
    ) -> list[NotificationOut]:
        results: list[NotificationOut] = []
        if name_map is None:
            name_map = self._get_company_names_map()
        role = (user_role or "supervisor").strip().lower() or "supervisor"

        try:
            if topups is None:
                topups = self._load_petty_cash_topups(company_id)

            if role in ("finance", "admin"):
                pending_finance = [
                    t for t in topups
                    if t.status == "Pending Finance Endorsement"
                    and (company_id is None or t.company_id == company_id)
                ][:20]
                for topup in pending_finance:
                    cname = _company_name(self.db, topup.company_id, name_map)
                    ref = topup.reference_no or str(topup.topup_id)
                    amt = topup.amount or Decimal("0.00")
                    results.append(NotificationOut(
                        notification_id=_make_id(NotificationType.PETTY_CASH_REQUEST, topup.topup_id),
                        notification_type=NotificationType.PETTY_CASH_REQUEST,
                        title="Petty Cash Request (Finance Endorsement)",
                        message=f"{cname} requested a petty cash top-up of ₱{amt:,.2f} (Ref: {ref}) awaiting your review and endorsement.",
                        company_id=topup.company_id,
                        reference_type="petty_cash",
                        reference_id=topup.topup_id,
                        is_read=False,
                        created_at=topup.created_at or datetime.now(timezone.utc),
                    ))

            if role in ("audit", "auditor", "admin"):
                pending_audit = [
                    t for t in topups
                    if t.status == "Pending Audit Approval"
                    and (company_id is None or t.company_id == company_id)
                ][:20]
                for topup in pending_audit:
                    cname = _company_name(self.db, topup.company_id, name_map)
                    ref = topup.reference_no or str(topup.topup_id)
                    amt = topup.amount or Decimal("0.00")
                    results.append(NotificationOut(
                        notification_id=_make_id(NotificationType.PETTY_CASH_AUDIT, topup.topup_id),
                        notification_type=NotificationType.PETTY_CASH_AUDIT,
                        title="Petty Cash Audit Compliance Required",
                        message=f"Petty cash top-up of ₱{amt:,.2f} for {cname} (Ref: {ref}) was endorsed by Finance and awaits Audit approval.",
                        company_id=topup.company_id,
                        reference_type="petty_cash",
                        reference_id=topup.topup_id,
                        is_read=False,
                        created_at=topup.endorsed_at or topup.created_at or datetime.now(timezone.utc),
                    ))

            if role in ("supervisor", "company", "admin"):
                topup_rows = [
                    t for t in topups
                    if t.status in ("Approved", "Rejected by Finance", "Disapproved by Audit", "Disapproved")
                    and (company_id is None or t.company_id == company_id)
                ][:20]
                for topup in topup_rows:
                    ref = topup.reference_no or str(topup.topup_id)
                    amt = topup.amount or Decimal("0.00")
                    is_approved = topup.status == "Approved"
                    ntype = NotificationType.PETTY_CASH_APPROVED if is_approved else NotificationType.PETTY_CASH_REJECTED
                    title = "Petty Cash Top-up Approved" if is_approved else f"Petty Cash {topup.status}"
                    if is_approved:
                        msg = f"Your petty cash top-up of ₱{amt:,.2f} (Ref: {ref}) has been approved by Audit and credited to your petty cash wallet."
                    else:
                        reason = topup.remark or topup.finance_remark or "Request declined."
                        msg = f"Your petty cash top-up of ₱{amt:,.2f} (Ref: {ref}) was {topup.status.lower()}: {reason}"
                    results.append(NotificationOut(
                        notification_id=_make_id(ntype, topup.topup_id, topup.status.replace(" ", "_")),
                        notification_type=ntype,
                        title=title,
                        message=msg,
                        company_id=topup.company_id,
                        reference_type="petty_cash",
                        reference_id=topup.topup_id,
                        is_read=False,
                        created_at=topup.reviewed_at or topup.endorsed_at or topup.created_at or datetime.now(timezone.utc),
                    ))
        except Exception as exc:
            logger.warning("Error computing petty cash workflow notifications: %s", exc)

        return results

    def _petty_cash_low_balance_notifications(
        self,
        company_id: Optional[int],
        name_map: Optional[dict] = None,
        topups: Optional[list] = None,
    ) -> list[NotificationOut]:
        """
        Computes authoritative petty cash balance per company using local SQLAlchemy
        aggregation (SUM of approved non-seed PettyCashTopUp minus SUM of non-seed
        petty-cash Expense) without remote Supabase REST calls.
        """
        results: list[NotificationOut] = []
        now_utc = datetime.now(timezone.utc)
        if name_map is None:
            name_map = self._get_company_names_map()

        try:
            from app.models.finance import Category, Expense
            from app.models.petty_cash import PettyCashWallet

            if topups is None:
                topups = self._load_petty_cash_topups(company_id)

            # 1. Sum approved non-seed topups per company from already-loaded PettyCashTopUp rows
            topups_by_company: dict[int, Decimal] = {}
            for t in topups:
                if t.company_id is None:
                    continue
                if t.reference_no and str(t.reference_no).upper().startswith("SEED-"):
                    continue
                if (t.status or "Approved").lower() == "approved":
                    amt = Decimal(str(t.amount or 0)).quantize(Decimal("0.01"))
                    topups_by_company[t.company_id] = topups_by_company.get(t.company_id, Decimal("0.00")) + amt

            # 2. Aggregate non-seed petty cash expenses per company in a single SQL GROUP BY query
            exp_q = (
                self.db.query(
                    Expense.company_id,
                    func.coalesce(func.sum(Expense.amount), 0),
                )
                .outerjoin(Category, Expense.category_id == Category.category_id)
                .filter(
                    or_(
                        func.lower(func.trim(func.coalesce(Expense.payment_method, ""))).like("%petty cash%"),
                        func.lower(func.trim(func.coalesce(Category.name, ""))) == "petty cash",
                    ),
                    or_(~Expense.reference_no.like("SEED-%"), Expense.reference_no.is_(None)),
                )
            )
            if company_id is not None:
                exp_q = exp_q.filter(Expense.company_id == company_id)
            exp_rows = exp_q.group_by(Expense.company_id).all()
            expenses_by_company: dict[int, Decimal] = {
                cid: Decimal(str(total or 0)).quantize(Decimal("0.01"))
                for cid, total in exp_rows
                if cid is not None
            }

            # 3. Load wallet thresholds in a single query
            wallet_q = self.db.query(PettyCashWallet)
            if company_id is not None:
                wallet_q = wallet_q.filter(PettyCashWallet.company_id == company_id)
            thresholds_by_company: dict[int, Decimal] = {
                w.company_id: Decimal(str(w.low_balance_threshold or "1000.00")).quantize(Decimal("0.01"))
                for w in wallet_q.all()
                if w.company_id is not None
            }

            target_company_ids = (
                [company_id]
                if company_id is not None
                else sorted(name_map.keys())
            )

            for cid in target_company_ids:
                if cid is None:
                    continue
                total_topups = topups_by_company.get(cid, Decimal("0.00"))
                total_spent = expenses_by_company.get(cid, Decimal("0.00"))
                if total_topups <= Decimal("0.00") and total_spent <= Decimal("0.00"):
                    continue
                balance = total_topups - total_spent
                threshold = thresholds_by_company.get(cid, Decimal("1000.00"))
                if balance < threshold:
                    cname = name_map.get(cid) or _company_name(self.db, cid, name_map)
                    results.append(NotificationOut(
                        notification_id=_make_id(NotificationType.PETTY_CASH_LOW_BALANCE, cid),
                        notification_type=NotificationType.PETTY_CASH_LOW_BALANCE,
                        title=f"Low Petty Cash Balance: {cname}",
                        message=(
                            f"{cname}'s petty cash wallet balance is ₱{balance:,.2f}, "
                            f"below the ₱{threshold:,.2f} threshold. Please request a top-up."
                        ),
                        company_id=cid,
                        reference_type="petty_cash",
                        reference_id=cid,
                        is_read=False,
                        created_at=now_utc - timedelta(minutes=15),
                    ))
        except Exception as exc:
            logger.warning("Error computing petty cash low balance notifications: %s", exc)

        return results

    # ── Source 6: Deposit & Sales Audit Notifications ────────────────────────

    def _deposit_workflow_notifications(
        self,
        user_role: Optional[str],
        company_id: Optional[int],
        name_map: Optional[dict] = None,
        audit_rows: Optional[list[AuditLog]] = None,
    ) -> list[NotificationOut]:
        results: list[NotificationOut] = []
        if name_map is None:
            name_map = self._get_company_names_map()
        role = (user_role or "supervisor").strip().lower() or "supervisor"

        if role not in ("supervisor", "company", "admin"):
            return results

        try:
            if audit_rows is None:
                q = self.db.query(AuditLog).filter(
                    AuditLog.action.in_(["SALE_UPDATED", "SALE_CREATED"]),
                    AuditLog.details.isnot(None),
                )
                if company_id is not None:
                    q = q.filter(AuditLog.company_id == company_id)
                audit_rows = q.order_by(AuditLog.created_at.desc()).limit(30).all()

            for row in audit_rows:
                details = _parse_details(row.details)
                record_id = details.get("record_id") or getattr(row, "record_id", None)
                is_deposit_or_verified = (
                    details.get("audit_status") in ("Verified", "Audited")
                    or details.get("status") == "Paid"
                    or details.get("record_type") in ("deposit", "sales_deposit")
                )
                if is_deposit_or_verified and record_id:
                    cname = _company_name(self.db, row.company_id, name_map)
                    amt = details.get("amount") or details.get("net_amount") or 0.0
                    try:
                        amt_num = float(amt)
                    except Exception:
                        amt_num = 0.0
                    amt_str = f"₱{amt_num:,.2f} " if amt_num > 0 else ""
                    results.append(NotificationOut(
                        notification_id=_make_id(NotificationType.DEPOSIT_VERIFIED, row.audit_log_id),
                        notification_type=NotificationType.DEPOSIT_VERIFIED,
                        title="Deposit / Sales Verified by Audit",
                        message=f"Deposit {amt_str}for {cname} has been verified and approved by Internal Audit.",
                        company_id=row.company_id,
                        reference_type="deposit",
                        reference_id=int(record_id),
                        is_read=False,
                        created_at=row.created_at or datetime.now(timezone.utc),
                    ))
        except Exception as exc:
            logger.warning("Error computing deposit workflow notifications: %s", exc)

        return results


# ── New Persistent Inbox & Retention Architecture ──────────────────────────

from app.models.notification import Notification, NotificationOutbox
from app.schemas.notification import NotificationListResponse
from app.services.notification_dispatcher import resolve_event_recipients

NOTIF_SCHEDULER_LOCK_ID = 884_209_101
DEFAULT_RETENTION_DAYS = 90


def _extend_service(cls):
    def get_notifications_feed(
        self,
        recipient_user_id: int,
        company_id: Optional[int] = None,
        cursor: Optional[str] = None,
        direction: str = "before",
        notification_type: Optional[str] = None,
        limit: int = 50,
    ) -> NotificationListResponse:
        from sqlalchemy import select, or_, and_
        query = select(Notification).where(Notification.recipient_user_id == recipient_user_id)

        if company_id is not None:
            query = query.where(Notification.company_id == company_id)

        if notification_type:
            query = query.where(Notification.notification_type == notification_type.upper())

        if cursor:
            try:
                cursor_dt_str, cursor_id = cursor.split("|", 1)
                cursor_dt = datetime.fromisoformat(cursor_dt_str)
                if cursor_dt.tzinfo is None:
                    cursor_dt = cursor_dt.replace(tzinfo=timezone.utc)
            except Exception:
                raise ValueError("Invalid cursor format. Expected ISO_DATE|ID.")

            if direction == "after":
                query = query.where(
                    or_(
                        Notification.created_at > cursor_dt,
                        and_(Notification.created_at == cursor_dt, Notification.notification_id > cursor_id),
                    )
                ).order_by(Notification.created_at.asc(), Notification.notification_id.asc())
            else:
                query = query.where(
                    or_(
                        Notification.created_at < cursor_dt,
                        and_(Notification.created_at == cursor_dt, Notification.notification_id < cursor_id),
                    )
                ).order_by(Notification.created_at.desc(), Notification.notification_id.desc())
        else:
            query = query.order_by(Notification.created_at.desc(), Notification.notification_id.desc())

        items = self.db.scalars(query.limit(limit + 1)).all()
        
        # If persistent table has no items for this user yet, fallback to computed items
        if not items and not cursor:
            computed = self.get_notifications(company_id=company_id, notification_type=notification_type, limit=limit)
            return NotificationListResponse(
                items=computed,
                next_cursor=None,
                has_more=False,
                total_unread=len(computed),
            )

        has_more = len(items) > limit
        results = items[:limit]

        next_cursor = None
        if results:
            last = results[-1]
            c_dt = last.created_at.isoformat() if last.created_at else datetime.now(timezone.utc).isoformat()
            next_cursor = f"{c_dt}|{last.notification_id}"

        # Get total unread count for this recipient & company scope
        unread_count = self.get_unread_count(
            company_id=company_id,
            user_scope_key=f"u:{recipient_user_id}:c:{company_id}",
        )

        return NotificationListResponse(
            items=[NotificationOut.model_validate(n) for n in results],
            next_cursor=next_cursor,
            has_more=has_more,
            total_unread=unread_count,
        )

    def mark_as_read(
        self,
        notification_id: str,
        recipient_user_id: int,
    ) -> Optional[Notification]:
        from sqlalchemy import select
        now = datetime.now(timezone.utc)
        expires_target = now + timedelta(days=DEFAULT_RETENTION_DAYS)

        notif = self.db.scalar(
            select(Notification).where(
                Notification.notification_id == notification_id,
                Notification.recipient_user_id == recipient_user_id,
            )
        )
        if not notif:
            return None

        if notif.read_at is None:
            notif.read_at = now
            curr_exp = notif.expires_at
            if curr_exp is not None and curr_exp.tzinfo is None:
                curr_exp = curr_exp.replace(tzinfo=timezone.utc)
            if curr_exp is None or expires_target < curr_exp:
                notif.expires_at = expires_target
            self.db.commit()
            self.db.refresh(notif)

        return notif

    def mark_all_as_read(
        self,
        recipient_user_id: int,
        company_id: Optional[int] = None,
    ) -> int:
        from sqlalchemy import update, func
        now = datetime.now(timezone.utc)
        expires_target = now + timedelta(days=DEFAULT_RETENTION_DAYS)

        stmt = (
            update(Notification)
            .where(
                Notification.recipient_user_id == recipient_user_id,
                Notification.read_at.is_(None),
            )
        )
        if company_id is not None:
            stmt = stmt.where(Notification.company_id == company_id)

        stmt = stmt.values(
            read_at=now,
            expires_at=func.coalesce(Notification.expires_at, expires_target),
        )
        res = self.db.execute(stmt)
        self.db.commit()
        return res.rowcount or 0

    def resolve_entity_reminders(
        self,
        reference_type: str,
        reference_id: int,
    ) -> int:
        from sqlalchemy import update, func, select
        now = datetime.now(timezone.utc)
        expires_target = now + timedelta(days=DEFAULT_RETENTION_DAYS)

        bind = self.db.get_bind()
        is_postgres = bind.dialect.name == "postgresql"
        if is_postgres:
            stmt = (
                update(Notification)
                .where(
                    Notification.reference_type == reference_type,
                    Notification.reference_id == reference_id,
                    Notification.resolved_at.is_(None),
                )
                .values(
                    resolved_at=now,
                    expires_at=func.least(
                        func.coalesce(Notification.expires_at, expires_target),
                        expires_target,
                    ),
                )
            )
            res = self.db.execute(stmt)
            self.db.commit()
            return res.rowcount or 0
        else:
            rows = self.db.scalars(
                select(Notification).where(
                    Notification.reference_type == reference_type,
                    Notification.reference_id == reference_id,
                    Notification.resolved_at.is_(None),
                )
            ).all()
            for r in rows:
                r.resolved_at = now
                curr_exp = r.expires_at
                if curr_exp is not None and curr_exp.tzinfo is None:
                    curr_exp = curr_exp.replace(tzinfo=timezone.utc)
                if curr_exp is None or expires_target < curr_exp:
                    r.expires_at = expires_target
            self.db.commit()
            return len(rows)

    cls.get_notifications_feed = get_notifications_feed
    cls.mark_as_read = mark_as_read
    cls.mark_all_as_read = mark_all_as_read
    cls.resolve_entity_reminders = resolve_entity_reminders
    return cls

NotificationService = _extend_service(NotificationService)


def run_temporal_due_date_sweep(session_factory: Callable[[], Session]) -> dict:
    from sqlalchemy import select, text
    with session_factory() as db:
        bind = db.get_bind()
        is_postgres = bind.dialect.name == "postgresql"
        acquired = True

        if is_postgres:
            try:
                acquired = bool(
                    db.execute(
                        text("SELECT pg_try_advisory_lock(:lock_id)"),
                        {"lock_id": NOTIF_SCHEDULER_LOCK_ID},
                    ).scalar()
                )
            except Exception as e:
                logger.warning("Could not acquire advisory lock: %s", e)
                acquired = True

        if not acquired:
            logger.info("Temporal due-date sweep already active on another process; skipping.")
            return {"status": "skipped", "reason": "lock_held"}

        try:
            logger.info("Starting temporal due-date sweep...")
            svc = NotificationService(db)
            all_notifs = svc.get_notifications(company_id=None, limit=1000)
            now = datetime.now(timezone.utc)
            upserted = 0
            for item in all_notifs:
                if not item.company_id:
                    continue
                recipients = resolve_event_recipients(
                    db=db,
                    company_id=item.company_id,
                    target_roles=["supervisor", "finance"],
                    target_user_ids=[],
                )
                for uid in recipients:
                    notif_id = f"{item.notification_id}-{uid}"
                    existing = db.scalar(
                        select(Notification.notification_id).where(
                            Notification.notification_id == notif_id
                        )
                    )
                    if not existing:
                        db.add(
                            Notification(
                                notification_id=notif_id,
                                recipient_user_id=uid,
                                company_id=item.company_id,
                                notification_type=item.notification_type,
                                title=item.title,
                                message=item.message,
                                reference_type=item.reference_type,
                                reference_id=item.reference_id,
                                read_at=None,
                                resolved_at=None,
                                expires_at=None,
                                created_at=now,
                            )
                        )
                        upserted += 1
            db.commit()
            return {"status": "success", "upserted_count": upserted}
        finally:
            if is_postgres:
                try:
                    db.execute(
                        text("SELECT pg_advisory_unlock(:lock_id)"),
                        {"lock_id": NOTIF_SCHEDULER_LOCK_ID},
                    )
                    db.commit()
                except Exception:
                    pass


def prune_expired_notifications_batch(
    session_factory: Callable[[], Session],
    batch_size: int = 1000,
) -> int:
    from sqlalchemy import select, delete
    total_deleted = 0
    now = datetime.now(timezone.utc)

    while True:
        with session_factory() as db:
            subq = (
                select(Notification.notification_id)
                .where(
                    Notification.expires_at.isnot(None),
                    Notification.expires_at <= now,
                )
                .limit(batch_size)
            )
            expired_ids = db.scalars(subq).all()
            if not expired_ids:
                break

            stmt = delete(Notification).where(Notification.notification_id.in_(expired_ids))
            res = db.execute(stmt)
            db.commit()
            deleted = res.rowcount or 0
            total_deleted += deleted
            if deleted < batch_size:
                break

    logger.info("Pruned %d expired notifications older than 90 days.", total_deleted)
    return total_deleted
