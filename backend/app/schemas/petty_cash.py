from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas.base import StrictBaseModel


class PettyCashTopUpCreate(StrictBaseModel):
    company_id: Optional[int] = None
    company: Optional[str] = Field(None, min_length=1, max_length=100)
    company_name: Optional[str] = Field(None, min_length=1, max_length=100)
    amount: Decimal = Field(..., ge=0, decimal_places=2)
    topup_date: date
    reference_no: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    status: Optional[str] = Field("Pending Finance Endorsement", max_length=100)
    created_by: Optional[int] = None
    bank_account_id: Optional[str] = Field(None, max_length=100)
    finance_remark: Optional[str] = Field(None, max_length=1000)
    endorsement_remark: Optional[str] = Field(None, max_length=1000)
    request_type: Optional[str] = Field("topup", max_length=50)
    paid_by: Optional[str] = Field(None, max_length=100)
    receipt_url: Optional[str] = Field(None, max_length=2048)
    attachments: Optional[str] = Field(None, max_length=2048)
    items: Optional[str] = Field(None, max_length=4000)
    category: Optional[str] = Field(None, max_length=100)
    total_expenses: Optional[Decimal] = Field(None, decimal_places=2)
    company_funded_amount: Optional[Decimal] = Field(Decimal("0.00"), decimal_places=2)
    employee_out_of_pocket: Optional[Decimal] = Field(Decimal("0.00"), decimal_places=2)
    existing_expense_id: Optional[int] = None

    @model_validator(mode="after")
    def validate_fields(self):
        if not self.company_id and not self.company and not self.company_name:
            raise ValueError("Company identifier (company_id or company name) is required.")
        if self.topup_date > date.today():
            raise ValueError("Top-up date cannot be in the future.")

        req_type = (self.request_type or "topup").lower()
        if req_type == "reimbursement":
            if self.total_expenses is not None:
                if self.total_expenses <= Decimal("0.00"):
                    raise ValueError("Total business expenses must be greater than zero.")
                c_amount = self.company_funded_amount or Decimal("0.00")
                if c_amount < Decimal("0.00"):
                    raise ValueError("Company funded amount cannot be negative.")
                if c_amount > self.total_expenses:
                    raise ValueError("Company funded amount cannot exceed total expenses.")
                self.employee_out_of_pocket = self.total_expenses - c_amount
                self.amount = self.employee_out_of_pocket
        else:
            if self.amount < Decimal("1.00"):
                raise ValueError("Top-up amount must be at least 1.00.")
        return self


class PettyCashTopUpUpdate(StrictBaseModel):
    amount: Optional[Decimal] = Field(None, ge=0, decimal_places=2)
    description: Optional[str] = Field(None, max_length=1000)
    paid_by: Optional[str] = Field(None, max_length=100)
    receipt_url: Optional[str] = Field(None, max_length=2048)
    attachments: Optional[str] = Field(None, max_length=2048)
    items: Optional[str] = Field(None, max_length=4000)
    category: Optional[str] = Field(None, max_length=100)
    total_expenses: Optional[Decimal] = Field(None, decimal_places=2)
    company_funded_amount: Optional[Decimal] = Field(None, decimal_places=2)
    employee_out_of_pocket: Optional[Decimal] = Field(None, decimal_places=2)
    existing_expense_id: Optional[int] = None


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
    total_expenses: Optional[Decimal] = None
    company_funded_amount: Optional[Decimal] = Decimal("0.00")
    employee_out_of_pocket: Optional[Decimal] = Decimal("0.00")
    reserved_amount: Optional[Decimal] = Decimal("0.00")
    amount_reimbursed: Decimal = Decimal("0.00")
    existing_expense_id: Optional[int] = None
    petty_cash_expense_id: Optional[int] = None
    reimbursement_expense_id: Optional[int] = None
    payment_method_option: Optional[str] = None
    destination_bank_id: Optional[str] = None
    intercompany_transfer_id: Optional[int] = None
    reimbursed_at: Optional[datetime] = None
    reimbursed_by: Optional[str] = None
    transfer_received_at: Optional[datetime] = None
    transfer_received_by: Optional[str] = None
    destination_bank_name: Optional[str] = None
    funding_bank_name: Optional[str] = None
    transfer_status: Optional[str] = None
    settlement_status: Optional[str] = None


class PettyCashEndorseIn(BaseModel):
    action: Literal["endorse", "reject"]
    remark: str = Field(..., min_length=1, description="A remark is required when endorsing or rejecting.")
    bank_account_id: Optional[str] = Field(
        None, description="Funding bank account chosen by Finance; required when action is 'endorse' (spec 0012)."
    )
    payment_method_option: Optional[Literal["direct", "transfer_first"]] = Field(
        None, description="Required for cross company bank funding: direct or transfer_first."
    )
    destination_bank_id: Optional[str] = Field(
        None, description="Destination bank account of requesting company; required for transfer_first."
    )


class FinalizeSettlementIn(BaseModel):
    notes: Optional[str] = None


class TransferCancelIn(BaseModel):
    reason: str = Field(..., min_length=1, description="Reason for cancelling the in-transit transfer.")


class TransferReversalConfirmIn(BaseModel):
    verification_notes: Optional[str] = None


class IntercompanySettleIn(BaseModel):
    source_bank_id: str = Field(..., min_length=1, description="Company A repayment bank account")
    destination_bank_id: str = Field(..., min_length=1, description="Company B receiving bank account")
    notes: Optional[str] = None


class IntercompanyTransferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    transfer_id: int
    source_company_id: int
    destination_company_id: int
    source_bank_id: str
    destination_bank_id: Optional[str] = None
    source_bank_tx_id: Optional[str] = None
    destination_bank_tx_id: Optional[str] = None
    reversal_bank_tx_id: Optional[str] = None
    repayment_source_bank_tx_id: Optional[str] = None
    repayment_destination_bank_tx_id: Optional[str] = None
    linked_topup_id: Optional[int] = None
    amount: Decimal
    transfer_type: str
    reference_no: str
    transfer_status: str
    settlement_status: str
    initiated_by: str
    initiated_at: datetime
    received_by: Optional[str] = None
    received_at: Optional[datetime] = None
    settled_at: Optional[datetime] = None
    repaid_by: Optional[str] = None
    notes: Optional[str] = None
    source_company_name: Optional[str] = None
    destination_company_name: Optional[str] = None
    source_bank_name: Optional[str] = None
    destination_bank_name: Optional[str] = None


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
    """One petty cash top-up or reimbursement shown on the Transaction page ledger (spec 0013 & spec 0038).

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
    request_type: Optional[str] = "topup"
    paid_by: Optional[str] = None
    category: Optional[str] = None
    total_expenses: Optional[Decimal] = None
    company_funded_amount: Optional[Decimal] = None
    employee_out_of_pocket: Optional[Decimal] = None
    amount_reimbursed: Optional[Decimal] = None
    endorsed_by: Optional[str] = None
    endorsed_at: Optional[datetime] = None
    finance_remark: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    remark: Optional[str] = None
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    reimbursed_by: Optional[str] = None
    reimbursed_at: Optional[datetime] = None
    transfer_received_by: Optional[str] = None
    transfer_received_at: Optional[datetime] = None
    items: Optional[str] = None
    attachments: Optional[str] = None
    receipt_url: Optional[str] = None



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
    total_expenses: Optional[Decimal] = None
    company_funded_amount: Optional[Decimal] = Decimal("0.00")
    employee_out_of_pocket: Optional[Decimal] = Decimal("0.00")
    existing_expense_id: Optional[int] = None
    payment_method_option: Optional[str] = None
    destination_bank_id: Optional[str] = None
    destination_bank_name: Optional[str] = None
    intercompany_transfer_id: Optional[int] = None
    transfer_status: Optional[str] = None
    settlement_status: Optional[str] = None
    reimbursed_at: Optional[datetime] = None
    reimbursed_by: Optional[str] = None
    transfer_received_at: Optional[datetime] = None
    transfer_received_by: Optional[str] = None


class PettyCashCategoryCreate(StrictBaseModel):
    company_id: Optional[int] = None
    company_name: Optional[str] = Field(None, max_length=150)
    name: str = Field(..., min_length=1, max_length=100)


class PettyCashCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    category_id: int
    company_id: int
    name: str
    created_at: Optional[datetime] = None


class ReceiptUploadOut(BaseModel):
    url: str
    filename: Optional[str] = None
    file_name: Optional[str] = None
    file_size: int
    mime_type: str
    content_type: str

