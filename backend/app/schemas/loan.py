from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List
from datetime import date, datetime
from decimal import Decimal

# --- Loan Repayment ---
class LoanRepaymentBase(BaseModel):
    loan_id: int
    recorded_by: Optional[int] = None
    payment_date: date
    due_date: Optional[date] = None
    bank_account_id: Optional[str] = Field(None, description="Chosen source bank account ID")
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    reference_no: Optional[str] = None
    status: str = Field(default="completed", description="pending, completed, overdue")
    received_at: Optional[datetime] = None
    notes: Optional[str] = None

class LoanRepaymentCreate(LoanRepaymentBase):
    pass

class LoanRepaymentOut(LoanRepaymentBase):
    loan_repayment_id: int
    remaining_balance: Decimal
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

# --- Loan ---
class LoanBase(BaseModel):
    borrower: Optional[int] = Field(None, description="Company_ID of borrower")
    lender: Optional[int] = Field(None, description="Company_ID of lender")
    borrower_name: Optional[str] = None
    lender_name: Optional[str] = None
    loan_ref_no: Optional[str] = None
    bank_account_id: Optional[str] = None
    principal_amount: Decimal = Field(..., ge=1.0, decimal_places=2, description="Principal amount must be at least 1.00 (cannot be 0 or letters)")
    interest_rate: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2, description="Interest percentage e.g. 5.00 for 5%")
    interest_type: str = Field(default="simple", description="simple or compound")
    loan_date: date
    due_date: Optional[date] = None
    description: Optional[str] = None
    particulars: Optional[str] = None
    status: str = Field(default="Pending Finance Endorsement", description="Pending Finance Endorsement, Pending Audit Approval, Approved, Paid, Overdue, Rejected")

class LoanCreate(LoanBase):
    borrower_company: Optional[str] = None
    lender_company: Optional[str] = None

    def validate_companies(self):
        if self.borrower and self.lender and self.borrower == self.lender:
            raise ValueError("Borrower and lender cannot be the same company.")

class LoanUpdate(BaseModel):
    borrower: Optional[int] = None
    lender: Optional[int] = None
    borrower_company: Optional[str] = None
    lender_company: Optional[str] = None
    loan_ref_no: Optional[str] = None
    principal_amount: Optional[Decimal] = Field(None, ge=1.0, decimal_places=2)
    amount: Optional[Decimal] = Field(None, ge=1.0, decimal_places=2)
    interest_rate: Optional[Decimal] = Field(None, ge=0, decimal_places=2)
    interest_type: Optional[str] = None
    loan_date: Optional[date] = None
    due_date: Optional[date] = None
    description: Optional[str] = None
    particulars: Optional[str] = None
    status: Optional[str] = None

class LoanApproveRequest(BaseModel):
    lender: Optional[int] = Field(None, description="Company_ID of assigned lender")
    lender_company: Optional[str] = Field(None, description="Company name of assigned lender")
    interest_rate: Optional[Decimal] = Field(None, ge=0, decimal_places=2, description="Interest rate percentage")
    due_date: Optional[date] = None
    notes: Optional[str] = None

class LoanEndorseRequest(BaseModel):
    action: str = Field(default="endorse", description="endorse or reject")
    bank_account_id: Optional[str] = Field(None, description="Funding bank account ID chosen by Finance")
    lender: Optional[int] = Field(None, description="Company_ID of assigned lender")
    lender_company: Optional[str] = Field(None, description="Company name of assigned lender")
    interest_rate: Optional[Decimal] = Field(None, ge=0, decimal_places=2, description="Interest rate percentage")
    due_date: Optional[date] = None
    remark: str = Field(..., min_length=1, description="Finance endorsement or rejection remark")

class LoanAuditReviewRequest(BaseModel):
    action: str = Field(..., description="approve or disapprove")
    remark: str = Field(..., min_length=1, description="Audit review remark is required")

class LoanOut(LoanBase):
    loan_id: int
    borrower: int
    lender: Optional[int] = None
    amount: Optional[Decimal] = None
    borrower_name: Optional[str] = None
    lender_name: Optional[str] = None
    endorsed_by: Optional[str] = None
    endorsed_at: Optional[datetime] = None
    finance_remark: Optional[str] = None
    audit_reviewed_by: Optional[str] = None
    audit_reviewed_at: Optional[datetime] = None
    audit_remark: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class LoanStatementOut(BaseModel):
    loan_id: int
    borrower: int
    lender: int
    principal_amount: Decimal
    interest_rate: Decimal
    interest_type: str
    interest_amount: Decimal
    total_loan_payable: Decimal
    total_amount_repaid: Decimal
    current_remaining_balance: Decimal
    status: str
    repayments: List[LoanRepaymentOut] = []


class CompanyLoanOut(LoanOut):
    category: str
    total_paid: Decimal
    outstanding_balance: Decimal
    payment_status: str
    interest_display: str


class CompanyLoanGroupOut(BaseModel):
    borrower: int
    lender: Optional[int] = None
    borrower_name: str
    lender_name: str
    category: str
    total_loan_amount: Decimal
    total_paid: Decimal
    outstanding_balance: Decimal
    interest_display: str
    payment_status: str
    loan_count: int
    loans: List[CompanyLoanOut]


class CompanyLoanListOut(BaseModel):
    items: List[CompanyLoanGroupOut]
    total: int
    offset: int
    limit: int
