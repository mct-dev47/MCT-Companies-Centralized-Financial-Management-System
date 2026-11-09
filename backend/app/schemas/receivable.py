from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas.base import StrictBaseModel


def _coerce_bank_account_id(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


class ReceivablePaymentBase(StrictBaseModel):
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    payment_date: Optional[date] = None
    payment_method: str = Field(default="Cash", max_length=50)
    bank_account_id: Optional[str] = Field(None, max_length=100)
    reference_no: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=1000)
    received_by: Optional[str] = Field(None, max_length=100)

    @model_validator(mode="before")
    @classmethod
    def coerce_bank_id(cls, data: Any) -> Any:
        if isinstance(data, dict) and "bank_account_id" in data:
            data = dict(data)
            data["bank_account_id"] = _coerce_bank_account_id(data.get("bank_account_id"))
        return data


class ReceivablePaymentCreate(ReceivablePaymentBase):
    date: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def resolve_date(cls, data: Any) -> Any:
        if isinstance(data, dict):
            data = dict(data)
            if "bank_account_id" in data:
                data["bank_account_id"] = _coerce_bank_account_id(data.get("bank_account_id"))
            if not data.get("payment_date") and data.get("date"):
                try:
                    data["payment_date"] = date.fromisoformat(str(data["date"])[:10])
                except Exception:
                    pass
            if not data.get("payment_date"):
                data["payment_date"] = date.today()
        return data


class ReceivablePaymentOut(ReceivablePaymentBase):
    payment_id: int
    receivable_id: int
    payment_date: date
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True, extra="ignore")


class ReceivableBase(StrictBaseModel):
    customer_name: str = Field(..., min_length=1, max_length=255)
    customer_type: str = Field(default="External", max_length=50)
    company_id: Optional[int] = None
    company_name: Optional[str] = Field(None, max_length=255)
    sale_id: Optional[int] = None
    sale_line_index: Optional[int] = Field(None, ge=0)
    expense_id: Optional[int] = None
    transaction_date: Optional[date] = None
    items_summary: str = Field(..., min_length=1, max_length=1000)
    total_amount: Decimal = Field(..., ge=0, decimal_places=2)
    notes: Optional[str] = None


class ReceivableCreate(ReceivableBase):
    amount_paid: Optional[Decimal] = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    payment_option: Optional[str] = Field(None, description="'Paid in full', 'Partial', or 'Pay Later'")
    payment_method: Optional[str] = Field(None, max_length=50)
    bank_account_id: Optional[str] = Field(None, max_length=100)
    date: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def normalize_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            data = dict(data)
            if "bank_account_id" in data:
                data["bank_account_id"] = _coerce_bank_account_id(data.get("bank_account_id"))
            if not data.get("transaction_date") and data.get("date"):
                try:
                    data["transaction_date"] = date.fromisoformat(str(data["date"])[:10])
                except Exception:
                    pass
            if not data.get("transaction_date"):
                data["transaction_date"] = date.today()
            if "customer_type" in data and isinstance(data["customer_type"], str):
                ct = data["customer_type"].strip().lower()
                if ct in ("internal", "staff"):
                    data["customer_type"] = "Internal"
                else:
                    data["customer_type"] = "External"
        return data


class ReceivableUpdate(StrictBaseModel):
    customer_name: Optional[str] = Field(None, min_length=1, max_length=255)
    customer_type: Optional[str] = Field(None, max_length=50)
    transaction_date: Optional[date] = None
    items_summary: Optional[str] = Field(None, min_length=1, max_length=1000)
    total_amount: Optional[Decimal] = Field(None, ge=0, decimal_places=2)
    payment_status: Optional[str] = Field(None, max_length=50)
    payment_method: Optional[str] = Field(None, max_length=50)
    bank_account_id: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=1000)

    @model_validator(mode="before")
    @classmethod
    def normalize_update_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            data = dict(data)
            if "bank_account_id" in data:
                data["bank_account_id"] = _coerce_bank_account_id(data.get("bank_account_id"))
            if not data.get("transaction_date") and data.get("date"):
                try:
                    data["transaction_date"] = date.fromisoformat(str(data["date"])[:10])
                except Exception:
                    pass
            if "customer_type" in data and isinstance(data["customer_type"], str):
                ct = data["customer_type"].strip().lower()
                if ct in ("internal", "staff"):
                    data["customer_type"] = "Internal"
                else:
                    data["customer_type"] = "External"
            if "payment_status" in data and isinstance(data["payment_status"], str):
                ps = data["payment_status"].strip().lower()
                if ps == "paid":
                    data["payment_status"] = "Paid"
                elif ps == "partial":
                    data["payment_status"] = "Partial"
                elif ps == "unpaid":
                    data["payment_status"] = "Unpaid"
        return data


class ReceivableOut(ReceivableBase):
    receivable_id: int
    company_id: int
    company_name: str
    transaction_date: date
    amount_paid: Decimal
    balance: Decimal
    payment_status: str
    is_locked: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    payments: List[ReceivablePaymentOut] = []

    model_config = ConfigDict(from_attributes=True, extra="ignore")


class ReceivablesKPIsOut(BaseModel):
    totalSales: Decimal
    cashCollected: Decimal
    totalOutstanding: Decimal
    totalExternalUtang: Decimal
    totalStaffUtang: Decimal
    externalDebtorCount: int
    staffDebtorCount: int
    totalPeopleCount: int


class PayrollDeductionRequest(StrictBaseModel):
    customer_name: str = Field(..., min_length=1, max_length=255)
    company_id: Optional[int] = None
    notes: Optional[str] = Field(None, max_length=1000)


class PayrollSettlementOut(BaseModel):
    success: bool = True
    customer_name: str
    total_deducted: float
    settled_orders_count: int
    message: str


class DebtorBatchUpdate(StrictBaseModel):
    current_customer_name: str = Field(..., min_length=1, max_length=255)
    company_id: Optional[int] = None
    company_name: Optional[str] = Field(None, max_length=255)
    new_customer_name: Optional[str] = Field(None, min_length=1, max_length=255)
    customer_type: Optional[str] = Field(None, max_length=50)

    @model_validator(mode="before")
    @classmethod
    def normalize_debtor_type(cls, data: Any) -> Any:
        if isinstance(data, dict):
            data = dict(data)
            if not data.get("current_customer_name") and data.get("old_customer_name"):
                data["current_customer_name"] = data["old_customer_name"]
            if "customer_type" in data and isinstance(data["customer_type"], str):
                ct = data["customer_type"].strip().lower()
                data["customer_type"] = "Internal" if ct in ("internal", "staff") else "External"
        return data


class DebtorBatchUpdateOut(BaseModel):
    updated_count: int


class DebtorBatchDelete(StrictBaseModel):
    customer_name: str = Field(..., min_length=1, max_length=255)
    company_id: Optional[int] = None
    company_name: Optional[str] = Field(None, max_length=255)


class DebtorBatchDeleteOut(BaseModel):
    deleted_count: int
