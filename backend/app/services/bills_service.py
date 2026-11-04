from calendar import monthrange
from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.cache import system_cache
from app.models.bills import Bill, BillPayment
from app.models.company import Company
from app.schemas.bills import (
    BillCreate,
    BillOut,
    BillPaymentCreate,
    BillPaymentOut,
    BillPeriodOut,
    BillReminderOut,
    BillScheduleOut,
    BillStatsOut,
    BillUpdate,
)


RECURRING_VALUES = {"daily", "monthly", "yearly", "one-time"}


def _add_period(period_date: date, recurring: str, count: int = 1, anchor_day: Optional[int] = None) -> date:
    if recurring == "one-time":
        return period_date
    day = anchor_day if anchor_day is not None else period_date.day
    if recurring == "daily":
        return date.fromordinal(period_date.toordinal() + count)
    if recurring == "yearly":
        year = period_date.year + count
        month = period_date.month
        max_day = monthrange(year, month)[1]
        return date(year, month, min(day, max_day))
    month_index = period_date.year * 12 + period_date.month - 1 + count
    year, month_zero_based = divmod(month_index, 12)
    month = month_zero_based + 1
    max_day = monthrange(year, month)[1]
    return date(year, month, min(day, max_day))


def _period_key(period_date: date, recurring: str) -> str:
    if recurring in {"daily", "one-time"}:
        return period_date.isoformat()
    if recurring == "yearly":
        return str(period_date.year)
    return period_date.strftime("%Y-%m")


def _period_label(period_date: date, recurring: str) -> str:
    if recurring in {"daily", "one-time"}:
        return period_date.strftime("%b %d, %Y").replace(" 0", " ")
    if recurring == "yearly":
        return str(period_date.year)
    return period_date.strftime("%B %Y")


def _normalize_recurring(value: Optional[str]) -> str:
    recurring = (value or "monthly").lower()
    if recurring in {"one-time", "onetime", "once", "one_time"}:
        return "one-time"
    if recurring not in RECURRING_VALUES:
        raise HTTPException(status_code=400, detail="Recurring must be daily, monthly, or yearly.")
    return recurring


KNOWN_COMPANY_ALIASES = {
    "mct kitchen": ["mycity kitchen", "kitchen"],
    "kitchen": ["mycity kitchen", "kitchen"],
    "mct hotel": ["mctolentino", "hotel", "hospitality"],
    "hotel": ["mctolentino", "hotel", "hospitality"],
    "filcap": ["filcap", "filcam"],
    "filcap prime holdings corp.": ["filcap", "filcam"],
    "filcap prime": ["filcap", "filcam"],
    "jk property": ["jk property and ventures", "property ventures"],
    "jk property and ventures": ["jk property and ventures", "property ventures"],
    "speedbox": ["speedfire construction", "speedfire"],
    "speedfire": ["speedfire construction", "speedfire"],
    "jk printing": ["jk global headways", "printing"],
    "golden sunburst": ["golden jupiter property ventures", "golden jupiter"],
    "golden sunburst ventures": ["golden jupiter property ventures", "golden jupiter"],
}


def _resolve_company(db: Session, company_id: Optional[int], company_name: Optional[str]) -> Company:
    if company_id:
        company = db.query(Company).filter(Company.company_id == company_id).first()
        if company:
            return company

    all_companies = db.query(Company).all()

    if not company_name or not company_name.strip() or company_name.strip().lower() == "all companies":
        if all_companies:
            return all_companies[0]
        raise HTTPException(status_code=400, detail="A valid company_id or company name is required.")

    clean_name = company_name.strip()
    clean_lower = clean_name.lower()

    company = db.query(Company).filter(Company.company_name.ilike(clean_name)).first()
    if company:
        return company

    for c in all_companies:
        if c.company_name.strip().lower() == clean_lower:
            return c

    for alias_key, search_terms in KNOWN_COMPANY_ALIASES.items():
        if alias_key in clean_lower or clean_lower in alias_key:
            for term in search_terms:
                for c in all_companies:
                    if term in c.company_name.strip().lower():
                        return c

    for c in all_companies:
        c_clean = c.company_name.strip().lower()
        if clean_lower in c_clean or c_clean in clean_lower:
            return c

    words = [w for w in clean_lower.replace("&", " ").replace(".", " ").split() if len(w) >= 4]
    for w in words:
        for c in all_companies:
            if w in c.company_name.lower():
                return c

    raise HTTPException(status_code=400, detail="A valid company_id or company name is required.")


class BillsService:
    @staticmethod
    def _add_months(d: date, months: int) -> date:
        month_index = d.year * 12 + d.month - 1 + months
        year, month_zero_based = divmod(month_index, 12)
        month = month_zero_based + 1
        max_day = monthrange(year, month)[1]
        return date(year, month, min(d.day, max_day))

    def __init__(self, db: Session):
        self.db = db

    def _periods(
        self,
        bill: Bill,
        as_of: date = date.today(),
        company_ids: Optional[List[int]] = None,
        include_future: Optional[int] = None,
        validate_payments: bool = True,
    ) -> List[dict]:
        recurring = _normalize_recurring(bill.recurring)
        anchor_day = bill.due_date.day
        period_date = bill.due_date

        if recurring == "one-time":
            min_future = 0
            max_periods = 1
        elif recurring == "daily":
            min_future = 30 if include_future is None else include_future
            max_periods = 180
        elif recurring == "yearly":
            min_future = 5 if include_future is None else include_future
            max_periods = 20
        else:
            min_future = 12 if include_future is None else include_future
            max_periods = 60

        # Anchor start date, clamping to not go unreasonably far in the past
        if period_date.year < 2025:
            period_date = date(2025, 1, min(anchor_day, monthrange(2025, 1)[1]))

        # Pre-index payments by period_key in O(P) instead of scanning inside the period loop
        payments_by_key: dict[str, list[BillPayment]] = {}
        max_payment_key = ""
        for item in (bill.payments or []):
            pk = item.period_key or ""
            payments_by_key.setdefault(pk, []).append(item)
            if pk > max_payment_key:
                max_payment_key = pk

        periods = []
        future_count = 0
        for _ in range(max_periods):
            key = _period_key(period_date, recurring)
            period_payments = payments_by_key.get(key, [])
            paid_amount = sum((item.amount for item in period_payments), Decimal("0.00"))

            # Determine billed statement amount for this period
            period_billed = max(
                (p.billed_amount for p in period_payments if p.billed_amount is not None),
                default=None,
            )
            if period_billed is None:
                if period_payments:
                    period_billed = paid_amount
                elif bill.amount and bill.amount > Decimal("0.00"):
                    period_billed = bill.amount
                else:
                    period_billed = None

            if period_billed is not None and period_billed > Decimal("0.00"):
                is_paid = paid_amount >= period_billed
                is_partially_paid = not is_paid and paid_amount > Decimal("0.00")
                remaining_amount = Decimal("0.00") if is_paid else max(Decimal("0.00"), period_billed - paid_amount)
            else:
                is_paid = paid_amount > Decimal("0.00")
                is_partially_paid = False
                remaining_amount = Decimal("0.00")

            latest_payment = max(
                period_payments,
                key=lambda p: (p.payment_date, p.bill_payment_id),
                default=None,
            )
            is_future = period_date > as_of
            if is_future:
                future_count += 1

            periods.append({
                "period_key": key,
                "period_label": _period_label(period_date, recurring),
                "period_date": period_date,
                "paid": is_paid,
                "partially_paid": is_partially_paid,
                "billed_amount": period_billed,
                "paid_amount": paid_amount,
                "remaining_amount": remaining_amount,
                "payment_date": latest_payment.payment_date if latest_payment else None,
                "is_future": is_future,
                "payments": (
                    [
                        BillPaymentOut.model_validate(p)
                        for p in sorted(
                            period_payments,
                            key=lambda p: (p.payment_date, p.bill_payment_id),
                            reverse=True,
                        )
                    ]
                    if validate_payments and period_payments
                    else []
                ),
            })

            if period_date >= as_of and future_count >= min_future:
                if max_payment_key <= key:
                    break

            period_date = _add_period(period_date, recurring, 1, anchor_day=anchor_day)

        return periods

    def _next_period(
        self,
        bill: Bill,
        as_of: date = date.today(),
        company_ids: Optional[List[int]] = None,
        periods: Optional[List[dict]] = None,
    ) -> Optional[dict]:
        if periods is None:
            periods = self._periods(bill, as_of)
        # Oldest unpaid period is always next payable (past due first, then current, then future advance)
        return next((p for p in periods if not p["paid"]), None)

    def _status(
        self,
        bill: Bill,
        as_of: date = date.today(),
        company_ids: Optional[List[int]] = None,
        periods: Optional[List[dict]] = None,
    ) -> str:
        if periods is None:
            periods = self._periods(bill, as_of)
        unpaid_past_or_current = next(
            (p for p in periods if not p["paid"] and not p["is_future"]),
            None,
        )
        if not unpaid_past_or_current:
            return "paid"
        if unpaid_past_or_current.get("partially_paid"):
            return "partially paid"
        if unpaid_past_or_current["period_date"] < as_of:
            return "overdue"
        recurring = _normalize_recurring(bill.recurring)
        reminder_days = 0 if recurring == "daily" else bill.due_date_reminder
        diff_days = (unpaid_past_or_current["period_date"] - as_of).days
        if diff_days <= reminder_days:
            return "due soon"
        return "unpaid"

    def _to_output(self, bill: Bill, as_of: date = date.today()) -> BillOut:
        periods = self._periods(bill, as_of)
        next_period = self._next_period(bill, as_of, periods=periods)
        latest_payment = max(
            bill.payments,
            key=lambda p: (p.payment_date, p.bill_payment_id),
            default=None,
        )
        latest_amount = None
        if latest_payment:
            latest_amount = latest_payment.billed_amount if latest_payment.billed_amount is not None else latest_payment.amount
        elif bill.amount and bill.amount > Decimal("0.00"):
            latest_amount = bill.amount

        return BillOut(
            bill_id=bill.bill_id,
            company_id=bill.company_id,
            company=bill.company.company_name if bill.company else None,
            bill_name=bill.bill_name,
            amount=bill.amount or Decimal("0.00"),
            latest_amount=latest_amount,
            recurring=_normalize_recurring(bill.recurring),
            due_date=bill.due_date,
            due_date_reminder=bill.due_date_reminder,
            notes=bill.notes,
            status=self._status(bill, as_of, periods=periods),
            created_at=bill.created_at,
            updated_at=bill.updated_at,
            payments=[
                BillPaymentOut.model_validate(p)
                for p in sorted(
                    bill.payments,
                    key=lambda p: (p.payment_date, p.bill_payment_id),
                    reverse=True,
                )
            ],
            next_period_key=next_period["period_key"] if next_period else None,
            next_period_label=next_period["period_label"] if next_period else None,
            next_period_date=next_period["period_date"] if next_period else None,
            periods=[
                BillPeriodOut(
                    **period,
                    is_next_payable=bool(next_period and period["period_key"] == next_period["period_key"]),
                )
                for period in periods
            ],
        )

    def list_bills(
        self,
        company_id: Optional[int] = None,
        company_name: Optional[str] = None,
        company_ids: Optional[List[int]] = None,
    ) -> List[BillOut]:
        query = self.db.query(Bill).options(joinedload(Bill.company), selectinload(Bill.payments))
        if company_id:
            query = query.filter(Bill.company_id == company_id)
        elif company_name and company_name.lower() != "all companies":
            resolved = _resolve_company(self.db, None, company_name)
            query = query.filter(Bill.company_id == resolved.company_id)
        elif company_ids:
            query = query.filter(Bill.company_id.in_(company_ids))
        return [self._to_output(bill) for bill in query.order_by(Bill.created_at.desc(), Bill.bill_id.desc()).all()]

    def get_bill(self, bill_id: int) -> Bill:
        bill = (
            self.db.query(Bill)
            .options(joinedload(Bill.company), selectinload(Bill.payments))
            .filter(Bill.bill_id == bill_id)
            .first()
        )
        if not bill:
            raise HTTPException(status_code=404, detail="Bill not found.")
        return bill

    def create_bill(self, data: BillCreate) -> BillOut:
        company = _resolve_company(self.db, data.company_id, data.company)
        clean_name = data.bill_name.strip()
        existing = (
            self.db.query(Bill)
            .filter(
                Bill.company_id == company.company_id,
                func.lower(Bill.bill_name) == clean_name.lower(),
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"A bill with provider name '{clean_name}' already exists for {company.company_name}."
            )
        values = data.model_dump(exclude={"company", "company_id", "status"})
        values.update(
            company_id=company.company_id,
            bill_name=clean_name,
            amount=values.get("amount") or Decimal("0.00"),
            recurring=_normalize_recurring(data.recurring),
            status="unpaid",
        )
        bill = Bill(**values)
        self.db.add(bill)
        self.db.commit()
        system_cache.invalidate_tag("notifications")
        return self._to_output(self.get_bill(bill.bill_id))

    def update_bill(self, bill_id: int, data: BillUpdate) -> BillOut:
        bill = self.get_bill(bill_id)
        values = data.model_dump(exclude_unset=True, exclude_none=True)
        if "bill_name" in values and values["bill_name"].strip():
            clean_name = values["bill_name"].strip()
            target_company_id = bill.company_id
            if "company_id" in values or "company" in values:
                comp = _resolve_company(self.db, values.get("company_id"), values.get("company"))
                target_company_id = comp.company_id
            existing = (
                self.db.query(Bill)
                .filter(
                    Bill.bill_id != bill_id,
                    Bill.company_id == target_company_id,
                    func.lower(Bill.bill_name) == clean_name.lower(),
                )
                .first()
            )
            if existing:
                raise HTTPException(
                    status_code=400,
                    detail=f"A bill with provider name '{clean_name}' already exists."
                )
            values["bill_name"] = clean_name
        if "company_id" in values or "company" in values:
            company = _resolve_company(self.db, values.pop("company_id", None), values.pop("company", None))
            bill.company_id = company.company_id
        if "recurring" in values:
            values["recurring"] = _normalize_recurring(values["recurring"])
        for key, value in values.items():
            if key != "status":
                setattr(bill, key, value)
        self.db.commit()
        system_cache.invalidate_tag("notifications")
        return self._to_output(self.get_bill(bill_id))

    def delete_bill(self, bill_id: int) -> None:
        self.db.delete(self.get_bill(bill_id))
        self.db.commit()
        system_cache.invalidate_tag("notifications")

    def schedule(self, bill_id: int, as_of: date = date.today()) -> BillScheduleOut:
        bill = self.get_bill(bill_id)
        periods = self._periods(bill, as_of)
        next_period = self._next_period(bill, as_of, periods=periods)
        return BillScheduleOut(
            bill_id=bill.bill_id,
            recurring=_normalize_recurring(bill.recurring),
            periods=[
                BillPeriodOut(
                    **period,
                    is_next_payable=bool(next_period and period["period_key"] == next_period["period_key"]),
                )
                for period in periods
            ],
            next_period_key=next_period["period_key"] if next_period else None,
            next_period_label=next_period["period_label"] if next_period else None,
        )

    def record_payment(self, bill_id: int, data: BillPaymentCreate) -> BillOut:
        bill = self.get_bill(bill_id)
        periods = self._periods(bill)
        next_period = self._next_period(bill, periods=periods)

        target_period_key = data.period_key or (next_period["period_key"] if next_period else None)
        if not target_period_key:
            raise HTTPException(status_code=400, detail="No billing period specified or available.")

        # Locate the targeted period in generated periods
        target_period = next((p for p in periods if p["period_key"] == target_period_key), None)
        if not target_period:
            raise HTTPException(status_code=400, detail=f"Invalid billing period key '{target_period_key}'.")

        # Sequence enforcement: cannot pay an advance period if an earlier period is unpaid
        earlier_unpaid = next((p for p in periods if not p["paid"] and p["period_key"] < target_period_key), None)
        if earlier_unpaid:
            raise HTTPException(
                status_code=409,
                detail=f"Please settle {earlier_unpaid['period_label']} before paying {target_period['period_label']}."
            )

        # Calculate remaining balance for this period
        period_payments = [p for p in bill.payments if p.period_key == target_period_key]
        current_paid = sum((p.amount for p in period_payments), Decimal("0.00"))
        existing_billed = max((p.billed_amount for p in period_payments if p.billed_amount is not None), default=None)

        if data.billed_amount is not None and data.billed_amount > Decimal("0.00"):
            period_billed = data.billed_amount
        elif existing_billed is not None and existing_billed > Decimal("0.00"):
            period_billed = existing_billed
        elif bill.amount and bill.amount > Decimal("0.00"):
            period_billed = bill.amount
        else:
            period_billed = data.amount

        if data.amount > period_billed:
            raise HTTPException(
                status_code=400,
                detail=f"Payment amount (₱{data.amount:,.2f}) cannot exceed the billed statement amount (₱{period_billed:,.2f})."
            )

        remaining = max(Decimal("0.00"), period_billed - current_paid)

        if current_paid > Decimal("0.00") and remaining <= Decimal("0.00"):
            raise HTTPException(
                status_code=400,
                detail=f"{target_period['period_label']} is already fully paid."
            )

        if data.amount > (remaining + Decimal("0.01")):
            raise HTTPException(
                status_code=400,
                detail=f"Payment amount (₱{data.amount:,.2f}) cannot exceed the remaining balance (₱{remaining:,.2f})."
            )

        # Record new payment transaction (independent row for installments and audit trail)
        payment = BillPayment(
            bill_id=bill_id,
            period_key=target_period_key,
            payment_date=data.payment_date,
            amount=data.amount,
            billed_amount=period_billed,
            payment_method=data.payment_method.strip(),
            reference_no=data.reference_no.strip() if data.reference_no else None,
            notes=data.notes.strip() if data.notes else None,
        )
        self.db.add(payment)

        try:
            self.db.commit()
        except Exception as exc:
            self.db.rollback()
            raise HTTPException(status_code=409, detail=f"Failed to record bill payment: {str(exc)}")

        system_cache.invalidate_tag("notifications")
        return self._to_output(self.get_bill(bill_id))

    def delete_payment(self, bill_id: int, payment_id: int) -> BillOut:
        payment = self.db.query(BillPayment).filter(
            BillPayment.bill_id == bill_id,
            BillPayment.bill_payment_id == payment_id,
        ).first()
        if not payment:
            raise HTTPException(status_code=404, detail="Bill payment not found.")
        self.db.delete(payment)
        self.db.commit()
        system_cache.invalidate_tag("notifications")
        return self._to_output(self.get_bill(bill_id))

    def delete_latest_payment(self, bill_id: int) -> BillOut:
        bill = self.get_bill(bill_id)
        payment = max(
            bill.payments,
            key=lambda item: (item.payment_date, item.bill_payment_id),
            default=None,
        )
        if not payment:
            raise HTTPException(status_code=404, detail="No bill payment found to undo.")
        self.db.delete(payment)
        self.db.commit()
        system_cache.invalidate_tag("notifications")
        return self._to_output(self.get_bill(bill_id))

    def get_stats(
        self,
        company_id: Optional[int] = None,
        company_name: Optional[str] = None,
        as_of: date = date.today(),
        company_ids: Optional[List[int]] = None,
    ) -> BillStatsOut:
        bills = self.list_bills(company_id=company_id, company_name=company_name, company_ids=company_ids)
        total_monthly_amount = Decimal("0.00")
        paid_amount = Decimal("0.00")
        paid_count = 0
        unpaid_amount = Decimal("0.00")
        unpaid_count = 0
        overdue_amount = Decimal("0.00")
        overdue_count = 0
        due_soon_amount = Decimal("0.00")
        due_soon_count = 0

        for b in bills:
            amount_to_count = b.latest_amount or b.amount or Decimal("0.00")
            total_monthly_amount += amount_to_count
            if b.status == "paid":
                paid_amount += amount_to_count
                paid_count += 1
            else:
                unpaid_amount += amount_to_count
                unpaid_count += 1
                if b.status == "overdue":
                    overdue_amount += amount_to_count
                    overdue_count += 1
                elif b.status == "due soon":
                    due_soon_amount += amount_to_count
                    due_soon_count += 1

        return BillStatsOut(
            total_monthly_amount=total_monthly_amount,
            total_bills_count=len(bills),
            paid_amount=paid_amount,
            paid_count=paid_count,
            unpaid_amount=unpaid_amount,
            unpaid_count=unpaid_count,
            overdue_amount=overdue_amount,
            overdue_count=overdue_count,
            due_soon_amount=due_soon_amount,
            due_soon_count=due_soon_count,
        )

    def get_reminders(
        self,
        company_id: Optional[int] = None,
        company_name: Optional[str] = None,
        as_of: date = date.today(),
        company_ids: Optional[List[int]] = None,
    ) -> List[BillReminderOut]:
        bills = self.list_bills(company_id=company_id, company_name=company_name, company_ids=company_ids)
        reminders = []

        for b in bills:
            if not b.next_period_date:
                continue
            due_date = b.next_period_date
            diff_days = (due_date - as_of).days

            if diff_days < 0:
                reminders.append(
                    BillReminderOut(
                        bill_id=b.bill_id,
                        bill_name=b.bill_name,
                        company=b.company or "",
                        type="overdue",
                        days_diff=abs(diff_days),
                        message=f"{b.bill_name} ({b.company}) was due on {due_date.isoformat()} ({abs(diff_days)} day{'s' if abs(diff_days) > 1 else ''} overdue)",
                        due_date=due_date,
                    )
                )
            elif diff_days == 0:
                reminders.append(
                    BillReminderOut(
                        bill_id=b.bill_id,
                        bill_name=b.bill_name,
                        company=b.company or "",
                        type="due_today",
                        days_diff=0,
                        message=f"{b.bill_name} ({b.company}) is due TODAY!",
                        due_date=due_date,
                    )
                )
            elif diff_days <= (b.due_date_reminder or 3):
                reminders.append(
                    BillReminderOut(
                        bill_id=b.bill_id,
                        bill_name=b.bill_name,
                        company=b.company or "",
                        type="due_soon",
                        days_diff=diff_days,
                        message=f"{b.bill_name} ({b.company}) is due in {diff_days} day{'s' if diff_days > 1 else ''} ({due_date.isoformat()})",
                        due_date=due_date,
                    )
                )

        reminders.sort(key=lambda r: (0 if r.type == "overdue" else 1 if r.type == "due_today" else 2, r.days_diff))
        return reminders
