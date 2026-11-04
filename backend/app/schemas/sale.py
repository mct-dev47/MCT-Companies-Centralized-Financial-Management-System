from pydantic import BaseModel, ConfigDict, Field, model_validator
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

        if self.amount < Decimal("1.00"):
            raise ValueError("Amount must be at least 1.00 (cannot be 0 or less than 1).")

        if self.transaction_date > date.today():
            raise ValueError("Transaction date cannot be in the future (maximum date is today).")

        if not self.company_id and not self.company:
            raise ValueError("Company identifier (company_id or company name) is required.")

        chq = self.cheque_no or self.chequeNo
        if chq and chq.strip():
            self.cheque_no = chq.strip()

        return self

class SaleUpdate(BaseModel):
    category_id: Optional[int] = None
    category: Optional[str] = None
    payment_method: Optional[str] = None
    transaction_date: Optional[date] = None
    cheque_no: Optional[str] = None
    chequeNo: Optional[str] = None
    amount: Optional[Decimal] = Field(None, ge=1.0, decimal_places=2)
    particulars: Optional[str] = None
    description: Optional[str] = None

    @model_validator(mode="after")
    def validate_update_fields(self):
        if self.amount is not None and self.amount < Decimal("1.00"):
            raise ValueError("Amount must be at least 1.00 (cannot be 0 or less than 1).")
        if self.transaction_date is not None and self.transaction_date > date.today():
            raise ValueError("Transaction date cannot be in the future (maximum date is today).")
        return self

class SaleOut(BaseModel):
    sales_id: int
    company_id: int
    company_name: Optional[str] = None
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    payment_method: Optional[str] = None
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

    model_config = ConfigDict(from_attributes=True)


