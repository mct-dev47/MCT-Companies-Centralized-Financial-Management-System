import json
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Tuple
from fastapi import HTTPException, status
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func

from app.core.cache import system_cache
from app.models.loan import Loan, LoanRepayment
from app.models.company import Company
from app.models.lending import Borrower, LendingTransaction

MANILA_TZ = timezone(timedelta(hours=8))


def quantize(value: Decimal | float | int | str) -> Decimal:
    """Helper to round monetary values to 2 decimal places."""
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def parse_date(val: Any) -> Optional[date]:
    """Parse date from date object or ISO string."""
    if not val:
        return None
    if isinstance(val, date):
        return val
    if isinstance(val, datetime):
        return val.date()
    try:
        return date.fromisoformat(str(val).split("T")[0])
    except Exception:
        return None


class hybrid_method:
    def __init__(self, func):
        self.func = func

    def __get__(self, instance, owner):
        def wrapper(*args, **kwargs):
            return self.func(instance, *args, **kwargs)
        return wrapper


class LendingServiceResult(dict):
    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(f"'LendingServiceResult' object has no attribute '{name}'")

    def __setattr__(self, name, value):
        self[name] = value


class LendingService:
    """
    Centralized lending business logic service.
    Contains pure calculations, schedule generators, period locking rules,
    and database persistence operations for borrowers.
    """

    def __init__(self, db: Optional[Session] = None):
        self.db = db

    def get_transactions(self, *args, **kwargs):
        db = kwargs.pop("db", self.db)
        return self.__class__.get_transactions(db, *args, **kwargs)

    def get_transaction(self, transaction_id: int, *args, **kwargs):
        db = kwargs.pop("db", self.db)
        return self.__class__.get_transaction(db, transaction_id, *args, **kwargs)

    # -------------------------------------------------------------------------
    # 1. PURE CALCULATION & SCHEDULE HELPERS
    # -------------------------------------------------------------------------

    @staticmethod
    def get_months_between(start_val: Any, end_val: Any) -> int:
        """Calculate calendar months between two dates."""
        start = parse_date(start_val)
        end = parse_date(end_val)
        if not start or not end:
            return 1
        months = (end.year - start.year) * 12 + (end.month - start.month)
        if end.day > start.day:
            months += 1
        return max(1, months)

    @staticmethod
    def get_cycle_due_date(
        date_borrowed_val: Any,
        final_due_date_val: Any,
        frequency: str,
        cycle_index: int,
        total_cycles: int,
    ) -> str:
        """
        Calculate the due date for a specific installment cycle.
        Index is 1-based (1 for first cycle, total_cycles for final cycle).
        """
        final_due = parse_date(final_due_date_val)
        borrowed = parse_date(date_borrowed_val)
        if not borrowed:
            return str(final_due) if final_due else ""

        if cycle_index >= total_cycles and final_due:
            return final_due.isoformat()

        freq = (frequency or "Daily").strip().capitalize()

        if freq == "Daily":
            target = borrowed + timedelta(days=cycle_index)
            if final_due and target > final_due:
                return final_due.isoformat()
            return target.isoformat()

        if freq == "Monthly":
            month_offset = cycle_index
            target_year = borrowed.year + (borrowed.month - 1 + month_offset) // 12
            target_month = ((borrowed.month - 1 + month_offset) % 12) + 1
            max_day = monthrange(target_year, target_month)[1]
            target_day = min(borrowed.day, max_day)
            target = date(target_year, target_month, target_day)
            if final_due and target > final_due:
                return final_due.isoformat()
            return target.isoformat()

        return final_due.isoformat() if final_due else borrowed.isoformat()

    @classmethod
    def calculate_terms(
        cls,
        principal: Decimal | float | int,
        interest_rate: Decimal | float | int = Decimal("20.00"),
        frequency: str = "Daily",
        start_date_val: Any = None,
        due_date_val: Any = None,
        term_days_val: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Authoritative calculation of loan financial terms, installment targets, and 5% penalty rate.
        Defaults: 40 days for Daily, 2 months for Monthly, and 20.0% interest rate.
        """
        p = quantize(principal)
        r = quantize(interest_rate if interest_rate is not None else Decimal("20.00"))
        start = parse_date(start_date_val) or date.today()
        freq = (frequency or "Daily").strip().capitalize()
        if freq not in {"Daily", "Monthly"}:
            freq = "Daily"

        if term_days_val is not None and int(term_days_val) > 0:
            term_days = int(term_days_val)
        else:
            term_days = 40 if freq == "Daily" else 2

        due = parse_date(due_date_val)
        if not due:
            if freq == "Daily":
                due = start + timedelta(days=term_days)
            else:  # Monthly
                due_cycles = term_days if term_days <= 36 else max(1, term_days // 30)
                due_iso = cls.get_cycle_due_date(start, None, "Monthly", due_cycles, due_cycles)
                due = parse_date(due_iso) or (start + timedelta(days=due_cycles * 30))

        interest = quantize(p * (r / Decimal("100.00")))
        total_payable = quantize(p + interest)

        if freq == "Daily":
            if not due:
                due = start + timedelta(days=term_days)
            cycles = max(1, term_days)
            installment = quantize(total_payable / Decimal(str(cycles)))
        else:  # Monthly
            if term_days <= 36:
                cycles = max(1, term_days)
            elif due and start:
                cycles = max(1, cls.get_months_between(start, due))
            else:
                cycles = max(1, term_days // 30)
            if not due:
                due_iso = cls.get_cycle_due_date(start, None, "Monthly", cycles, cycles)
                due = parse_date(due_iso) or (start + timedelta(days=cycles * 30))
            installment = quantize(total_payable / Decimal(str(cycles)))

        penalty_rate = Decimal("5.00")
        penalty_per_cycle = quantize(installment * (penalty_rate / Decimal("100.00")))

        return {
            "principal": float(p),
            "interest_rate": float(r),
            "interest": float(interest),
            "total_payable": float(total_payable),
            "frequency": freq,
            "cycle_count": cycles,
            "installment_target": float(installment),
            "term_days": int(term_days),
            "penalty_rate": float(penalty_rate),
            "penalty_per_cycle": float(penalty_per_cycle),
            "date_borrowed": start.isoformat(),
            "due_date": due.isoformat(),
        }

    @classmethod
    def get_monthly_progress(
        cls,
        date_borrowed_val: Any,
        due_date_val: Any,
        total_payable: float | Decimal,
        repayments: List[Dict[str, Any]],
        term_days: int = 60,
    ) -> Dict[str, Any]:
        """
        Calculate installment breakdown, forward advance crediting, and flat 5% penalties for monthly loans.
        """
        if term_days and term_days <= 36:
            total_months = max(1, int(term_days))
        elif due_date_val and date_borrowed_val:
            total_months = max(1, cls.get_months_between(date_borrowed_val, due_date_val))
        elif term_days and term_days > 0:
            total_months = max(1, term_days // 30)
        else:
            total_months = 2
        payable_dec = quantize(total_payable)
        target_per_month = quantize(payable_dec / Decimal(str(total_months)))
        today_iso = date.today().isoformat()

        # Aggregate payments made per month index or payment date
        month_paid_map: Dict[int, Decimal] = {}
        for r in repayments:
            idx = r.get("month_index") or r.get("cycle_index")
            amt = quantize(r.get("amount", 0))
            if idx is not None and int(idx) >= 1:
                month_paid_map[int(idx)] = month_paid_map.get(int(idx), Decimal("0.00")) + amt
            elif r.get("cycle_due_date"):
                target_due = str(r.get("cycle_due_date")).split("T")[0]
                matched = False
                for m_check in range(1, total_months + 1):
                    c_due = cls.get_cycle_due_date(date_borrowed_val, due_date_val, "Monthly", m_check, total_months)
                    if c_due == target_due:
                        month_paid_map[m_check] = month_paid_map.get(m_check, Decimal("0.00")) + amt
                        matched = True
                        break
                if not matched:
                    p_date = parse_date(r.get("date") or r.get("payment_date"))
                    start = parse_date(date_borrowed_val) or date.today()
                    if p_date and p_date >= start:
                        m_idx = min(total_months, max(1, ((p_date.year - start.year) * 12 + (p_date.month - start.month) + 1)))
                        month_paid_map[m_idx] = month_paid_map.get(m_idx, Decimal("0.00")) + amt
            else:
                p_date = parse_date(r.get("date") or r.get("payment_date"))
                start = parse_date(date_borrowed_val) or date.today()
                if p_date and p_date >= start:
                    m_idx = min(total_months, max(1, ((p_date.year - start.year) * 12 + (p_date.month - start.month) + 1)))
                    month_paid_map[m_idx] = month_paid_map.get(m_idx, Decimal("0.00")) + amt

        month_details = []
        active_month = None
        available_credit = Decimal("0.00")
        total_penalties = Decimal("0.00")
        missed_count = 0
        penalty_per_month = quantize(target_per_month * Decimal("0.05"))

        for m in range(1, total_months + 1):
            is_last = m == total_months
            expected = payable_dec - (target_per_month * Decimal(str(total_months - 1))) if is_last else target_per_month
            direct_paid = month_paid_map.get(m, Decimal("0.00"))
            available_funds = direct_paid + available_credit
            cycle_due = cls.get_cycle_due_date(date_borrowed_val, due_date_val, "Monthly", m, total_months)
            cycle_due_d = parse_date(cycle_due)

            cycle_penalty = Decimal("0.00")
            if direct_paid >= expected and expected > 0:
                rem = Decimal("0.00")
                status_str = "Paid"
                is_settled = True
                is_overdue = False
            elif direct_paid > 0:
                rem = expected - direct_paid
                is_settled = False
                is_overdue = today_iso > cycle_due
                status_str = "Partially Paid"
                if is_overdue and cycle_due_d:
                    months_late = max(1, (date.today().year - cycle_due_d.year) * 12 + (date.today().month - cycle_due_d.month))
                    cycle_penalty = quantize(penalty_per_month * Decimal(str(months_late)))
                    total_penalties += cycle_penalty
                    missed_count += 1
            else:
                rem = expected
                is_settled = False
                is_overdue = today_iso > cycle_due
                status_str = "Missed" if is_overdue else "Unpaid"
                if is_overdue and cycle_due_d:
                    months_late = max(1, (date.today().year - cycle_due_d.year) * 12 + (date.today().month - cycle_due_d.month))
                    cycle_penalty = quantize(penalty_per_month * Decimal(str(months_late)))
                    total_penalties += cycle_penalty
                    missed_count += 1

            info = {
                "month_index": m,
                "target": float(expected),
                "paid": float(direct_paid),
                "remaining": float(rem),
                "status": status_str,
                "dueDate": cycle_due,
                "isOverdue": is_overdue,
                "isLocked": is_settled,
                "penalty": float(cycle_penalty),
            }
            month_details.append(info)

            if not active_month and rem > Decimal("0.00"):
                active_month = info

        if not active_month:
            active_month = month_details[-1] if month_details else {
                "month_index": 1,
                "target": float(target_per_month),
                "paid": 0.0,
                "remaining": float(target_per_month),
                "status": "Unpaid",
                "dueDate": str(due_date_val or ""),
                "isOverdue": False,
                "isLocked": False,
                "penalty": 0.0,
            }

        compliance_str = "Delinquent" if missed_count >= 2 else ("Delayed" if missed_count == 1 else "Compliant")

        return {
            "totalMonths": total_months,
            "targetPerMonth": float(target_per_month),
            "monthDetails": month_details,
            "activeMonth": active_month,
            "totalPenalties": float(total_penalties),
            "advanceAmount": 0.0,
            "complianceStatus": compliance_str,
            "missedCyclesCount": missed_count,
        }

    @classmethod
    def get_next_installment_info(
        cls,
        date_borrowed_val: Any,
        due_date_val: Any,
        frequency: str,
        total_payable: float | Decimal,
        amount_paid: float | Decimal,
    ) -> Optional[Dict[str, Any]]:
        """
        Derive the upcoming installment cycle label, due date, target, and overdue status.
        """
        freq = (frequency or "Daily").strip().capitalize()
        if freq == "Daily":
            return None

        if freq != "Monthly":
            return None

        total_months = cls.get_months_between(date_borrowed_val, due_date_val)
        payable_dec = quantize(total_payable)
        paid_dec = quantize(amount_paid)

        total_cycles = total_months
        cycle_name = "Month"

        target_per_cycle = quantize(payable_dec / Decimal(str(total_cycles)))
        completed_cycles = int(paid_dec // target_per_cycle) if target_per_cycle > 0 else 0
        active_index = min(total_cycles, completed_cycles + 1)
        cycle_due = cls.get_cycle_due_date(date_borrowed_val, due_date_val, freq, active_index, total_cycles)
        today_iso = date.today().isoformat()
        is_overdue = (today_iso > cycle_due) and (paid_dec < payable_dec)

        return {
            "periodLabel": f"{cycle_name} {active_index}",
            "dueDate": cycle_due,
            "targetAmount": float(target_per_cycle),
            "isOverdue": is_overdue,
            "cycleIndex": active_index,
            "totalCycles": total_cycles,
        }

    @classmethod
    def build_daily_ledger(
        cls,
        date_borrowed_val: Any,
        due_date_val: Any,
        repayments: List[Dict[str, Any]],
        term_days: int = 40,
        installment_target: float | Decimal = 0.0,
        penalty_per_cycle: float | Decimal = 0.0,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Build complete calendar day ledger for daily loans including advance forward crediting,
        transaction date validation, flat 5% penalties for missed dates, and compliance tier.
        """
        start = parse_date(date_borrowed_val) or date.today()
        today = date.today()
        safe_term_days = int(term_days) if term_days is not None else 40
        due = parse_date(due_date_val) or (start + timedelta(days=safe_term_days))
        end_date = max(today, start + timedelta(days=max(1, safe_term_days) - 1))

        # Group payments by target installment date (cycle_due_date if present, else payment_date)
        day_payments: Dict[str, List[Dict[str, Any]]] = {}
        for r in repayments:
            target_iso = str(r.get("cycle_due_date") or r.get("date") or r.get("payment_date") or "").split("T")[0]
            if target_iso:
                if target_iso not in day_payments:
                    day_payments[target_iso] = []
                day_payments[target_iso].append(r)

        target_dec = quantize(installment_target)
        penalty_dec = quantize(penalty_per_cycle if penalty_per_cycle > 0 else (target_dec * Decimal("0.05")))
        total_penalties = Decimal("0.00")
        missed_count = 0

        ledger_rows = []
        cur = start
        while cur <= end_date:
            iso = cur.isoformat()
            payments_today = day_payments.get(iso, [])
            paid_today = sum((Decimal(str(p.get("amount", 0))) for p in payments_today), Decimal("0.00"))
            penalties_paid_today = sum((Decimal(str(p.get("penalty_portion", 0) or p.get("penalty", 0))) for p in payments_today), Decimal("0.00"))
            has_late_payment = any(p.get("is_late") for p in payments_today)
            max_days_late = max([p.get("days_late", 0) for p in payments_today] or [0])

            if paid_today >= target_dec and target_dec > Decimal("0.00"):
                status_str = f"Paid Late ({max_days_late}d)" if has_late_payment else "Paid"
                method_str = payments_today[0].get("method", "Cash") if payments_today else "Cash"
                ref_str = payments_today[0].get("referenceNo", "-") if payments_today else "-"
                notes_str = payments_today[0].get("notes", "-") if payments_today else "-"

                total_penalties += penalties_paid_today
                ledger_rows.append({
                    "id": f"day-{iso}",
                    "date": iso,
                    "amount": float(paid_today),
                    "target": float(target_dec),
                    "method": method_str,
                    "referenceNo": ref_str,
                    "notes": notes_str,
                    "status": status_str,
                    "penalty": float(penalties_paid_today),
                    "timestamp": payments_today[0].get("timestamp", iso) if payments_today else iso,
                    "isLocked": True,
                    "is_late": has_late_payment,
                    "days_late": max_days_late,
                })
            elif paid_today > Decimal("0.00"):
                status_str = "Partially Paid"
                method_str = payments_today[0].get("method", "Cash") if payments_today else "Cash"
                ref_str = payments_today[0].get("referenceNo", "-") if payments_today else "-"
                notes_str = payments_today[0].get("notes", "-") if payments_today else "-"

                if cur < today:
                    days_overdue = (today - cur).days
                    unpaid_penalty = quantize(penalty_dec * Decimal(str(days_overdue)))
                    total_penalties += penalties_paid_today + unpaid_penalty
                    missed_count += 1
                else:
                    total_penalties += penalties_paid_today

                ledger_rows.append({
                    "id": f"day-{iso}",
                    "date": iso,
                    "amount": float(paid_today),
                    "target": float(target_dec),
                    "method": method_str,
                    "referenceNo": ref_str,
                    "notes": notes_str,
                    "status": status_str,
                    "penalty": float(penalties_paid_today),
                    "timestamp": payments_today[0].get("timestamp", iso) if payments_today else iso,
                    "isLocked": False,
                    "is_late": has_late_payment,
                    "days_late": max_days_late,
                })
            else:
                if cur < today:
                    status_str = "Missed"
                    days_overdue = (today - cur).days
                    unpaid_penalty = quantize(penalty_dec * Decimal(str(days_overdue)))
                    total_penalties += unpaid_penalty
                    missed_count += 1
                    penalty_amount = float(unpaid_penalty)
                elif cur == today:
                    status_str = "Pending"
                    penalty_amount = 0.0
                else:
                    status_str = "Scheduled"
                    penalty_amount = 0.0

                ledger_rows.append({
                    "id": f"day-{iso}",
                    "date": iso,
                    "amount": 0.0,
                    "target": float(target_dec),
                    "method": "-",
                    "referenceNo": "-",
                    "notes": "-",
                    "status": status_str,
                    "penalty": penalty_amount,
                    "timestamp": iso,
                    "isLocked": False,
                    "is_late": False,
                    "days_late": (today - cur).days if cur < today else 0,
                })

            cur += timedelta(days=1)

        ledger_rows.sort(key=lambda x: x["date"], reverse=True)

        if missed_count == 0:
            compliance_status = "Compliant"
        elif missed_count == 1:
            compliance_status = "Delayed"
        else:
            compliance_status = "Delinquent"

        meta = {
            "total_penalties": float(total_penalties),
            "advance_amount": 0.0,
            "compliance_status": compliance_status,
            "missed_cycles_count": missed_count,
        }
        return ledger_rows, meta

    # -------------------------------------------------------------------------
    # 2. VALIDATION & PERIOD SETTLEMENT LOCKING
    # -------------------------------------------------------------------------

    @classmethod
    def check_period_settlement(
        cls,
        frequency: str,
        payment_date_val: Any,
        repayments: List[Dict[str, Any]],
        installment_target: Optional[Decimal | float] = None,
        cycle_due_date_val: Optional[Any] = None,
    ) -> Tuple[bool, Optional[str]]:
        """
        Checks whether the specified installment date or period is already settled and locked.
        Returns (is_locked, reason).
        """
        freq = (frequency or "Daily").strip().capitalize()
        target_date = parse_date(cycle_due_date_val) or parse_date(payment_date_val)
        if not target_date:
            return False, None

        iso_target = target_date.isoformat()

        if freq == "Daily":
            paid_for_target = sum(
                (
                    Decimal(str(r.get("amount", 0)))
                    for r in repayments
                    if str(r.get("cycle_due_date") or r.get("date") or r.get("payment_date") or "").split("T")[0] == iso_target
                ),
                Decimal("0.00"),
            )
            if installment_target is not None and Decimal(str(installment_target)) > Decimal("0.00"):
                target_dec = quantize(installment_target)
                if paid_for_target >= target_dec:
                    return True, f"Installment date {iso_target} is already fully paid and locked. You cannot record another payment for this date."
            else:
                for r in repayments:
                    r_target = str(r.get("cycle_due_date") or r.get("date") or r.get("payment_date") or "").split("T")[0]
                    status_val = str(r.get("status") or "").strip().lower()
                    if r_target == iso_target and status_val in {"paid", "completed"}:
                        return True, f"Installment date {iso_target} is already fully paid and locked. You cannot record another payment for this date."

        return False, None

    @staticmethod
    def validate_payment_bounds(amount: Decimal | float, remaining_balance: Decimal | float) -> None:
        """Enforces minimum 1.00 peso and remaining balance ceiling."""
        amt = quantize(amount)
        rem = quantize(remaining_balance)
        if amt < Decimal("1.00"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment Amount cannot be lower than 1.00.",
            )
        if amt > rem:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payment amount ({float(amt)}) cannot exceed the remaining balance ({float(rem)}).",
            )

    # -------------------------------------------------------------------------
    # 3. DATABASE REPOSITORY OPERATIONS
    # -------------------------------------------------------------------------

    @classmethod
    def parse_loan_description(cls, desc_str: Optional[str]) -> Dict[str, Any]:
        """Extract structured JSON metadata from loan description if present."""
        if not desc_str:
            return {"borrower_name": "Unknown", "frequency": "Daily", "term_days": 40, "penalty_rate": 5.0, "notes": ""}
        try:
            parsed = json.loads(desc_str)
            if isinstance(parsed, dict):
                freq = parsed.get("frequency", "Daily")
                if "term_days" not in parsed:
                    parsed["term_days"] = 40 if freq == "Daily" else (60 if freq == "Monthly" else 90)
                if "penalty_rate" not in parsed:
                    parsed["penalty_rate"] = 5.0
                return parsed
        except Exception:
            pass
        return {"borrower_name": desc_str.strip(), "frequency": "Daily", "term_days": 40, "penalty_rate": 5.0, "notes": desc_str}

    @classmethod
    def serialize_loan_description(
        cls,
        borrower_name: str,
        frequency: str,
        notes: Optional[str] = "",
        term_days: int = 40,
        penalty_rate: float = 5.0,
    ) -> str:
        """Serialize loan metadata into description JSON string."""
        data = {
            "borrower_name": borrower_name.strip(),
            "frequency": frequency.strip().capitalize(),
            "term_days": int(term_days),
            "penalty_rate": float(penalty_rate),
            "notes": (notes or "").strip(),
        }
        return json.dumps(data)

    @hybrid_method
    def get_borrowers(
        self_or_none,
        *args,
        **kwargs,
    ) -> List[Dict[str, Any]]:
        """Retrieve borrowers with calculated summary balances, accrued penalties, and schedules."""
        if self_or_none is not None:
            db = kwargs.pop("db", self_or_none.db)
            borrower_query = args[0] if len(args) > 0 else kwargs.pop("borrower_query", None)
            company_id = args[1] if len(args) > 1 else kwargs.pop("company_id", None)
            borrower_id = args[2] if len(args) > 2 else kwargs.pop("borrower_id", None)
        else:
            db = args[0] if len(args) > 0 else kwargs.pop("db", None)
            borrower_query = args[1] if len(args) > 1 else kwargs.pop("borrower_query", None)
            company_id = args[2] if len(args) > 2 else kwargs.pop("company_id", None)
            borrower_id = args[3] if len(args) > 3 else kwargs.pop("borrower_id", None)
        cls = LendingService
        b_query = db.query(Borrower).options(selectinload(Borrower.transactions))
        if borrower_id is not None:
            b_query = b_query.filter(Borrower.borrower_id == borrower_id)
        if borrower_query and str(borrower_query).strip():
            b_query = b_query.filter(Borrower.borrower_name.ilike(f"%{str(borrower_query).strip()}%"))
        borrowers = b_query.order_by(Borrower.created_at.desc()).all()

        results = []

        if borrowers:
            for b in borrowers:
                freq = b.payment_frequency or "Daily"
                borrower_name = b.borrower_name
                term_days = b.term_days or (40 if freq == "Daily" else 60)

                txs = sorted(
                    b.transactions or [],
                    key=lambda t: (
                        t.cycle_due_date or t.payment_date or date.min,
                        t.payment_date or date.min,
                        (t.created_at.replace(tzinfo=None) if t.created_at and t.created_at.tzinfo else (t.created_at or datetime.min)),
                        t.transaction_id or 0,
                    ),
                    reverse=True,
                )

                repayment_dicts = [
                    {
                        "id": str(t.transaction_id),
                        "transaction_id": t.transaction_id,
                        "transaction_ref_no": t.transaction_ref_no or f"TX-{t.transaction_id}",
                        "transactionRefNo": t.transaction_ref_no or f"TX-{t.transaction_id}",
                        "payment_date": t.payment_date.isoformat() if t.payment_date else "",
                        "date": t.payment_date.isoformat() if t.payment_date else "",
                        "cycle_due_date": t.cycle_due_date.isoformat() if t.cycle_due_date else "",
                        "cycle_index": t.cycle_index,
                        "is_late": t.is_late or False,
                        "days_late": t.days_late or 0,
                        "amount": float(t.amount or 0),
                        "penalty_portion": float(t.penalty_portion or 0),
                        "penalty": float(t.penalty_portion or 0),
                        "method": t.payment_method or "Cash",
                        "referenceNo": t.reference_no or "-",
                        "notes": t.notes or "-",
                        "status": "Paid" if (t.status or "").lower() == "completed" else (t.status or "Paid"),
                        "timestamp": t.created_at.isoformat() if t.created_at else "",
                        "recorded_by": t.recorded_by,
                        "recordedBy": t.recorded_by,
                    }
                    for t in txs
                ]

                terms = cls.calculate_terms(
                    principal=b.principal_amount,
                    interest_rate=b.interest_rate or Decimal("20.00"),
                    frequency=freq,
                    start_date_val=b.date_borrowed,
                    due_date_val=b.due_date,
                    term_days_val=term_days,
                )

                total_paid = sum((Decimal(str(r["amount"])) for r in repayment_dicts), Decimal("0.00"))

                if freq == "Daily":
                    _, ledger_meta = cls.build_daily_ledger(
                        b.date_borrowed,
                        b.due_date,
                        repayment_dicts,
                        term_days=terms["term_days"],
                        installment_target=terms["installment_target"],
                        penalty_per_cycle=terms["penalty_per_cycle"],
                    )
                    total_penalties = Decimal(str(ledger_meta["total_penalties"]))
                    advance_amount = Decimal(str(ledger_meta["advance_amount"]))
                    compliance_status = ledger_meta["compliance_status"]
                    missed_cycles_count = ledger_meta["missed_cycles_count"]
                else:
                    progress = cls.get_monthly_progress(
                        b.date_borrowed,
                        b.due_date,
                        terms["total_payable"],
                        repayment_dicts,
                        term_days=terms["term_days"],
                    )
                    total_penalties = Decimal(str(progress["totalPenalties"]))
                    advance_amount = Decimal(str(progress["advanceAmount"]))
                    compliance_status = progress["complianceStatus"]
                    missed_cycles_count = progress["missedCyclesCount"]

                contractual_total_payable = Decimal(str(terms["total_payable"]))
                remaining_balance = max(Decimal("0.00"), contractual_total_payable - total_paid)

                today_iso = date.today().isoformat()
                due_iso = b.due_date.isoformat() if b.due_date else ""
                if remaining_balance <= Decimal("0.00"):
                    derived_status = "Completed"
                elif compliance_status == "Delinquent" or (due_iso and today_iso > due_iso):
                    derived_status = "Overdue"
                else:
                    derived_status = b.status or "Active"

                audited_at_val = b.audited_at.isoformat() if getattr(b, "audited_at", None) else None
                audit_date_str = None
                if getattr(b, "audited_at", None):
                    try:
                        dt = b.audited_at
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        dt_local = dt.astimezone(MANILA_TZ)
                        audit_date_str = dt_local.strftime("%m/%d/%y, %I:%M %p")
                    except Exception:
                        audit_date_str = str(b.audited_at)

                audit_st = getattr(b, "audit_status", None) or "Pending Audit"
                audit_status_disp = audit_st if audit_st in ("Verified", "Flagged") else None
                audited_by_val = getattr(b, "audited_by", None) if audit_status_disp else None
                if audited_by_val and "@" in str(audited_by_val):
                    try:
                        from app.models.user import User
                        db_user = db.query(User).filter(func.lower(User.email) == str(audited_by_val).lower().strip()).first()
                        if db_user and db_user.name:
                            audited_by_val = db_user.name
                        else:
                            from app.db.supabase import get_supabase_admin_client
                            client = get_supabase_admin_client()
                            if client:
                                res = client.table("users").select("name").ilike("email", str(audited_by_val).lower().strip()).limit(1).execute()
                                if res.data and res.data[0].get("name"):
                                    audited_by_val = res.data[0]["name"]
                    except Exception:
                        pass

                results.append({
                    "id": str(b.borrower_id),
                    "borrower_id": b.borrower_id,
                    "borrower_ref_no": b.borrower_ref_no or f"BOR-{b.borrower_id}",
                    "borrowerRefNo": b.borrower_ref_no or f"BOR-{b.borrower_id}",
                    "loanId": b.borrower_id,
                    "loanRefNo": b.borrower_ref_no or f"BOR-{b.borrower_id}",
                    "borrowerName": borrower_name,
                    "borrowerContact": "",
                    "borrowerAddress": "",
                    "loanAmount": float(b.principal_amount),
                    "interestRate": float(terms["interest_rate"]),
                    "interestAmount": terms["interest"],
                    "totalAmountPayable": float(contractual_total_payable),
                    "amountPaid": float(total_paid),
                    "remainingBalance": float(remaining_balance),
                    "dateBorrowed": b.date_borrowed.isoformat() if b.date_borrowed else "",
                    "dueDate": due_iso,
                    "status": derived_status,
                    "paymentFrequency": freq,
                    "termDays": terms["term_days"],
                    "penaltyRate": terms["penalty_rate"],
                    "penaltyPerCycle": terms["penalty_per_cycle"],
                    "totalPenalties": float(total_penalties),
                    "advanceAmount": float(advance_amount),
                    "installmentTarget": terms["installment_target"],
                    "complianceStatus": compliance_status,
                    "missedCyclesCount": missed_cycles_count,
                    "notes": b.notes or "",
                    "audit_status": audit_st,
                    "auditStatus": audit_status_disp,
                    "audited_by": audited_by_val,
                    "auditedBy": audited_by_val,
                    "audited_at": audited_at_val,
                    "auditedAt": audited_at_val,
                    "auditDate": audit_date_str if audit_status_disp else None,
                    "audit_remarks": getattr(b, "audit_remarks", None),
                    "auditRemarks": getattr(b, "audit_remarks", None),
                    "dailyPayments": repayment_dicts,
                })
            return results

        # Legacy fallback query for loans table if borrowers is empty
        query = db.query(Loan)
        if company_id:
            query = query.filter(Loan.borrower == company_id)

        loans = query.order_by(Loan.created_at.desc()).all()
        for loan in loans:
            meta = cls.parse_loan_description(loan.description)
            freq = meta.get("frequency", "Daily")
            borrower_name = meta.get("borrower_name") or f"Borrower #{loan.borrower}"
            term_days = meta.get("term_days", 40 if freq == "Daily" else 60)

            repayments = (
                db.query(LoanRepayment)
                .filter(LoanRepayment.loan_id == loan.loan_id)
                .order_by(LoanRepayment.payment_date.desc(), LoanRepayment.created_at.desc())
                .all()
            )

            repayment_dicts = [
                {
                    "id": str(r.loan_repayment_id),
                    "payment_date": r.payment_date.isoformat() if r.payment_date else "",
                    "date": r.payment_date.isoformat() if r.payment_date else "",
                    "amount": float(r.amount or 0),
                    "method": r.reference_no.split(" - ")[0] if r.reference_no and " - " in r.reference_no else "Cash",
                    "referenceNo": r.reference_no or "-",
                    "notes": r.notes or "-",
                    "status": "Paid" if (r.status or "").lower() == "completed" else (r.status or "Paid"),
                    "timestamp": r.created_at.isoformat() if r.created_at else "",
                }
                for r in repayments
            ]

            terms = cls.calculate_terms(
                principal=loan.principal_amount,
                interest_rate=loan.interest_rate or Decimal("20.00"),
                frequency=freq,
                start_date_val=loan.loan_date,
                due_date_val=loan.due_date,
                term_days_val=term_days,
            )

            total_paid = sum((Decimal(str(r["amount"])) for r in repayment_dicts), Decimal("0.00"))

            if freq == "Daily":
                _, ledger_meta = cls.build_daily_ledger(
                    loan.loan_date,
                    loan.due_date,
                    repayment_dicts,
                    term_days=terms["term_days"],
                    installment_target=terms["installment_target"],
                    penalty_per_cycle=terms["penalty_per_cycle"],
                )
                total_penalties = Decimal(str(ledger_meta["total_penalties"]))
                advance_amount = Decimal(str(ledger_meta["advance_amount"]))
                compliance_status = ledger_meta["compliance_status"]
                missed_cycles_count = ledger_meta["missed_cycles_count"]
            else:
                progress = cls.get_monthly_progress(
                    loan.loan_date,
                    loan.due_date,
                    terms["total_payable"],
                    repayment_dicts,
                    term_days=terms["term_days"],
                )
                total_penalties = Decimal(str(progress["totalPenalties"]))
                advance_amount = Decimal(str(progress["advanceAmount"]))
                compliance_status = progress["complianceStatus"]
                missed_cycles_count = progress["missedCyclesCount"]

            contractual_total_payable = Decimal(str(terms["total_payable"]))
            remaining_balance = max(Decimal("0.00"), contractual_total_payable - total_paid)

            today_iso = date.today().isoformat()
            due_iso = loan.due_date.isoformat() if loan.due_date else ""
            if remaining_balance <= Decimal("0.00"):
                derived_status = "Completed"
            elif compliance_status == "Delinquent" or (due_iso and today_iso > due_iso):
                derived_status = "Overdue"
            else:
                derived_status = "Active"

            results.append({
                "id": str(loan.loan_id),
                "loanId": loan.loan_id,
                "loanRefNo": loan.loan_ref_no or f"FAC-{loan.loan_id}",
                "borrowerName": borrower_name,
                "loanAmount": float(loan.principal_amount),
                "interestRate": float(terms["interest_rate"]),
                "interestAmount": terms["interest"],
                "totalAmountPayable": float(contractual_total_payable),
                "amountPaid": float(total_paid),
                "remainingBalance": float(remaining_balance),
                "dateBorrowed": loan.loan_date.isoformat() if loan.loan_date else "",
                "dueDate": due_iso,
                "status": derived_status,
                "paymentFrequency": freq,
                "termDays": terms["term_days"],
                "penaltyRate": terms["penalty_rate"],
                "penaltyPerCycle": terms["penalty_per_cycle"],
                "totalPenalties": float(total_penalties),
                "advanceAmount": float(advance_amount),
                "installmentTarget": terms["installment_target"],
                "complianceStatus": compliance_status,
                "missedCyclesCount": missed_cycles_count,
                "notes": meta.get("notes", ""),
                "audit_status": "Pending Audit",
                "auditStatus": None,
                "audited_by": None,
                "auditedBy": None,
                "audited_at": None,
                "auditedAt": None,
                "auditDate": None,
                "audit_remarks": None,
                "auditRemarks": None,
                "dailyPayments": repayment_dicts,
            })

        return results

    @classmethod
    def get_borrower(cls, db: Session, borrower_id: int) -> Dict[str, Any]:
        """Fetch single borrower details by ID."""
        res = cls.get_borrowers(db, borrower_id=borrower_id)
        for item in res:
            if str(item["id"]) == str(borrower_id) or str(item.get("borrower_id")) == str(borrower_id):
                return item
        # Fallback to legacy loan if borrower_id was not in Borrower table
        res = cls.get_borrowers(db)
        for item in res:
            if str(item["id"]) == str(borrower_id) or str(item.get("borrower_id")) == str(borrower_id):
                return item
        raise HTTPException(status_code=404, detail="Borrower not found.")

    @classmethod
    def get_borrower_ledger(cls, db: Session, borrower_id: int) -> Dict[str, Any]:
        """Fetch borrower details and generate its complete schedule ledger."""
        b = db.query(Borrower).filter(Borrower.borrower_id == borrower_id).first()
        if b:
            freq = b.payment_frequency or "Daily"
            term_days = b.term_days or (40 if freq == "Daily" else 60)

            txs = (
                db.query(LendingTransaction)
                .filter(LendingTransaction.borrower_id == b.borrower_id)
                .order_by(LendingTransaction.payment_date.desc(), LendingTransaction.created_at.desc())
                .all()
            )
            repayment_dicts = [
                {
                    "id": str(t.transaction_id),
                    "transaction_id": t.transaction_id,
                    "transaction_ref_no": t.transaction_ref_no or f"TX-{t.transaction_id}",
                    "transactionRefNo": t.transaction_ref_no or f"TX-{t.transaction_id}",
                    "date": t.payment_date.isoformat() if t.payment_date else "",
                    "payment_date": t.payment_date.isoformat() if t.payment_date else "",
                    "cycle_due_date": t.cycle_due_date.isoformat() if t.cycle_due_date else "",
                    "cycle_index": t.cycle_index,
                    "is_late": t.is_late or False,
                    "days_late": t.days_late or 0,
                    "amount": float(t.amount or 0),
                    "penalty_portion": float(t.penalty_portion or 0),
                    "penalty": float(t.penalty_portion or 0),
                    "method": t.payment_method or "Cash",
                    "referenceNo": t.reference_no or "-",
                    "notes": t.notes or "-",
                    "status": "Paid" if (t.status or "").lower() == "completed" else (t.status or "Paid"),
                    "timestamp": t.created_at.isoformat() if t.created_at else "",
                    "recorded_by": t.recorded_by,
                    "recordedBy": t.recorded_by,
                }
                for t in txs
            ]

            terms = cls.calculate_terms(
                principal=b.principal_amount,
                interest_rate=b.interest_rate or Decimal("20.00"),
                frequency=freq,
                start_date_val=b.date_borrowed,
                due_date_val=b.due_date,
                term_days_val=term_days,
            )

            total_paid = sum((Decimal(str(r["amount"])) for r in repayment_dicts), Decimal("0.00"))

            if freq == "Daily":
                ledger_items, ledger_meta = cls.build_daily_ledger(
                    b.date_borrowed,
                    b.due_date,
                    repayment_dicts,
                    term_days=terms["term_days"],
                    installment_target=terms["installment_target"],
                    penalty_per_cycle=terms["penalty_per_cycle"],
                )
                monthly_progress = None
                next_installment = None
                total_penalties = Decimal(str(ledger_meta["total_penalties"]))
                advance_amount = Decimal(str(ledger_meta["advance_amount"]))
                compliance_status = ledger_meta["compliance_status"]
                missed_cycles_count = ledger_meta["missed_cycles_count"]
            else:
                ledger_items = repayment_dicts
                monthly_progress = cls.get_monthly_progress(
                    b.date_borrowed,
                    b.due_date,
                    terms["total_payable"],
                    repayment_dicts,
                    term_days=terms["term_days"],
                )
                total_penalties = Decimal(str(monthly_progress["totalPenalties"]))
                advance_amount = Decimal(str(monthly_progress["advanceAmount"]))
                compliance_status = monthly_progress["complianceStatus"]
                missed_cycles_count = monthly_progress["missedCyclesCount"]

                contractual_total_payable = Decimal(str(terms["total_payable"]))
                next_installment = cls.get_next_installment_info(
                    b.date_borrowed, b.due_date, freq, contractual_total_payable, total_paid
                )

            contractual_total_payable = Decimal(str(terms["total_payable"]))
            remaining_balance = max(Decimal("0.00"), contractual_total_payable - total_paid)

            return {
                "borrower_id": str(b.borrower_id),
                "borrower_ref_no": b.borrower_ref_no or f"BOR-{b.borrower_id}",
                "loan_ref_no": b.borrower_ref_no or f"BOR-{b.borrower_id}",
                "borrower_name": b.borrower_name,
                "borrower_contact": "",
                "borrower_address": "",
                "payment_frequency": freq,
                "principal": float(b.principal_amount),
                "interest_rate": float(terms["interest_rate"]),
                "total_payable": float(contractual_total_payable),
                "amount_paid": float(total_paid),
                "remaining_balance": float(remaining_balance),
                "date_borrowed": b.date_borrowed.isoformat() if b.date_borrowed else "",
                "due_date": b.due_date.isoformat() if b.due_date else "",
                "term_days": terms["term_days"],
                "penalty_rate": terms["penalty_rate"],
                "penalty_per_cycle": terms["penalty_per_cycle"],
                "total_penalties": float(total_penalties),
                "advance_amount": float(advance_amount),
                "installment_target": terms["installment_target"],
                "compliance_status": compliance_status,
                "missed_cycles_count": missed_cycles_count,
                "ledger_items": ledger_items,
                "monthly_progress": monthly_progress,
                "next_installment": next_installment,
            }

        # Fallback to legacy loan
        loan = db.query(Loan).filter(Loan.loan_id == loan_id).first()
        if not loan:
            raise HTTPException(status_code=404, detail="Borrower not found.")

        meta = cls.parse_loan_description(loan.description)
        freq = meta.get("frequency", "Daily")
        term_days = meta.get("term_days", 40 if freq == "Daily" else 60)

        repayments = (
            db.query(LoanRepayment)
            .filter(LoanRepayment.loan_id == loan.loan_id)
            .order_by(LoanRepayment.payment_date.desc(), LoanRepayment.created_at.desc())
            .all()
        )

        repayment_dicts = [
            {
                "id": str(r.loan_repayment_id),
                "date": r.payment_date.isoformat() if r.payment_date else "",
                "payment_date": r.payment_date.isoformat() if r.payment_date else "",
                "amount": float(r.amount or 0),
                "method": r.reference_no.split(" - ")[0] if r.reference_no and " - " in r.reference_no else "Cash",
                "referenceNo": r.reference_no or "-",
                "notes": r.notes or "-",
                "status": "Paid" if (r.status or "").lower() == "completed" else (r.status or "Paid"),
                "timestamp": r.created_at.isoformat() if r.created_at else "",
            }
            for r in repayments
        ]

        terms = cls.calculate_terms(
            principal=loan.principal_amount,
            interest_rate=loan.interest_rate or Decimal("20.00"),
            frequency=freq,
            start_date_val=loan.loan_date,
            due_date_val=loan.due_date,
            term_days_val=term_days,
        )

        total_paid = sum((Decimal(str(r["amount"])) for r in repayment_dicts), Decimal("0.00"))

        if freq == "Daily":
            ledger_items, ledger_meta = cls.build_daily_ledger(
                loan.loan_date,
                loan.due_date,
                repayment_dicts,
                term_days=terms["term_days"],
                installment_target=terms["installment_target"],
                penalty_per_cycle=terms["penalty_per_cycle"],
            )
            monthly_progress = None
            next_installment = None
            total_penalties = Decimal(str(ledger_meta["total_penalties"]))
            advance_amount = Decimal(str(ledger_meta["advance_amount"]))
            compliance_status = ledger_meta["compliance_status"]
            missed_cycles_count = ledger_meta["missed_cycles_count"]
        else:
            ledger_items = repayment_dicts
            monthly_progress = cls.get_monthly_progress(
                loan.loan_date,
                loan.due_date,
                terms["total_payable"],
                repayment_dicts,
                term_days=terms["term_days"],
            )
            total_penalties = Decimal(str(monthly_progress["totalPenalties"]))
            advance_amount = Decimal(str(monthly_progress["advanceAmount"]))
            compliance_status = monthly_progress["complianceStatus"]
            missed_cycles_count = monthly_progress["missedCyclesCount"]

            contractual_total_payable = Decimal(str(terms["total_payable"]))
            next_installment = cls.get_next_installment_info(
                loan.loan_date, loan.due_date, freq, contractual_total_payable, total_paid
            )

        contractual_total_payable = Decimal(str(terms["total_payable"]))
        remaining_balance = max(Decimal("0.00"), contractual_total_payable - total_paid)

        return {
            "borrower_id": str(loan.loan_id),
            "borrower_ref_no": loan.loan_ref_no or f"BOR-{loan.loan_id}",
            "loan_ref_no": loan.loan_ref_no or f"BOR-{loan.loan_id}",
            "borrower_name": meta.get("borrower_name") or f"Borrower #{loan.borrower}",
            "payment_frequency": freq,
            "principal": float(loan.principal_amount),
            "interest_rate": float(terms["interest_rate"]),
            "total_payable": float(contractual_total_payable),
            "amount_paid": float(total_paid),
            "remaining_balance": float(remaining_balance),
            "date_borrowed": loan.loan_date.isoformat() if loan.loan_date else "",
            "due_date": loan.due_date.isoformat() if loan.due_date else "",
            "term_days": terms["term_days"],
            "penalty_rate": terms["penalty_rate"],
            "penalty_per_cycle": terms["penalty_per_cycle"],
            "total_penalties": float(total_penalties),
            "advance_amount": float(advance_amount),
            "installment_target": terms["installment_target"],
            "compliance_status": compliance_status,
            "missed_cycles_count": missed_cycles_count,
            "ledger_items": ledger_items,
            "monthly_progress": monthly_progress,
            "next_installment": next_installment,
        }

    @hybrid_method
    def create_borrower(
        self_or_none,
        *args,
        **kwargs,
    ) -> Dict[str, Any]:
        """Create a new borrower record in the borrowers database table."""
        if self_or_none is not None:
            db = kwargs.pop("db", self_or_none.db)
            borrower_name = args[0] if len(args) > 0 else kwargs.pop("borrower_name", None)
            principal_amount = args[1] if len(args) > 1 else kwargs.pop("principal_amount", None)
        else:
            db = args[0] if len(args) > 0 else kwargs.pop("db", None)
            borrower_name = args[1] if len(args) > 1 else kwargs.pop("borrower_name", None)
            principal_amount = args[2] if len(args) > 2 else kwargs.pop("principal_amount", None)

        interest_rate = kwargs.pop("interest_rate", Decimal("20.00"))
        frequency = kwargs.pop("frequency", "Daily")
        date_borrowed_val = kwargs.pop("date_borrowed_val", None)
        due_date_val = kwargs.pop("due_date_val", None)
        term_days_val = kwargs.pop("term_days_val", None)
        borrower_contact = kwargs.pop("borrower_contact", None)
        borrower_address = kwargs.pop("borrower_address", None)
        notes = kwargs.pop("notes", None)

        if hasattr(borrower_name, "borrower_name"):
            data = borrower_name
            borrower_name = data.borrower_name
            principal_amount = getattr(data, "loan_amount", principal_amount)
            interest_rate = getattr(data, "interest_rate", interest_rate)
            frequency = getattr(data, "payment_frequency", frequency)
            date_borrowed_val = getattr(data, "date_borrowed", date_borrowed_val)
            due_date_val = getattr(data, "due_date", due_date_val)
            term_days_val = getattr(data, "term_days", term_days_val)
            borrower_contact = getattr(data, "borrower_contact", borrower_contact)
            borrower_address = getattr(data, "borrower_address", borrower_address)
            notes = getattr(data, "notes", notes)

        p = quantize(principal_amount)
        if p < Decimal("1.00"):
            raise HTTPException(status_code=400, detail="Principal amount must be at least 1.00.")

        start = parse_date(date_borrowed_val) or date.today()
        freq = (frequency or "Daily").strip().capitalize()
        term_days = int(term_days_val) if term_days_val and int(term_days_val) > 0 else (40 if freq == "Daily" else 2)
        due = parse_date(due_date_val)

        terms = LendingService.calculate_terms(p, interest_rate, freq, start, due, term_days)
        due = parse_date(terms["due_date"])

        ref_no = f"LN-{datetime.now().strftime('%Y%m%d')}-{int(datetime.now().timestamp() % 10000):04d}"

        new_borrower = Borrower(
            borrower_ref_no=ref_no,
            borrower_name=borrower_name.strip(),
            principal_amount=p,
            interest_rate=Decimal(str(terms["interest_rate"])),
            total_payable=Decimal(str(terms["total_payable"])),
            total_penalties=Decimal("0.00"),
            amount_paid=Decimal("0.00"),
            remaining_balance=Decimal(str(terms["total_payable"])),
            payment_frequency=freq,
            term_days=term_days,
            date_borrowed=start,
            due_date=due,
            status="Active",
            notes=(notes or "").strip(),
        )
        db.add(new_borrower)
        db.commit()
        db.refresh(new_borrower)
        system_cache.invalidate_tag("notifications")

        return LendingServiceResult({
            "id": str(new_borrower.borrower_id),
            "borrower_id": new_borrower.borrower_id,
            "borrower_ref_no": new_borrower.borrower_ref_no,
            "borrowerRefNo": new_borrower.borrower_ref_no,
            "loanId": new_borrower.borrower_id,
            "loanRefNo": new_borrower.borrower_ref_no,
            "borrowerName": new_borrower.borrower_name,
            "borrowerContact": "",
            "borrowerAddress": "",
            "loanAmount": float(p),
            "interestRate": float(terms["interest_rate"]),
            "interestAmount": terms["interest"],
            "totalAmountPayable": terms["total_payable"],
            "amountPaid": 0.0,
            "remainingBalance": terms["total_payable"],
            "dateBorrowed": start.isoformat(),
            "dueDate": due.isoformat(),
            "status": "Active",
            "paymentFrequency": freq,
            "termDays": term_days,
            "penaltyRate": terms["penalty_rate"],
            "penaltyPerCycle": terms["penalty_per_cycle"],
            "totalPenalties": 0.0,
            "advanceAmount": 0.0,
            "installmentTarget": terms["installment_target"],
            "complianceStatus": "Compliant",
            "missedCyclesCount": 0,
            "notes": notes or "",
            "audit_status": "Pending Audit",
            "auditStatus": None,
            "audited_by": None,
            "auditedBy": None,
            "audited_at": None,
            "auditedAt": None,
            "auditDate": None,
            "audit_remarks": None,
            "auditRemarks": None,
            "dailyPayments": [],
        })

    @classmethod
    def update_borrower(
        cls,
        db: Session,
        borrower_id: int,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Update an existing borrower in the database and recalculate loan terms if required."""
        b = db.query(Borrower).filter(Borrower.borrower_id == borrower_id).first()
        if not b:
            loan = db.query(Loan).filter(Loan.loan_id == borrower_id).first()
            if not loan:
                raise HTTPException(status_code=404, detail="Borrower not found.")
            if "borrower_name" in payload and payload["borrower_name"] is not None:
                meta = cls.parse_loan_description(loan.description)
                meta["borrower_name"] = str(payload["borrower_name"]).strip()
                loan.description = cls.serialize_loan_description(meta)
            if "loan_amount" in payload and payload["loan_amount"] is not None:
                loan.principal_amount = quantize(payload["loan_amount"])
            if "interest_rate" in payload and payload["interest_rate"] is not None:
                loan.interest_rate = quantize(payload["interest_rate"])
            if "status" in payload and payload["status"] is not None:
                loan.status = str(payload["status"]).strip()
            db.commit()
            db.refresh(loan)
            system_cache.invalidate_tag("notifications")
            return cls.get_borrower(db=db, borrower_id=borrower_id)

        if "borrower_name" in payload and payload["borrower_name"] is not None:
            name_val = str(payload["borrower_name"]).strip()
            if name_val:
                b.borrower_name = name_val

        if "status" in payload and payload["status"] is not None:
            status_val = str(payload["status"]).strip()
            if status_val:
                b.status = status_val

        if "notes" in payload and payload["notes"] is not None:
            b.notes = str(payload["notes"]).strip()

        # Check if financial terms or dates were altered
        has_amount = payload.get("loan_amount") is not None
        has_rate = payload.get("interest_rate") is not None
        has_freq = payload.get("payment_frequency") is not None
        has_term = payload.get("term_days") is not None
        has_start = payload.get("date_borrowed") is not None
        has_due = payload.get("due_date") is not None

        if has_amount or has_rate or has_freq or has_term or has_start or has_due:
            p_candidate = quantize(payload["loan_amount"]) if has_amount else quantize(b.principal_amount)
            r_candidate = Decimal(str(payload["interest_rate"])) if has_rate else quantize(b.interest_rate or Decimal("20.00"))
            freq_candidate = (payload["payment_frequency"] or b.payment_frequency or "Daily").strip().capitalize() if has_freq else (b.payment_frequency or "Daily").strip().capitalize()
            term_candidate = int(payload["term_days"]) if has_term and int(payload["term_days"]) > 0 else (b.term_days or (40 if freq_candidate == "Daily" else 2))
            start_candidate = parse_date(payload["date_borrowed"]) if has_start else b.date_borrowed

            is_terms_different = (
                p_candidate != quantize(b.principal_amount)
                or r_candidate != quantize(b.interest_rate or Decimal("20.00"))
                or freq_candidate != (b.payment_frequency or "Daily").strip().capitalize()
                or term_candidate != (b.term_days or (40 if freq_candidate == "Daily" else 2))
                or start_candidate != b.date_borrowed
            )

            if is_terms_different:
                # Check if payments have started or start date is in the past
                tx_count = db.query(LendingTransaction).filter(LendingTransaction.borrower_id == b.borrower_id).count()
                today_d = date.today()
                is_started = (b.amount_paid and b.amount_paid > Decimal("0.00")) or tx_count > 0 or (b.date_borrowed and b.date_borrowed < today_d)

                if is_started:
                    raise HTTPException(
                        status_code=400,
                        detail="Cannot modify loan financial terms after the lending period has commenced or payments have been recorded."
                    )

            p = p_candidate
            r = r_candidate
            freq = freq_candidate
            term_days = term_candidate
            start = start_candidate
            due = parse_date(payload["due_date"]) if has_due else None

            terms = cls.calculate_terms(p, r, freq, start, due, term_days)
            due = parse_date(terms["due_date"])
            b.principal_amount = p
            b.interest_rate = Decimal(str(terms["interest_rate"]))
            b.total_payable = Decimal(str(terms["total_payable"]))
            b.remaining_balance = max(Decimal("0.00"), b.total_payable - (b.amount_paid or Decimal("0.00")))
            b.payment_frequency = freq
            b.term_days = term_days
            b.date_borrowed = start
            b.due_date = due

        db.commit()
        db.refresh(b)

        # Also update remote Supabase table if Supabase client is configured
        try:
            from app.db.supabase import get_supabase_admin_client
            client = get_supabase_admin_client()
            if client:
                client.table("borrowers").update({
                    "audit_status": b.audit_status,
                    "audited_by": b.audited_by,
                    "audited_at": b.audited_at.isoformat() if b.audited_at else None,
                    "audit_remarks": b.audit_remarks,
                }).eq("borrower_id", borrower_id).execute()
        except Exception:
            pass

        system_cache.invalidate_tag("notifications")
        return cls.get_borrower(db=db, borrower_id=borrower_id)

    @classmethod
    def delete_borrower(cls, db: Session, borrower_id: int) -> Dict[str, Any]:
        """Delete an existing borrower and all associated transactions."""
        b = db.query(Borrower).filter(Borrower.borrower_id == borrower_id).first()
        if b:
            db.delete(b)
            db.commit()
            system_cache.invalidate_tag("notifications")
            return {"success": True, "message": "Borrower deleted successfully."}

        loan = db.query(Loan).filter(Loan.loan_id == borrower_id).first()
        if loan:
            db.query(LoanRepayment).filter(LoanRepayment.loan_id == borrower_id).delete()
            db.delete(loan)
            db.commit()
            system_cache.invalidate_tag("notifications")
            return {"success": True, "message": "Borrower deleted successfully."}

        raise HTTPException(status_code=404, detail="Borrower not found.")

    @classmethod
    def save_audit_review(
        cls,
        db: Session,
        borrower_id: int,
        audit_status: str,
        remarks: Optional[str] = None,
        auditor_name: Optional[str] = "Auditor",
    ) -> Dict[str, Any]:
        """Save the audit review for a borrower facility."""
        b = db.query(Borrower).filter(Borrower.borrower_id == borrower_id).first()
        if not b:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Borrower not found.")

        if audit_status == "Pending Audit":
            b.audit_status = "Pending Audit"
            b.audited_by = None
            b.audited_at = None
            b.audit_remarks = None
        else:
            b.audit_status = audit_status
            resolved_auditor_name = auditor_name
            if resolved_auditor_name and "@" in str(resolved_auditor_name):
                try:
                    from app.models.user import User
                    db_user = db.query(User).filter(func.lower(User.email) == str(resolved_auditor_name).lower().strip()).first()
                    if db_user and db_user.name:
                        resolved_auditor_name = db_user.name
                    else:
                        from app.db.supabase import get_supabase_admin_client
                        client = get_supabase_admin_client()
                        if client:
                            res = client.table("users").select("name").ilike("email", str(resolved_auditor_name).lower().strip()).limit(1).execute()
                            if res.data and res.data[0].get("name"):
                                resolved_auditor_name = res.data[0]["name"]
                except Exception:
                    pass
            b.audited_by = resolved_auditor_name
            b.audited_at = datetime.now(timezone.utc)
            if audit_status == "Verified":
                b.audit_remarks = None
            else:
                b.audit_remarks = (remarks or "").strip() or None

        db.commit()
        db.refresh(b)

        # Also update remote Supabase table if Supabase client is configured
        try:
            from app.db.supabase import get_supabase_admin_client
            client = get_supabase_admin_client()
            if client:
                client.table("borrowers").update({
                    "audit_status": b.audit_status,
                    "audited_by": b.audited_by,
                    "audited_at": b.audited_at.isoformat() if b.audited_at else None,
                    "audit_remarks": b.audit_remarks,
                }).eq("borrower_id", borrower_id).execute()
        except Exception:
            pass

        system_cache.invalidate_tag("notifications")
        return cls.get_borrower(db=db, borrower_id=borrower_id)

    @hybrid_method
    def record_payment(
        self_or_none,
        *args,
        **kwargs,
    ) -> Dict[str, Any]:
        """
        Record a payment remittance in the lending_transactions table with period settlement locking.
        Penalty charges are user-inputted (or 0 if waived) and are NOT deducted from the contractual total payable.
        """
        cls = LendingService
        if self_or_none is not None:
            db = kwargs.pop("db", self_or_none.db)
            borrower_id = args[0] if len(args) > 0 else kwargs.pop("borrower_id", None)
            payment_date_val = args[1] if len(args) > 1 else kwargs.pop("payment_date_val", None)
            amount_val = args[2] if len(args) > 2 else kwargs.pop("amount_val", None)
        else:
            db = args[0] if len(args) > 0 else kwargs.pop("db", None)
            borrower_id = args[1] if len(args) > 1 else kwargs.pop("borrower_id", None)
            payment_date_val = args[2] if len(args) > 2 else kwargs.pop("payment_date_val", None)
            amount_val = args[3] if len(args) > 3 else kwargs.pop("amount_val", None)

        penalty_amount_val = kwargs.pop("penalty_amount_val", None)
        method = kwargs.pop("method", "Cash")
        reference_no = kwargs.pop("reference_no", None)
        notes = kwargs.pop("notes", None)
        recorded_by = kwargs.pop("recorded_by", None)
        transaction_type = kwargs.pop("transaction_type", "Repayment")
        cycle_due_date_val = kwargs.pop("cycle_due_date_val", None)
        cycle_index_val = kwargs.pop("cycle_index_val", None)

        if hasattr(borrower_id, "borrower_id"):
            data = borrower_id
            borrower_id = data.borrower_id
            payment_date_val = getattr(data, "payment_date", payment_date_val)
            amount_val = getattr(data, "amount", amount_val)
            penalty_amount_val = getattr(data, "penalty_amount", penalty_amount_val)
            method = getattr(data, "method", getattr(data, "payment_method", method))
            reference_no = getattr(data, "reference_no", reference_no)
            notes = getattr(data, "notes", notes)
            recorded_by = getattr(data, "recorded_by", recorded_by)
            cycle_due_date_val = getattr(data, "cycle_due_date", cycle_due_date_val)
            cycle_index_val = getattr(data, "cycle_index", cycle_index_val)
        b = db.query(Borrower).filter(Borrower.borrower_id == borrower_id).first()

        if b:
            freq = b.payment_frequency or "Daily"
            term_days = b.term_days or (40 if freq == "Daily" else 60)

            existing_txs = (
                db.query(LendingTransaction)
                .filter(LendingTransaction.borrower_id == b.borrower_id)
                .order_by(LendingTransaction.payment_date.desc(), LendingTransaction.created_at.desc())
                .all()
            )
            repayment_dicts = [
                {
                    "date": t.payment_date.isoformat() if t.payment_date else "",
                    "payment_date": t.payment_date.isoformat() if t.payment_date else "",
                    "cycle_due_date": t.cycle_due_date.isoformat() if t.cycle_due_date else "",
                    "cycle_index": t.cycle_index,
                    "is_late": t.is_late or False,
                    "days_late": t.days_late or 0,
                    "amount": float(t.amount or 0),
                    "penalty_portion": float(t.penalty_portion or 0),
                    "penalty": float(t.penalty_portion or 0),
                    "status": "Paid" if (t.status or "").lower() == "completed" else (t.status or "Paid"),
                }
                for t in existing_txs
            ]

            # 1. Terms & contractual balances
            terms = cls.calculate_terms(
                b.principal_amount,
                b.interest_rate or Decimal("20.00"),
                freq,
                b.date_borrowed,
                b.due_date,
                term_days,
            )

            pay_date = parse_date(payment_date_val) or date.today()
            target_cycle_due = parse_date(cycle_due_date_val) or pay_date

            # 2. Period settlement locking check
            is_locked, lock_reason = cls.check_period_settlement(
                freq,
                payment_date_val,
                repayment_dicts,
                installment_target=terms["installment_target"],
                cycle_due_date_val=target_cycle_due,
            )
            if is_locked:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=lock_reason or "Period or date is already fully settled and locked.",
                )

            # 3. Determine lateness and user-input penalty charge
            installment_target = quantize(terms["installment_target"])
            is_late = False
            days_late = 0

            if target_cycle_due and pay_date > target_cycle_due:
                is_late = True
                days_late = max(1, (pay_date - target_cycle_due).days)

            # Penalty is specified directly by user (or 0 if waived), NOT auto-calculated.
            # It can be 0.00 but can never be negative.
            if penalty_amount_val is not None:
                penalty_portion = quantize(penalty_amount_val)
                if penalty_portion < Decimal("0.00"):
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="Late payment charges can be 0.00 but can never be a negative value.",
                    )
            else:
                penalty_portion = Decimal("0.00")

            # Sum penalties from previous transactions
            prev_penalties = sum((Decimal(str(r.get("penalty_portion", 0))) for r in repayment_dicts), Decimal("0.00"))
            total_penalties = prev_penalties + penalty_portion

            # Contractual total payable (Principal + Interest) remains unaltered by penalties.
            # Only the repayment amount reduces the loan balance.
            contractual_total_payable = quantize(terms["total_payable"])
            total_paid_before = sum((Decimal(str(r["amount"])) for r in repayment_dicts), Decimal("0.00"))
            remaining_before = max(Decimal("0.00"), contractual_total_payable - total_paid_before)

            payment_amount = quantize(amount_val)
            cls.validate_payment_bounds(payment_amount, remaining_before)

            # 4. Create LendingTransaction record
            ref_clean = reference_no.strip() if reference_no and reference_no.strip() else None
            tx_ref = f"TX-{datetime.now().strftime('%Y%m%d')}-{int(datetime.now().timestamp() % 10000):04d}"

            rem_bal = max(Decimal("0.00"), remaining_before - payment_amount)

            # Determine if this payment fully settles the installment target or is Partially Paid
            paid_for_cycle_before = sum(
                (
                    Decimal(str(r["amount"]))
                    for r in repayment_dicts
                    if (
                        (cycle_index_val is not None and (r.get("cycle_index") == cycle_index_val or r.get("month_index") == cycle_index_val))
                        or str(r.get("cycle_due_date") or r.get("date") or "").split("T")[0] == target_cycle_due.isoformat()
                    )
                ),
                Decimal("0.00"),
            )
            is_period_settled = (paid_for_cycle_before + payment_amount) >= installment_target or rem_bal <= Decimal("0.00")

            tx_db_status = "Completed" if is_period_settled else "Partially Paid"
            tx_out_status = "Paid" if is_period_settled else "Partially Paid"

            new_tx = LendingTransaction(
                borrower_id=b.borrower_id,
                transaction_ref_no=tx_ref,
                transaction_type=transaction_type or "Repayment",
                payment_date=pay_date,
                due_date=b.due_date,
                cycle_index=cycle_index_val,
                cycle_due_date=target_cycle_due,
                is_late=is_late,
                days_late=days_late,
                amount=payment_amount,
                penalty_portion=penalty_portion,
                remaining_balance=rem_bal,
                payment_method=method.strip() if method else "Cash",
                reference_no=ref_clean,
                status=tx_db_status,
                notes=(notes or "").strip(),
                recorded_by=recorded_by,
            )
            if db.bind and db.bind.dialect.name == "sqlite":
                from sqlalchemy import func
                max_t_id = db.query(func.max(LendingTransaction.transaction_id)).scalar() or 0
                new_tx.transaction_id = max_t_id + 1
            db.add(new_tx)

            # If now settled on this cycle date, mark any earlier partial transactions as Completed
            if is_period_settled:
                for prev_tx in existing_txs:
                    prev_cycle_due = prev_tx.cycle_due_date or prev_tx.payment_date
                    matches_cycle = (
                        (cycle_index_val is not None and prev_tx.cycle_index == cycle_index_val)
                        or (prev_cycle_due == target_cycle_due)
                    )
                    if matches_cycle and prev_tx.status in {"Partially Paid", "Partial"}:
                        prev_tx.status = "Completed"

            # 5. Update borrower status and persistent ledger totals
            # Penalty is NOT included in the deduction of total payable.
            b.amount_paid = total_paid_before + payment_amount
            b.total_penalties = total_penalties
            b.total_payable = contractual_total_payable
            b.remaining_balance = rem_bal
            if rem_bal <= Decimal("0.00"):
                b.status = "Fully Paid"
            elif is_late:
                b.status = "Overdue"

            db.commit()
            db.refresh(new_tx)
            db.refresh(b)
            system_cache.invalidate_tag("notifications")

            return LendingServiceResult({
                "transaction_id": new_tx.transaction_id,
                "transaction_ref_no": new_tx.transaction_ref_no,
                "transactionRefNo": new_tx.transaction_ref_no,
                "repayment_id": new_tx.transaction_id,
                "borrower_id": b.borrower_id,
                "loan_id": b.borrower_id,
                "payment_date": pay_date.isoformat(),
                "cycle_due_date": target_cycle_due.isoformat() if target_cycle_due else "",
                "cycle_index": cycle_index_val,
                "is_late": is_late,
                "days_late": days_late,
                "amount": float(payment_amount),
                "penalty_portion": float(penalty_portion),
                "remaining_balance": float(rem_bal),
                "status": tx_out_status,
                "payment_method": new_tx.payment_method,
                "reference_no": ref_clean or "",
                "notes": notes or "",
                "recorded_by": new_tx.recorded_by,
                "recordedBy": new_tx.recorded_by,
            })

        # Fallback to legacy loan table
        loan = db.query(Loan).filter(Loan.loan_id == borrower_id).first()
        if not loan:
            raise HTTPException(status_code=404, detail="Borrower not found.")

        meta = cls.parse_loan_description(loan.description)
        freq = meta.get("frequency", "Daily")
        term_days = meta.get("term_days", 40 if freq == "Daily" else 60)

        existing_repayments = (
            db.query(LoanRepayment)
            .filter(LoanRepayment.loan_id == loan.loan_id)
            .order_by(LoanRepayment.payment_date.desc())
            .all()
        )
        repayment_dicts = [
            {
                "date": r.payment_date.isoformat() if r.payment_date else "",
                "amount": float(r.amount or 0),
                "status": "Paid" if (r.status or "").lower() == "completed" else "Paid",
            }
            for r in existing_repayments
        ]

        is_locked, lock_reason = cls.check_period_settlement(freq, payment_date_val, repayment_dicts)
        if is_locked:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=lock_reason or "Period or date is already fully settled and locked.",
            )

        terms = cls.calculate_terms(
            loan.principal_amount,
            loan.interest_rate or Decimal("20.00"),
            freq,
            loan.loan_date,
            loan.due_date,
            term_days,
        )

        total_paid_before = sum((Decimal(str(r["amount"])) for r in repayment_dicts), Decimal("0.00"))

        if freq == "Daily":
            _, ledger_meta = cls.build_daily_ledger(
                loan.loan_date,
                loan.due_date,
                repayment_dicts,
                term_days=terms["term_days"],
                installment_target=terms["installment_target"],
                penalty_per_cycle=terms["penalty_per_cycle"],
            )
            total_penalties = Decimal(str(ledger_meta["total_penalties"]))
        else:
            progress = cls.get_monthly_progress(
                loan.loan_date,
                loan.due_date,
                terms["total_payable"],
                repayment_dicts,
                term_days=terms["term_days"],
            )
            total_penalties = Decimal(str(progress["totalPenalties"]))

        contractual_total_payable = Decimal(str(terms["total_payable"]))
        remaining_before = max(Decimal("0.00"), contractual_total_payable - total_paid_before)

        payment_amount = quantize(amount_val)
        cls.validate_payment_bounds(payment_amount, remaining_before)

        pay_date = parse_date(payment_date_val) or date.today()
        ref_text = reference_no.strip() if reference_no and reference_no.strip() else None

        new_repayment = LoanRepayment(
            loan_id=loan.loan_id,
            payment_date=pay_date,
            due_date=loan.due_date,
            amount=payment_amount,
            remaining_balance=max(Decimal("0.00"), remaining_before - payment_amount),
            reference_no=ref_text,
            status="completed",
            notes=(notes or "").strip(),
            received_at=datetime.now(),
        )
        db.add(new_repayment)

        updated_remaining = remaining_before - payment_amount
        if updated_remaining <= Decimal("0.00"):
            loan.status = "Completed"
        db.commit()
        db.refresh(new_repayment)
        system_cache.invalidate_tag("notifications")

        return LendingServiceResult({
            "transaction_id": new_repayment.loan_repayment_id,
            "repayment_id": new_repayment.loan_repayment_id,
            "borrower_id": loan.loan_id,
            "loan_id": loan.loan_id,
            "payment_date": pay_date.isoformat(),
            "amount": float(payment_amount),
            "remaining_balance": float(updated_remaining),
            "status": "Paid",
            "payment_method": method.strip(),
            "reference_no": ref_text or "",
            "notes": notes or "",
        })

    @classmethod
    def update_payment(
        cls,
        db: Session,
        transaction_id: int,
        payload: Dict[str, Any],
        user: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Update an existing payment remittance and recalculate borrower balances and installment settlement statuses."""
        tx = db.query(LendingTransaction).filter(LendingTransaction.transaction_id == transaction_id).first()
        if not tx:
            rep = db.query(LoanRepayment).filter(LoanRepayment.loan_repayment_id == transaction_id).first()
            if not rep:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment remittance not found.")
            loan = db.query(Loan).filter(Loan.loan_id == rep.loan_id).first()
            if not loan:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan facility not found.")
            if "payment_date" in payload and payload["payment_date"]:
                rep.payment_date = parse_date(payload["payment_date"]) or rep.payment_date
            if "amount" in payload and payload["amount"] is not None:
                rep.amount = quantize(payload["amount"])
            if "reference_no" in payload:
                rep.reference_no = payload["reference_no"] or "-"
            if "notes" in payload:
                rep.notes = payload["notes"] or "-"
            db.commit()
            db.expire_all()
            system_cache.invalidate_tag("notifications")
            return cls.get_borrower(db=db, borrower_id=loan.loan_id)

        borrower = db.query(Borrower).filter(Borrower.borrower_id == tx.borrower_id).first()
        if not borrower:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Borrower not found.")

        # Update transaction fields
        if "payment_date" in payload and payload["payment_date"]:
            tx.payment_date = parse_date(payload["payment_date"]) or tx.payment_date
        if "cycle_due_date" in payload and payload["cycle_due_date"]:
            tx.cycle_due_date = parse_date(payload["cycle_due_date"]) or tx.cycle_due_date
        if "cycle_index" in payload:
            tx.cycle_index = payload["cycle_index"]
        if "amount" in payload and payload["amount"] is not None:
            tx.amount = quantize(payload["amount"])
        if "penalty_amount" in payload and payload["penalty_amount"] is not None:
            tx.penalty_portion = quantize(payload["penalty_amount"])
        elif "penalty_portion" in payload and payload["penalty_portion"] is not None:
            tx.penalty_portion = quantize(payload["penalty_portion"])
        if "method" in payload and payload["method"]:
            tx.payment_method = payload["method"].strip()
        if "reference_no" in payload:
            ref = str(payload["reference_no"]).strip() if payload["reference_no"] else None
            tx.reference_no = ref or "-"
        if "notes" in payload:
            n = str(payload["notes"]).strip() if payload["notes"] else None
            tx.notes = n or "-"

        # Recalculate lateness
        pay_date = tx.payment_date or date.today()
        target_cycle_due = tx.cycle_due_date or pay_date
        if target_cycle_due and pay_date > target_cycle_due:
            tx.is_late = True
            tx.days_late = max(1, (pay_date - target_cycle_due).days)
        else:
            tx.is_late = False
            tx.days_late = 0

        db.flush()

        # Recalculate borrower terms and totals
        freq = borrower.payment_frequency or "Daily"
        term_days = borrower.term_days or (40 if freq == "Daily" else 60)
        terms = cls.calculate_terms(
            borrower.principal_amount,
            borrower.interest_rate or Decimal("20.00"),
            freq,
            borrower.date_borrowed,
            borrower.due_date,
            term_days,
        )

        all_txs = (
            db.query(LendingTransaction)
            .filter(LendingTransaction.borrower_id == borrower.borrower_id)
            .order_by(LendingTransaction.payment_date.asc(), LendingTransaction.created_at.asc())
            .all()
        )

        total_paid = sum((Decimal(str(t.amount or 0)) for t in all_txs), Decimal("0.00"))
        total_penalties = sum((Decimal(str(t.penalty_portion or 0)) for t in all_txs), Decimal("0.00"))
        contractual_total_payable = quantize(terms["total_payable"])
        remaining_balance = max(Decimal("0.00"), contractual_total_payable - total_paid)
        installment_target = quantize(terms["installment_target"])

        # Update borrower aggregates
        borrower.amount_paid = total_paid
        borrower.total_penalties = total_penalties
        borrower.total_payable = contractual_total_payable
        borrower.remaining_balance = remaining_balance
        if remaining_balance <= Decimal("0.00"):
            borrower.status = "Fully Paid"
        elif any(t.is_late for t in all_txs) or (borrower.due_date and date.today() > borrower.due_date):
            borrower.status = "Overdue"
        else:
            borrower.status = "Active"

        # Update per-cycle status on transactions
        paid_by_cycle: Dict[str, Decimal] = {}
        for t in all_txs:
            cycle_key = str(t.cycle_due_date or t.payment_date or "")
            paid_by_cycle[cycle_key] = paid_by_cycle.get(cycle_key, Decimal("0.00")) + Decimal(str(t.amount or 0))

        for t in all_txs:
            cycle_key = str(t.cycle_due_date or t.payment_date or "")
            is_settled = (paid_by_cycle.get(cycle_key, Decimal("0.00")) >= installment_target) or (remaining_balance <= Decimal("0.00"))
            t.status = "Completed" if is_settled else "Partially Paid"

        db.commit()
        db.expire_all()
        system_cache.invalidate_tag("notifications")
        return cls.get_borrower(db=db, borrower_id=borrower.borrower_id)

    @classmethod
    def delete_payment(
        cls,
        db: Session,
        transaction_id: int,
        user: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Delete an existing payment remittance and recalculate borrower balances and installment settlement statuses."""
        tx = db.query(LendingTransaction).filter(LendingTransaction.transaction_id == transaction_id).first()
        if not tx:
            rep = db.query(LoanRepayment).filter(LoanRepayment.loan_repayment_id == transaction_id).first()
            if not rep:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment remittance not found.")
            loan_id = rep.loan_id
            db.delete(rep)
            db.commit()
            db.expire_all()
            system_cache.invalidate_tag("notifications")
            return cls.get_borrower(db=db, borrower_id=loan_id)

        borrower_id = tx.borrower_id
        borrower = db.query(Borrower).filter(Borrower.borrower_id == borrower_id).first()
        if not borrower:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Borrower not found.")

        db.delete(tx)
        db.flush()

        # Recalculate borrower terms and totals
        freq = borrower.payment_frequency or "Daily"
        term_days = borrower.term_days or (40 if freq == "Daily" else 60)
        terms = cls.calculate_terms(
            borrower.principal_amount,
            borrower.interest_rate or Decimal("20.00"),
            freq,
            borrower.date_borrowed,
            borrower.due_date,
            term_days,
        )

        all_txs = (
            db.query(LendingTransaction)
            .filter(LendingTransaction.borrower_id == borrower.borrower_id)
            .order_by(LendingTransaction.payment_date.asc(), LendingTransaction.created_at.asc())
            .all()
        )

        total_paid = sum((Decimal(str(t.amount or 0)) for t in all_txs), Decimal("0.00"))
        total_penalties = sum((Decimal(str(t.penalty_portion or 0)) for t in all_txs), Decimal("0.00"))
        contractual_total_payable = quantize(terms["total_payable"])
        remaining_balance = max(Decimal("0.00"), contractual_total_payable - total_paid)
        installment_target = quantize(terms["installment_target"])

        # Update borrower aggregates
        borrower.amount_paid = total_paid
        borrower.total_penalties = total_penalties
        borrower.total_payable = contractual_total_payable
        borrower.remaining_balance = remaining_balance
        if remaining_balance <= Decimal("0.00"):
            borrower.status = "Fully Paid"
        elif any(t.is_late for t in all_txs) or (borrower.due_date and date.today() > borrower.due_date):
            borrower.status = "Overdue"
        else:
            borrower.status = "Active"

        # Update per-cycle status on remaining transactions
        paid_by_cycle = {}
        for t in all_txs:
            cycle_key = str(t.cycle_due_date or t.payment_date or "")
            paid_by_cycle[cycle_key] = paid_by_cycle.get(cycle_key, Decimal("0.00")) + Decimal(str(t.amount or 0))

        for t in all_txs:
            cycle_key = str(t.cycle_due_date or t.payment_date or "")
            is_settled = (paid_by_cycle.get(cycle_key, Decimal("0.00")) >= installment_target) or (remaining_balance <= Decimal("0.00"))
            t.status = "Completed" if is_settled else "Partially Paid"

        db.commit()
        db.expire_all()
        system_cache.invalidate_tag("notifications")
        return cls.get_borrower(db=db, borrower_id=borrower.borrower_id)

    @classmethod
    def get_transactions(
        cls,
        db: Session,
        borrower_id: Optional[int] = None,
        transaction_type: Optional[str] = None,
        payment_method: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Query and filter lending transactions from the lending_transactions table."""
        query = db.query(LendingTransaction)
        if borrower_id:
            query = query.filter(LendingTransaction.borrower_id == borrower_id)
        if transaction_type:
            query = query.filter(LendingTransaction.transaction_type == transaction_type)
        if payment_method:
            query = query.filter(LendingTransaction.payment_method == payment_method)
        if date_from:
            d_from = parse_date(date_from)
            if d_from:
                query = query.filter(LendingTransaction.payment_date >= d_from)
        if date_to:
            d_to = parse_date(date_to)
            if d_to:
                query = query.filter(LendingTransaction.payment_date <= d_to)

        txs = query.order_by(LendingTransaction.payment_date.desc(), LendingTransaction.created_at.desc()).all()
        return [
            {
                "transaction_id": t.transaction_id,
                "borrower_id": t.borrower_id,
                "transaction_ref_no": t.transaction_ref_no,
                "transaction_type": t.transaction_type,
                "payment_date": t.payment_date.isoformat() if t.payment_date else "",
                "due_date": t.due_date.isoformat() if t.due_date else "",
                "cycle_index": t.cycle_index,
                "cycle_due_date": t.cycle_due_date.isoformat() if t.cycle_due_date else None,
                "is_late": t.is_late or False,
                "days_late": t.days_late or 0,
                "amount": float(t.amount or 0),
                "penalty_portion": float(t.penalty_portion or 0),
                "remaining_balance": float(t.remaining_balance) if t.remaining_balance is not None else None,
                "payment_method": t.payment_method or "Cash",
                "reference_no": t.reference_no or "-",
                "status": t.status or "Completed",
                "notes": t.notes or "-",
                "recorded_by": t.recorded_by,
                "created_at": t.created_at.isoformat() if t.created_at else "",
                "updated_at": t.updated_at.isoformat() if t.updated_at else "",
            }
            for t in txs
        ]

    @classmethod
    def get_transaction(cls, db: Session, transaction_id: int) -> Dict[str, Any]:
        """Fetch single transaction by ID."""
        t = db.query(LendingTransaction).filter(LendingTransaction.transaction_id == transaction_id).first()
        if not t:
            raise HTTPException(status_code=404, detail="Lending transaction not found.")
        return {
            "transaction_id": t.transaction_id,
            "borrower_id": t.borrower_id,
            "transaction_ref_no": t.transaction_ref_no,
            "transaction_type": t.transaction_type,
            "payment_date": t.payment_date.isoformat() if t.payment_date else "",
            "due_date": t.due_date.isoformat() if t.due_date else "",
            "cycle_index": t.cycle_index,
            "cycle_due_date": t.cycle_due_date.isoformat() if t.cycle_due_date else None,
            "is_late": t.is_late or False,
            "days_late": t.days_late or 0,
            "amount": float(t.amount or 0),
            "penalty_portion": float(t.penalty_portion or 0),
            "remaining_balance": float(t.remaining_balance) if t.remaining_balance is not None else None,
            "payment_method": t.payment_method or "Cash",
            "reference_no": t.reference_no or "-",
            "status": t.status or "Completed",
            "notes": t.notes or "-",
            "recorded_by": t.recorded_by,
            "created_at": t.created_at.isoformat() if t.created_at else "",
            "updated_at": t.updated_at.isoformat() if t.updated_at else "",
        }

