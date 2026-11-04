from typing import List, Optional
from pydantic import BaseModel, ConfigDict
from decimal import Decimal
from datetime import datetime

class BankTransactionBase(BaseModel):
    transaction_date: str
    cheque_no: Optional[str] = None
    particulars: str
    withdrawal: Optional[Decimal] = Decimal("0.00")
    deposit: Optional[Decimal] = Decimal("0.00")
    category: str = "Bank Transfer"
    net_amount: Decimal = Decimal("0.00")


class BankTransactionCreate(BankTransactionBase):
    pass


class BankTransactionOut(BankTransactionBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    bank_account_id: str
    created_at: Optional[datetime] = None


class BankAccountBase(BaseModel):
    bank_name: str
    account_name: str
    account_number: Optional[str] = None
    company_name: str
    company_id: Optional[int] = None
    card_label: Optional[str] = None
    account_type: str = "Checking"
    branch: Optional[str] = "Central Corporate Branch"
    starting_balance: Decimal = Decimal("0.00")
    color_theme: str = "red"
    notes: Optional[str] = None


class BankAccountCreate(BankAccountBase):
    pass


class BankAccountUpdate(BaseModel):
    bank_name: Optional[str] = None
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    company_name: Optional[str] = None
    company_id: Optional[int] = None
    card_label: Optional[str] = None
    account_type: Optional[str] = None
    branch: Optional[str] = None
    color_theme: Optional[str] = None
    notes: Optional[str] = None


class BankDepositWithdrawRequest(BaseModel):
    amount: Decimal
    date: Optional[str] = None
    particulars: Optional[str] = None
    category: Optional[str] = None
    cheque_no: Optional[str] = None
    reference_no: Optional[str] = None


class BankAccountOut(BankAccountBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    current_balance: Decimal
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    transactions: List[BankTransactionOut] = []
