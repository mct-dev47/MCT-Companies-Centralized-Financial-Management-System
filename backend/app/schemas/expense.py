from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Optional
from datetime import date, datetime
from decimal import Decimal

class ExpenseBase(BaseModel):
    company_id: Optional[int] = None
    category_id: Optional[int] = None
    created_by: Optional[int] = None
    expense_date: date
    reference_no: Optional[str] = None
    cheque_no: Optional[str] = None
    amount: Decimal = Field(..., ge=1.0, decimal_places=2, description="Withdrawal amount must be at least 1.00 (cannot be negative or zero)")
    amount_paid: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    particulars: Optional[str] = Field(None, description="Particulars / description")
    description: Optional[str] = None

class ExpenseCreate(ExpenseBase):
    company: Optional[str] = None
    category: Optional[str] = None
    chequeNo: Optional[str] = None
    payment_method: Optional[str] = None
    bank_account_id: Optional[str] = None

    @model_validator(mode="after")
    def validate_required_fields(self):
        parts = self.particulars or self.description
        if not parts or not parts.strip():
            raise ValueError("Particulars is required and cannot be blank.")
        self.particulars = parts.strip()
        self.description = self.particulars

        if self.amount < Decimal("1.00"):
            raise ValueError("Withdrawal amount must be at least 1.00 (cannot be 0 or negative).")

        if self.expense_date > date.today():
            raise ValueError("Expense date cannot be in the future (maximum date is today).")

        if not self.company_id and not self.company:
            raise ValueError("Company identifier (company_id or company name) is required.")

        chq = self.cheque_no or self.chequeNo
        if chq and chq.strip():
            self.cheque_no = chq.strip()

        return self

class ExpenseUpdate(BaseModel):
    category_id: Optional[int] = None
    category: Optional[str] = None
    payment_method: Optional[str] = None
    expense_date: Optional[date] = None
    reference_no: Optional[str] = None
    cheque_no: Optional[str] = None
    chequeNo: Optional[str] = None
    amount: Optional[Decimal] = Field(None, ge=1.0, decimal_places=2)
    withdrawal: Optional[Decimal] = Field(None, ge=1.0, decimal_places=2)
    amount_paid: Optional[Decimal] = Field(None, ge=0, decimal_places=2)
    particulars: Optional[str] = None
    description: Optional[str] = None

    @model_validator(mode="after")
    def validate_update_fields(self):
        target_amt = self.amount if self.amount is not None else self.withdrawal
        if target_amt is not None:
            if target_amt < Decimal("1.00"):
                raise ValueError("Withdrawal amount must be at least 1.00 (cannot be 0 or negative).")
            self.amount = target_amt

        if self.expense_date is not None and self.expense_date > date.today():
            raise ValueError("Expense date cannot be in the future (maximum date is today).")

        chq = self.cheque_no or self.chequeNo
        if chq and chq.strip():
            self.cheque_no = chq.strip()

        parts = self.particulars or self.description
        if parts is not None:
            self.particulars = parts.strip()
            self.description = self.particulars

        return self

class ExpenseOut(BaseModel):
    expense_id: int
    company_id: Optional[int] = None
    company_name: Optional[str] = None
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    payment_method: Optional[str] = None
    created_by: Optional[int] = None
    expense_date: Optional[date] = None
    reference_no: Optional[str] = None
    cheque_no: Optional[str] = None
    amount: Decimal = Field(default=Decimal("0.00"))
    amount_paid: Optional[Decimal] = None
    unpaid_balance: Optional[Decimal] = None
    particulars: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    audit_status: str = "Pending Audit"
    audited_by: Optional[str] = None
    audited_at: Optional[datetime] = None
    audit_remarks: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

