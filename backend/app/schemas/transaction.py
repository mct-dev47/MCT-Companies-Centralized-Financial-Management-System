from typing import List, Optional
from pydantic import BaseModel, Field


class TransactionOut(BaseModel):
    id: str
    refNo: str
    chequeNo: Optional[str] = ""
    date: str  # YYYY-MM-DD
    type: str  # 'Sales', 'Expense', 'Loan', 'Income', 'Petty Cash', 'Bank'
    company: str
    description: str
    particulars: str
    amount: float
    withdrawal: float
    deposit: float
    category: str
    paymentMethod: Optional[str] = None
    status: str = "Paid"  # 'Paid', 'Pending', 'Overdue', etc.
    auditStatus: str = "Pending Audit"  # 'Pending Audit', 'Verified', 'Flagged'
    auditedBy: Optional[str] = None
    auditNotes: Optional[str] = None
    auditDate: Optional[str] = None
    createdBy: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None
    attachments: List[str] = Field(default_factory=list)
    paidAmount: Optional[float] = None
    bankAccountId: Optional[str] = None
    bankName: Optional[str] = None
    remarks: Optional[str] = None
    sourceModule: Optional[str] = None
    depositStatus: Optional[str] = None
    depositDate: Optional[str] = None
    saleDate: Optional[str] = None
    awaitingAudit: Optional[bool] = False
    isMirrorRow: Optional[bool] = False
