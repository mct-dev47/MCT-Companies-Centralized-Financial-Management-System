from typing import List, Optional, Tuple
from decimal import Decimal
from datetime import datetime, date, timezone
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from app.models.bank import BankAccount, BankTransaction
from app.schemas.bank import BankAccountCreate, BankAccountUpdate, BankDepositWithdrawRequest


class BankService:
    def __init__(self, db: Session):
        self.db = db

    def seed_initial_accounts_if_empty(self):
        """No-op. Seeded dummy accounts removed so only real user-created accounts exist."""
        pass

    def purge_all_accounts(self):
        """Delete all bank transactions and all bank accounts from the database."""
        try:
            self.db.query(BankTransaction).delete()
            self.db.query(BankAccount).delete()
            self.db.commit()
        except Exception:
            self.db.rollback()

    def purge_dummy_data(self):
        """Purge all bank accounts and transactions to guarantee a pristine database."""
        self.purge_all_accounts()

    def list_accounts(self, company_name: Optional[str] = None, company_id: Optional[int] = None) -> List[BankAccount]:
        query = self.db.query(BankAccount)
        
        # 1. Direct company_id filter
        if company_id:
            from app.models.company import Company
            comp = self.db.query(Company).filter(Company.company_id == company_id).first()
            comp_name = comp.company_name.strip().lower() if comp else ""
            
            from app.core.company_resolver import COMPANY_ALIASES
            aliases = [comp_name] if comp_name else []
            for key, val_list in COMPANY_ALIASES.items():
                if comp_name == key or comp_name in val_list or key in comp_name:
                    aliases.append(key)
                    aliases.extend(val_list)
            aliases = [a for a in set(aliases) if a]

            conditions = [BankAccount.company_id == company_id]
            if aliases:
                conditions.extend([func.lower(BankAccount.company_name).contains(a) for a in aliases])
            query = query.filter(or_(*conditions))
            return query.order_by(BankAccount.id.asc()).all()

        # 2. Company name filter
        if company_name and company_name != "All Companies":
            normalized = company_name.strip().lower()
            from app.core.company_resolver import COMPANY_ALIASES, resolve_company
            aliases = [normalized]
            resolved_cid = None
            try:
                c = resolve_company(self.db, company_name=company_name)
                if c and c.company_id:
                    resolved_cid = c.company_id
                    aliases.append(c.company_name.strip().lower())
            except Exception:
                pass

            for key, val_list in COMPANY_ALIASES.items():
                if normalized == key or normalized in val_list or key in normalized:
                    aliases.append(key)
                    aliases.extend(val_list)
            aliases = [a for a in set(aliases) if a]

            conditions = [func.lower(BankAccount.company_name).contains(a) for a in aliases]
            if resolved_cid:
                conditions.append(BankAccount.company_id == resolved_cid)
            query = query.filter(or_(*conditions))
        return query.order_by(BankAccount.id.asc()).all()

    def get_account(self, account_id: str) -> Optional[BankAccount]:
        return self.db.query(BankAccount).filter(BankAccount.id == account_id).first()

    def delete_account(self, account_id: str) -> bool:
        account = self.get_account(account_id)
        if not account:
            return False
        try:
            self.db.delete(account)
            self.db.commit()
            return True
        except Exception:
            self.db.rollback()
            return False

    def _generate_account_id(self) -> str:
        count = self.db.query(BankAccount).count()
        num = count + 1
        candidate = f"bnk-{num:03d}"
        while self.db.query(BankAccount).filter(BankAccount.id == candidate).first():
            num += 1
            candidate = f"bnk-{num:03d}"
        return candidate

    def _generate_transaction_id(self) -> str:
        count = self.db.query(BankTransaction).count()
        num = count + 1
        candidate = f"tx-{num:04d}"
        while self.db.query(BankTransaction).filter(BankTransaction.id == candidate).first():
            num += 1
            candidate = f"tx-{num:04d}"
        return candidate

    def create_account(self, data: BankAccountCreate) -> BankAccount:
        # Idempotency check: prevent duplicate account creation within 10 seconds or identical unedited record
        bank_clean = data.bank_name.strip()
        acct_clean = data.account_name.strip()
        comp_clean = data.company_name.strip()
        start_bal = data.starting_balance or Decimal("0.00")

        existing_match = (
            self.db.query(BankAccount)
            .filter(
                func.lower(BankAccount.bank_name) == func.lower(bank_clean),
                func.lower(BankAccount.account_name) == func.lower(acct_clean),
                func.lower(BankAccount.company_name) == func.lower(comp_clean),
                BankAccount.starting_balance == start_bal,
            )
            .order_by(BankAccount.created_at.desc())
            .first()
        )
        if existing_match and existing_match.created_at:
            created_tz = existing_match.created_at
            if created_tz.tzinfo is None:
                created_tz = created_tz.replace(tzinfo=timezone.utc)
            elapsed = (datetime.now(timezone.utc) - created_tz).total_seconds()
            if elapsed < 10:
                return existing_match

        account_id = self._generate_account_id()
        num_suffix = account_id.replace("bnk-", "")
        acc_num = data.account_number.strip() if data.account_number and data.account_number.strip() else f"1092-4820-{num_suffix}"
        label = (data.card_label or data.account_name or data.company_name or "").strip()

        # Resolve company_id from input or company name
        resolved_cid = data.company_id
        if not resolved_cid:
            try:
                from app.core.company_resolver import resolve_company
                c = resolve_company(self.db, company_name=comp_clean)
                if c and c.company_id:
                    resolved_cid = c.company_id
            except Exception:
                pass

        account = BankAccount(
            id=account_id,
            bank_name=bank_clean,
            account_name=acct_clean,
            account_number=acc_num,
            company_name=comp_clean,
            company_id=resolved_cid,
            card_label=label,
            account_type=data.account_type or "Checking",
            branch=data.branch.strip() if data.branch else "Central Corporate Branch",
            starting_balance=start_bal,
            current_balance=start_bal,
            color_theme=data.color_theme or "red",
            notes=data.notes.strip() if data.notes else None,
        )
        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)
        return account

    def update_account(self, account_id: str, data: BankAccountUpdate) -> Optional[BankAccount]:
        account = self.get_account(account_id)
        if not account:
            return None

        if data.account_name is not None:
            account.account_name = data.account_name.strip()
        if data.branch is not None:
            account.branch = data.branch.strip()
        if data.notes is not None:
            account.notes = data.notes.strip()
        if data.color_theme is not None:
            account.color_theme = data.color_theme
        if data.card_label is not None:
            account.card_label = data.card_label

        self.db.commit()
        self.db.refresh(account)
        return account

    def deposit(self, account_id: str, data: BankDepositWithdrawRequest) -> Tuple[BankAccount, BankTransaction]:
        account = self.get_account(account_id)
        if not account:
            raise ValueError("Bank account not found.")

        amount = Decimal(str(data.amount))
        if amount <= Decimal("0.00"):
            raise ValueError("Deposit amount must be greater than zero.")

        tx_id = self._generate_transaction_id()
        tx_date = data.date or datetime.now().strftime("%m/%d/%y")
        tx_particulars = data.particulars or "Deposit Remittance"
        tx_category = data.category or "Bank Transfer"

        tx = BankTransaction(
            id=tx_id,
            bank_account_id=account.id,
            transaction_date=tx_date,
            cheque_no=data.reference_no,
            particulars=tx_particulars,
            withdrawal=Decimal("0.00"),
            deposit=amount,
            category=tx_category,
            net_amount=amount,
        )
        account.current_balance = account.current_balance + amount

        self.db.add(tx)
        self.db.commit()
        self.db.refresh(account)
        self.db.refresh(tx)
        return account, tx

    def withdraw(self, account_id: str, data: BankDepositWithdrawRequest) -> Tuple[BankAccount, BankTransaction]:
        account = self.get_account(account_id)
        if not account:
            raise ValueError("Bank account not found.")

        amount = Decimal(str(data.amount))
        if amount <= Decimal("0.00"):
            raise ValueError("Withdrawal amount must be greater than zero.")

        if amount > account.current_balance:
            raise ValueError(f"Insufficient bank funds. Available balance: ₱{account.current_balance:,.2f}")

        tx_id = self._generate_transaction_id()
        tx_date = data.date or datetime.now().strftime("%m/%d/%y")
        tx_particulars = data.particulars or "Withdrawal Settlement"
        tx_category = data.category or "Cheque"
        cheque_no = data.cheque_no or data.reference_no

        tx = BankTransaction(
            id=tx_id,
            bank_account_id=account.id,
            transaction_date=tx_date,
            cheque_no=cheque_no,
            particulars=tx_particulars,
            withdrawal=amount,
            deposit=Decimal("0.00"),
            category=tx_category,
            net_amount=amount,
        )
        account.current_balance = account.current_balance - amount

        self.db.add(tx)
        self.db.commit()
        self.db.refresh(account)
        self.db.refresh(tx)
        return account, tx

    def find_account_for_company(self, company_name: str) -> Optional[BankAccount]:
        if not company_name:
            return None
        norm = company_name.strip().lower()
        found = self.db.query(BankAccount).filter(func.lower(BankAccount.company_name).contains(norm)).first()
        if found:
            return found
        from app.services.bills_service import KNOWN_COMPANY_ALIASES
        aliases = []
        for key, val_list in KNOWN_COMPANY_ALIASES.items():
            if norm == key or norm in val_list or key in norm:
                aliases.append(key)
                aliases.extend(val_list)
        for a in set(aliases):
            found = self.db.query(BankAccount).filter(func.lower(BankAccount.company_name).contains(a)).first()
            if found:
                return found
        return None

    def record_deposit_by_account_id(self, account_id: str, amount: Decimal, particulars: str, reference_no: Optional[str] = None, tx_date: Optional[str] = None) -> Optional[BankTransaction]:
        account = self.get_account(account_id)
        if not account:
            return None
        req = BankDepositWithdrawRequest(
            amount=amount,
            date=tx_date or datetime.now().strftime("%m/%d/%y"),
            particulars=particulars or "Sales Cash Collection",
            category="Cash",
            reference_no=reference_no,
        )
        _, tx = self.deposit(account.id, req)
        return tx

    def record_withdrawal_by_account_id(self, account_id: str, amount: Decimal, particulars: str, cheque_no: Optional[str] = None, tx_date: Optional[str] = None) -> Optional[BankTransaction]:
        account = self.get_account(account_id)
        if not account:
            return None
        req = BankDepositWithdrawRequest(
            amount=amount,
            date=tx_date or datetime.now().strftime("%m/%d/%y"),
            particulars=particulars or "Expense Settlement",
            category="Cash",
            cheque_no=cheque_no,
        )
        try:
            _, tx = self.withdraw(account.id, req)
            return tx
        except ValueError:
            tx_id = self._generate_transaction_id()
            tx = BankTransaction(
                id=tx_id,
                bank_account_id=account.id,
                transaction_date=tx_date or datetime.now().strftime("%m/%d/%y"),
                cheque_no=cheque_no,
                particulars=particulars or "Expense Settlement",
                withdrawal=amount,
                deposit=Decimal("0.00"),
                category="Cash",
                net_amount=amount,
            )
            account.current_balance = account.current_balance - amount
            self.db.add(tx)
            self.db.commit()
            return tx

    def record_sale_cash_deposit(self, company_name: str, amount: Decimal, particulars: str, reference_no: Optional[str] = None, tx_date: Optional[str] = None) -> Optional[BankTransaction]:
        account = self.find_account_for_company(company_name)
        if not account:
            return None
        req = BankDepositWithdrawRequest(
            amount=amount,
            date=tx_date or datetime.now().strftime("%m/%d/%y"),
            particulars=particulars or "Sales Cash Collection",
            category="Cash",
            reference_no=reference_no,
        )
        _, tx = self.deposit(account.id, req)
        return tx

    def record_expense_cash_withdrawal(self, company_name: str, amount: Decimal, particulars: str, cheque_no: Optional[str] = None, tx_date: Optional[str] = None) -> Optional[BankTransaction]:
        account = self.find_account_for_company(company_name)
        if not account:
            return None
        req = BankDepositWithdrawRequest(
            amount=amount,
            date=tx_date or datetime.now().strftime("%m/%d/%y"),
            particulars=particulars or "Expense Settlement",
            category="Cash",
            cheque_no=cheque_no,
        )
        try:
            _, tx = self.withdraw(account.id, req)
            return tx
        except ValueError:
            tx_id = self._generate_transaction_id()
            tx = BankTransaction(
                id=tx_id,
                bank_account_id=account.id,
                transaction_date=tx_date or datetime.now().strftime("%m/%d/%y"),
                cheque_no=cheque_no,
                particulars=particulars or "Expense Settlement",
                withdrawal=amount,
                deposit=Decimal("0.00"),
                category="Cash",
                net_amount=amount,
            )
            account.current_balance = account.current_balance - amount
            self.db.add(tx)
            self.db.commit()
            return tx
