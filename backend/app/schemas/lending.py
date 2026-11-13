from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field
from decimal import Decimal
from app.schemas.base import StrictBaseModel


class LendingCalculateRequest(StrictBaseModel):
    principal: Decimal = Field(..., ge=1.0)
    interest_rate: Decimal = Field(default=Decimal("20.00"), ge=0.0)
    payment_frequency: str = Field(default="Daily", max_length=50)
    term_days: Optional[int] = Field(default=40, ge=1)
    date_borrowed: Optional[str] = Field(None, max_length=50)
    due_date: Optional[str] = Field("", max_length=50)


class LendingCalculateResponse(BaseModel):
    principal: float
    interest_rate: float
    interest: float
    total_payable: float
    frequency: str
    cycle_count: int
    installment_target: float
    term_days: int = 40
    penalty_rate: float = 5.0
    penalty_per_cycle: float = 0.0
    date_borrowed: str
    due_date: str


class BorrowerCreateRequest(StrictBaseModel):
    borrower_name: str = Field(..., min_length=1, max_length=200)
    borrower_contact: Optional[str] = Field("", max_length=100)
    borrower_address: Optional[str] = Field("", max_length=500)
    loan_amount: Decimal = Field(..., ge=1.0)
    interest_rate: Decimal = Field(default=Decimal("20.00"), ge=0.0)
    payment_frequency: str = Field(default="Daily", max_length=50)
    term_days: Optional[int] = Field(default=40, ge=1)
    date_borrowed: Optional[str] = Field(None, max_length=50)
    due_date: Optional[str] = Field("", max_length=50)
    notes: Optional[str] = Field("", max_length=1000)
    # Bank the loan is released from (Expense) and repayments go to (Sales) - spec 0045
    bank_account_id: Optional[str] = Field(None, max_length=100)


class BorrowerUpdateRequest(StrictBaseModel):
    borrower_name: Optional[str] = Field(None, max_length=200)
    borrower_contact: Optional[str] = Field(None, max_length=100)
    borrower_address: Optional[str] = Field(None, max_length=500)
    loan_amount: Optional[Decimal] = None
    interest_rate: Optional[Decimal] = None
    payment_frequency: Optional[str] = Field(None, max_length=50)
    term_days: Optional[int] = Field(None, ge=1)
    date_borrowed: Optional[str] = Field(None, max_length=50)
    due_date: Optional[str] = Field(None, max_length=50)
    status: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = Field(None, max_length=1000)
    bank_account_id: Optional[str] = Field(None, max_length=100)


class BorrowerDeleteResponse(BaseModel):
    success: bool = True
    message: str = "Borrower deleted successfully."


class LendingPaymentCreateRequest(StrictBaseModel):
    borrower_id: int
    payment_date: str = Field(..., max_length=50)
    cycle_due_date: Optional[str] = Field(None, max_length=50)
    cycle_index: Optional[int] = None
    amount: Decimal = Field(..., ge=1.0)
    penalty_amount: Optional[Decimal] = Field(default=Decimal("0.00"), ge=0.0)
    method: str = Field(default="Cash", max_length=50)
    reference_no: Optional[str] = Field("", max_length=100)
    notes: Optional[str] = Field(default="", max_length=500)
    recorded_by: Optional[str] = Field(None, max_length=150)


class LendingPaymentUpdateRequest(StrictBaseModel):
    payment_date: Optional[str] = Field(None, max_length=50)
    cycle_due_date: Optional[str] = Field(None, max_length=50)
    cycle_index: Optional[int] = None
    amount: Optional[Decimal] = Field(default=None, ge=1.0)
    penalty_amount: Optional[Decimal] = Field(default=None, ge=0.0)
    method: Optional[str] = Field(None, max_length=50)
    reference_no: Optional[str] = Field("", max_length=100)
    notes: Optional[str] = Field(default="", max_length=500)
    recorded_by: Optional[str] = Field(None, max_length=150)


class LendingTransactionCreateRequest(StrictBaseModel):
    borrower_id: int
    payment_date: str = Field(..., max_length=50)
    cycle_due_date: Optional[str] = Field(None, max_length=50)
    cycle_index: Optional[int] = None
    amount: Decimal = Field(..., ge=0.01)
    penalty_amount: Optional[Decimal] = Field(default=None, ge=0.0)
    penalty_portion: Optional[Decimal] = Field(default=None, ge=0.0)
    payment_method: str = Field(default="Cash", max_length=50)
    transaction_type: str = Field(default="Repayment", max_length=50)
    reference_no: Optional[str] = Field("", max_length=100)
    notes: Optional[str] = Field(default="", max_length=500)
    recorded_by: Optional[str] = Field(None, max_length=150)


class LendingTransactionOut(BaseModel):
    transaction_id: int
    borrower_id: int
    transaction_ref_no: Optional[str] = None
    transaction_type: str = "Repayment"
    payment_date: str
    due_date: Optional[str] = None
    cycle_index: Optional[int] = None
    cycle_due_date: Optional[str] = None
    is_late: bool = False
    days_late: int = 0
    amount: float
    penalty_portion: float = 0.0
    remaining_balance: Optional[float] = None
    payment_method: str = "Cash"
    reference_no: Optional[str] = "-"
    status: str = "Completed"
    notes: Optional[str] = "-"
    recorded_by: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class DailyPaymentRecordOut(BaseModel):
    id: str
    transaction_ref_no: Optional[str] = None
    transactionRefNo: Optional[str] = None
    date: str
    amount: float
    method: str
    referenceNo: Optional[str] = "-"
    notes: Optional[str] = "-"
    status: str
    timestamp: str
    isLocked: Optional[bool] = False
    penalty: Optional[float] = 0.0
    cycle_index: Optional[int] = None
    cycle_due_date: Optional[str] = None
    is_late: Optional[bool] = False
    days_late: Optional[int] = 0
    recorded_by: Optional[str] = None
    recordedBy: Optional[str] = None


class BorrowerOut(BaseModel):
    id: str
    borrower_id: int
    borrower_ref_no: Optional[str] = None
    borrowerRefNo: Optional[str] = None
    loanId: int
    loanRefNo: str
    borrowerName: str
    borrowerContact: Optional[str] = ""
    borrowerAddress: Optional[str] = ""
    loanAmount: float
    interestRate: float
    interestAmount: float
    totalAmountPayable: float
    amountPaid: float
    remainingBalance: float
    dateBorrowed: str
    dueDate: str
    status: str
    paymentFrequency: str
    termDays: int = 40
    penaltyRate: float = 5.0
    penaltyPerCycle: float = 0.0
    totalPenalties: float = 0.0
    advanceAmount: float = 0.0
    installmentTarget: float = 0.0
    complianceStatus: str = "Compliant"
    missedCyclesCount: int = 0
    notes: Optional[str] = ""
    bankAccountId: Optional[str] = None
    releaseExpenseId: Optional[int] = None
    audit_status: Optional[str] = "Pending Audit"
    auditStatus: Optional[str] = None
    audited_by: Optional[str] = None
    auditedBy: Optional[str] = None
    audited_at: Optional[str] = None
    auditedAt: Optional[str] = None
    auditDate: Optional[str] = None
    audit_remarks: Optional[str] = None
    auditRemarks: Optional[str] = None
    dailyPayments: List[Dict[str, Any]] = []

    model_config = ConfigDict(from_attributes=True)


class LendingLedgerResponse(BaseModel):
    borrower_id: str
    borrower_ref_no: str
    loan_ref_no: str
    borrower_name: str
    borrower_contact: Optional[str] = ""
    borrower_address: Optional[str] = ""
    payment_frequency: str
    principal: float
    interest_rate: float
    total_payable: float
    amount_paid: float
    remaining_balance: float
    date_borrowed: str
    due_date: str
    term_days: int = 40
    penalty_rate: float = 5.0
    penalty_per_cycle: float = 0.0
    total_penalties: float = 0.0
    advance_amount: float = 0.0
    installment_target: float = 0.0
    compliance_status: str = "Compliant"
    missed_cycles_count: int = 0
    ledger_items: List[Dict[str, Any]]
    monthly_progress: Optional[Dict[str, Any]] = None
    next_installment: Optional[Dict[str, Any]] = None

