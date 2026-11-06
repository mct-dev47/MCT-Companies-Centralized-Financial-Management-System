from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PettyCashTopUpCreate(BaseModel):
    company_id: Optional[int] = None
    company: Optional[str] = Field(None, min_length=1, max_length=100)
    company_name: Optional[str] = Field(None, min_length=1, max_length=100)
    amount: Decimal = Field(..., ge=1, decimal_places=2)
    topup_date: date
    reference_no: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    status: Optional[str] = "Pending Finance Endorsement"
    created_by: Optional[int] = None
    bank_account_id: Optional[str] = None
    finance_remark: Optional[str] = None
    endorsement_remark: Optional[str] = None
    request_type: Optional[str] = "topup"
    paid_by: Optional[str] = None
    receipt_url: Optional[str] = None
    attachments: Optional[str] = None
    items: Optional[str] = None
    category: Optional[str] = None

    @model_validator(mode="after")
    def validate_fields(self):
        if not self.company_id and not self.company and not self.company_name:
            raise ValueError("Company identifier (company_id or company name) is required.")
        if self.topup_date > date.today():
            raise ValueError("Top-up date cannot be in the future.")
        return self


class PettyCashTopUpUpdate(BaseModel):
    amount: Optional[Decimal] = Field(None, ge=1, decimal_places=2)
    description: Optional[str] = None
    paid_by: Optional[str] = None
    receipt_url: Optional[str] = None
    attachments: Optional[str] = None
    items: Optional[str] = None
    category: Optional[str] = None


class PettyCashTopUpOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    topup_id: int
    company_id: int
    company_name: Optional[str] = None
    amount: Decimal
    topup_date: date
    reference_no: Optional[str] = None
    description: Optional[str] = None
    bank_account_id: Optional[str] = None
    status: str = "Pending Finance Endorsement"
    request_type: Optional[str] = "topup"
    paid_by: Optional[str] = None
    receipt_url: Optional[str] = None
    attachments: Optional[str] = None
    items: Optional[str] = None
    category: Optional[str] = None
    endorsed_by: Optional[str] = None
    endorsed_at: Optional[datetime] = None
    finance_remark: Optional[str] = None
    remark: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None


class PettyCashEndorseIn(BaseModel):
    action: Literal["endorse", "reject"]
    remark: str = Field(..., min_length=1, description="A remark is required when endorsing or rejecting.")
    bank_account_id: Optional[str] = Field(
        None, description="Funding bank account chosen by Finance; required when action is 'endorse' (spec 0012)."
    )


class PettyCashReviewIn(BaseModel):
    action: Literal["approve", "disapprove"]
    remark: str = Field(..., min_length=1, description="A remark is required when approving or disapproving.")


class PettyCashWalletUpdate(BaseModel):
    low_balance_threshold: Decimal = Field(..., ge=0, decimal_places=2)


class PettyCashSummaryOut(BaseModel):
    company_id: int
    company_name: str
    balance: Decimal
    total_topups: Decimal
    total_spent: Decimal
    period_topups: Decimal
    period_spent: Decimal
    low_balance_threshold: Decimal
    is_low: bool


class PettyCashMovementOut(BaseModel):
    """One petty cash top-up shown on the Transaction page ledger (spec 0013).

    Carries both sides of the money: the requesting company and the company that owns the
    funding bank, so the page can show a Deposit for one and a Withdrawal for the other.
    """

    topup_id: int
    reference_no: Optional[str] = None
    topup_date: date
    amount: Decimal
    description: Optional[str] = None
    status: str
    company_id: int
    company_name: Optional[str] = None
    funding_company_id: Optional[int] = None
    funding_company_name: Optional[str] = None
    is_own_account: bool = False
    created_at: Optional[datetime] = None


class PettyCashLedgerEntry(BaseModel):
    entry_id: str
    entry_type: Literal["topup", "expense", "request"]
    record_id: int
    company_id: Optional[int] = None
    company_name: Optional[str] = None
    entry_date: date
    description: str
    category: Optional[str] = None
    reference_no: Optional[str] = None
    amount_requested: Decimal = Decimal("0.00")
    amount_in: Decimal
    amount_out: Decimal
    running_balance: Decimal
    status: Optional[str] = "Approved"
    request_type: Optional[str] = "topup"
    paid_by: Optional[str] = None
    receipt_url: Optional[str] = None
    attachments: Optional[str] = None
    items: Optional[str] = None
    endorsed_by: Optional[str] = None
    endorsed_at: Optional[datetime] = None
    finance_remark: Optional[str] = None
    remark: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    # Funding bank chosen by Finance (spec 0012), shown to the reader (spec 0014).
    # The account number is deliberately not included.
    funding_bank_id: Optional[str] = None
    funding_bank_name: Optional[str] = None
    funding_account_name: Optional[str] = None
    funding_company_name: Optional[str] = None
    is_own_account: bool = False
