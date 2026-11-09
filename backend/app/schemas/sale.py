from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator
from typing import Optional
from datetime import date, datetime
from decimal import Decimal

class SaleBase(BaseModel):
    company_id: Optional[int] = None
    category_id: Optional[int] = None
    transaction_date: date
    cheque_no: Optional[str] = None
    amount: Decimal = Field(..., ge=1.0, decimal_places=2, description="Amount must be at least 1.00 (cannot be 0 or less than 1)")
    particulars: Optional[str] = Field(None, description="Particulars / description")
    payment_status: Optional[str] = Field("Paid", description="Payment status: Paid, Pending, Unpaid")
    deposit_status: Optional[str] = Field(None, description="Deposit status: Deposited, Not Deposited")
    remarks: Optional[str] = Field(None, description="Operational remarks by supervisor/finance")

    @field_validator('amount', mode='before')
    @classmethod
    def round_amount(cls, v):
        if v is not None:
            try:
                return Decimal(str(round(float(v), 2)))
            except Exception:
                return v
        return v

    @field_validator('transaction_date', mode='before')
    @classmethod
    def parse_transaction_date(cls, v):
        if isinstance(v, str) and '/' in v:
            parts = v.strip().split('/')
            if len(parts) == 3:
                m, d, y = parts
                if len(y) == 2:
                    y = '20' + y
                return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
        return v

class SaleCreate(SaleBase):
    company: Optional[str] = None
    category: Optional[str] = None
    chequeNo: Optional[str] = None
    reference_no: Optional[str] = None
    description: Optional[str] = None
    payment_method: Optional[str] = None
    bank_account_id: Optional[str] = None

    @model_validator(mode="after")
    def validate_required_fields(self):
        parts = self.particulars or self.description
        if not parts or not parts.strip():
            raise ValueError("Particulars is required and cannot be blank.")
        self.particulars = parts.strip()

        if not self.category_id and (not self.category or not self.category.strip()):
            raise ValueError("Category is required and cannot be blank.")
        if self.category and self.category.strip():
            self.category = self.category.strip()

        if self.amount < Decimal("1.00"):
            raise ValueError("Amount must be at least 1.00 (cannot be 0 or less than 1).")

        if self.transaction_date > date.today():
            raise ValueError("Transaction date cannot be in the future (maximum date is today).")

        if not self.company_id and not self.company:
            raise ValueError("Company identifier (company_id or company name) is required.")

        chq = self.cheque_no or self.chequeNo
        if chq and chq.strip():
            self.cheque_no = chq.strip()

        # Payment status normalization & validation
        raw_ps = (self.payment_status or "Paid").strip()
        ps_lower = raw_ps.lower()
        if ps_lower == "paid":
            self.payment_status = "Paid"
        elif ps_lower == "pending":
            self.payment_status = "Pending"
        elif ps_lower == "unpaid":
            self.payment_status = "Unpaid"
        else:
            raise ValueError("Payment status must be 'Paid', 'Pending', or 'Unpaid'.")

        # Deposit status default logic (AC-1)
        raw_ds = (self.deposit_status or "").strip()
        if not raw_ds:
            if self.payment_status == "Paid":
                self.deposit_status = "Deposited"
            else:
                self.deposit_status = "Not Deposited"
        else:
            ds_lower = raw_ds.lower()
            if ds_lower in ("deposited", "deposit"):
                self.deposit_status = "Deposited"
            elif ds_lower in ("not deposited", "not_deposited", "notdeposited"):
                self.deposit_status = "Not Deposited"
            else:
                raise ValueError("Deposit status must be either 'Deposited' or 'Not Deposited'.")

        # Business validation matrix (AC-2, AC-3, AC-4)
        if self.payment_status == "Unpaid" and self.deposit_status == "Deposited":
            raise ValueError("Unpaid sales cannot be marked as deposited. Please mark payment status as Paid first.")

        if self.payment_status == "Pending" and self.deposit_status == "Deposited":
            pm = (self.payment_method or "").strip().lower()
            has_chq = bool(self.cheque_no and self.cheque_no.strip())
            if pm != "cheque" or not has_chq:
                raise ValueError(
                    "Pending sales cannot be marked as deposited unless the payment method is Cheque and physically deposited awaiting clearance."
                )

        return self

class SaleUpdate(BaseModel):
    category_id: Optional[int] = None
    category: Optional[str] = None
    payment_method: Optional[str] = None
    payment_status: Optional[str] = None
    deposit_status: Optional[str] = None
    transaction_date: Optional[date] = None
    cheque_no: Optional[str] = None
    chequeNo: Optional[str] = None
    amount: Optional[Decimal] = Field(None, ge=1.0, decimal_places=2)
    particulars: Optional[str] = None
    description: Optional[str] = None
    remarks: Optional[str] = None

    @field_validator('amount', mode='before')
    @classmethod
    def round_update_amount(cls, v):
        if v is not None:
            try:
                return Decimal(str(round(float(v), 2)))
            except Exception:
                return v
        return v

    @field_validator('transaction_date', mode='before')
    @classmethod
    def parse_update_transaction_date(cls, v):
        if isinstance(v, str) and '/' in v:
            parts = v.strip().split('/')
            if len(parts) == 3:
                m, d, y = parts
                if len(y) == 2:
                    y = '20' + y
                return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
        return v

    @model_validator(mode="after")
    def validate_update_fields(self):
        if self.amount is not None and self.amount < Decimal("1.00"):
            raise ValueError("Amount must be at least 1.00 (cannot be 0 or less than 1).")
        if self.transaction_date is not None and self.transaction_date > date.today():
            raise ValueError("Transaction date cannot be in the future (maximum date is today).")
        parts = self.particulars or self.description
        if parts is not None:
            if not parts.strip():
                raise ValueError("Particulars cannot be blank.")
            self.particulars = parts.strip()
        if self.category is not None and not self.category.strip():
            raise ValueError("Category cannot be blank.")

        if self.payment_status is not None:
            raw_ps = self.payment_status.strip().lower()
            if raw_ps == "paid":
                self.payment_status = "Paid"
            elif raw_ps == "pending":
                self.payment_status = "Pending"
            elif raw_ps == "unpaid":
                self.payment_status = "Unpaid"
            else:
                raise ValueError("Payment status must be 'Paid', 'Pending', or 'Unpaid'.")

        if self.deposit_status is not None:
            raw_ds = self.deposit_status.strip().lower()
            if raw_ds in ("deposited", "deposit"):
                self.deposit_status = "Deposited"
            elif raw_ds in ("not deposited", "not_deposited", "notdeposited"):
                self.deposit_status = "Not Deposited"
            else:
                raise ValueError("Deposit status must be either 'Deposited' or 'Not Deposited'.")

        if self.payment_status == "Unpaid" and self.deposit_status == "Deposited":
            raise ValueError("Unpaid sales cannot be marked as deposited. Please mark payment status as Paid first.")

        if self.payment_status == "Pending" and self.deposit_status == "Deposited":
            pm = (self.payment_method or "").strip().lower()
            chq = (self.cheque_no or self.chequeNo or "").strip()
            if pm != "cheque" or not chq:
                raise ValueError(
                    "Pending sales cannot be marked as deposited unless the payment method is Cheque and physically deposited awaiting clearance."
                )

        return self

class RemarksUpdate(BaseModel):
    remarks: Optional[str] = None


class DepositStatusUpdate(BaseModel):
    deposit_status: str

    @field_validator("deposit_status")
    @classmethod
    def validate_deposit_status_value(cls, v: str) -> str:
        raw = (v or "").strip().lower()
        if raw in ("deposited", "deposit"):
            return "Deposited"
        elif raw in ("not deposited", "not_deposited", "notdeposited"):
            return "Not Deposited"
        raise ValueError("Deposit status must be either 'Deposited' or 'Not Deposited'.")

class SaleOut(BaseModel):
    sales_id: int
    company_id: int
    company_name: Optional[str] = None
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    payment_method: Optional[str] = None
    payment_status: str = "Paid"
    deposit_status: str = "Not Deposited"
    transaction_date: date
    cheque_no: Optional[str] = None
    amount: Decimal
    particulars: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    audit_status: str = "Pending Audit"
    audited_by: Optional[str] = None
    audited_at: Optional[datetime] = None
    audit_remarks: Optional[str] = None
    remarks: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class DailySalesSummaryOut(BaseModel):
    date: date
    day_of_week: str
    transaction_count: int
    gross_total: Decimal = Field(default=Decimal("0.00"))
    realized_cash: Decimal = Field(default=Decimal("0.00"))
    audit_status: str = "Pending Audit"

    model_config = ConfigDict(from_attributes=True)



