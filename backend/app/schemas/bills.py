from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Optional, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas.base import StrictBaseModel


class BillBase(StrictBaseModel):
    company_id: Optional[int] = None
    company: Optional[str] = Field(None, min_length=1, max_length=100)
    bill_name: str = Field(..., min_length=1, max_length=255)
    category: Optional[str] = Field(None, max_length=100)
    frequency: Optional[str] = Field(None, max_length=50)
    is_recurring: Optional[bool] = None
    amount: Optional[Decimal] = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    recurring: Literal["daily", "monthly", "yearly", "one-time"] = Field(
        default="monthly",
        description="daily, monthly, yearly, or one-time",
    )
    due_date: date
    due_date_reminder: int = Field(
        default=3,
        ge=0,
        description="Number of days before the due date to send a reminder",
    )
    notes: Optional[str] = Field(None, max_length=1000)
    status: Literal["unpaid", "paid", "overdue", "due soon", "partially paid"] = Field(
        default="unpaid",
        description="unpaid, paid, overdue, due soon, or partially paid",
    )

    @model_validator(mode="before")
    @classmethod
    def populate_bill_name(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "bill_name" not in data:
                if "vendor_name" in data:
                    data["bill_name"] = data.pop("vendor_name")
                elif "name" in data:
                    data["bill_name"] = data.pop("name")
            else:
                data.pop("vendor_name", None)
                data.pop("name", None)
            if "status" in data and isinstance(data["status"], str):
                s = data["status"].strip().lower()
                if s in ("due", "pending", "unpaid"):
                    data["status"] = "unpaid"
                elif s in ("paid", "overdue", "due soon", "partially paid"):
                    data["status"] = s
            if "recurring" in data and isinstance(data["recurring"], str):
                r = data["recurring"].strip().lower()
                if r in ("one-time", "once", "onetime", "one_time"):
                    data["recurring"] = "one-time"
                elif r in ("daily", "monthly", "yearly"):
                    data["recurring"] = r
            if "frequency" in data and ("recurring" not in data or not data.get("recurring")):
                freq = str(data["frequency"]).strip().lower()
                if freq in ("one-time", "once", "onetime", "one_time"):
                    data["recurring"] = "one-time"
                elif freq in ("daily", "monthly", "yearly"):
                    data["recurring"] = freq
        return data


class BillCreate(BillBase):
    pass


class BillUpdate(StrictBaseModel):
    company_id: Optional[int] = None
    company: Optional[str] = Field(None, min_length=1, max_length=100)
    bill_name: Optional[str] = Field(None, min_length=1, max_length=255)
    amount: Optional[Decimal] = Field(None, ge=0, decimal_places=2)
    recurring: Optional[Literal["daily", "monthly", "yearly", "one-time"]] = None
    due_date: Optional[date] = None
    due_date_reminder: Optional[int] = Field(None, ge=0)
    notes: Optional[str] = Field(None, max_length=1000)


class BillPaymentCreate(StrictBaseModel):
    period_key: Optional[str] = Field(None, max_length=50)
    payment_date: date
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    billed_amount: Optional[Decimal] = Field(None, ge=0, decimal_places=2)
    payment_method: str = Field(..., min_length=1, max_length=50)
    reference_no: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=1000)


class BillPaymentOut(BillPaymentCreate):
    bill_payment_id: int
    bill_id: int
    created_at: Optional[datetime] = None

    @property
    def payment_id(self) -> int:
        return self.bill_payment_id

    model_config = ConfigDict(from_attributes=True, extra="ignore")


class BillPeriodOut(BaseModel):
    period_key: str
    period_label: str
    period_date: date
    paid: bool
    partially_paid: bool = False
    billed_amount: Optional[Decimal] = None
    paid_amount: Decimal = Decimal("0.00")
    remaining_amount: Decimal = Decimal("0.00")
    payment_date: Optional[date] = None
    is_future: bool = False
    is_next_payable: bool = False
    payments: List[BillPaymentOut] = []

    model_config = ConfigDict(from_attributes=True)


class BillOut(BillBase):
    bill_id: int
    latest_amount: Optional[Decimal] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    payments: List[BillPaymentOut] = []

    model_config = ConfigDict(from_attributes=True, extra="ignore")
    next_period_key: Optional[str] = None
    next_period_label: Optional[str] = None
    next_period_date: Optional[date] = None
    periods: Optional[List[BillPeriodOut]] = None

    @property
    def payment_history(self) -> List[BillPaymentOut]:
        return self.payments

    model_config = ConfigDict(from_attributes=True)


class BillScheduleOut(BaseModel):
    bill_id: int
    recurring: str
    periods: List[BillPeriodOut]
    next_period_key: Optional[str] = None
    next_period_label: Optional[str] = None


class BillStatsOut(BaseModel):
    total_monthly_amount: Decimal = Decimal("0.00")
    total_bills_count: int = 0
    paid_amount: Decimal = Decimal("0.00")
    paid_count: int = 0
    unpaid_amount: Decimal = Decimal("0.00")
    unpaid_count: int = 0
    overdue_amount: Decimal = Decimal("0.00")
    overdue_count: int = 0
    due_soon_amount: Decimal = Decimal("0.00")
    due_soon_count: int = 0


class BillReminderOut(BaseModel):
    bill_id: int
    bill_name: str
    company: str
    type: Literal["overdue", "due_today", "due_soon"]
    days_diff: int
    message: str
    due_date: date


BillOut.model_rebuild()
BillScheduleOut.model_rebuild()
