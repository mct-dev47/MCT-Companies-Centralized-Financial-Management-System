import json
from typing import Dict, List, Optional, Tuple
from decimal import Decimal
from datetime import datetime, date, timezone
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from app.models.bank import BankAccount, BankTransaction
from app.schemas.bank import BankAccountCreate, BankAccountUpdate, BankDepositWithdrawRequest


def _clean_owners(primary: Optional[str], names: Optional[List[str]]) -> List[str]:
    """De-duplicated owner list (case-insensitive), primary owner first."""
    out: List[str] = []
    seen = set()
    for n in [primary] + list(names or []):
        n = (n or "").strip()
        if n and n.lower() not in seen:
            seen.add(n.lower())
            out.append(n)
    return out


class BankService:
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def resolve_tx_company(account: BankAccount, requested: Optional[str]) -> Optional[str]:
        """Which owner an entry on `account` belongs to: the requested owner when it matches, else the primary."""
        owners = account.company_names
        req = (requested or "").strip().lower()
        if req:
            for o in owners:
                ol = o.lower()
                if ol == req or ol in req or req in ol:
                    return o
        return owners[0] if owners else None

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
                conditions.extend([func.lower(BankAccount.company_names_json).contains(a) for a in aliases])
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
            conditions.extend([func.lower(BankAccount.company_names_json).contains(a) for a in aliases])
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
        owners = _clean_owners(data.company_name, data.company_names)
        comp_clean = owners[0] if owners else data.company_name.strip()
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
            company_names_json=json.dumps(owners) if len(owners) > 1 else None,
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
        if data.company_names is not None:
            owners = _clean_owners(None, data.company_names)
            if not owners:
                raise ValueError("A bank account needs at least one owner company.")
            removed = {o.lower() for o in account.company_names} - {o.lower() for o in owners}
            if removed:
                in_use = (
                    self.db.query(BankTransaction.id)
                    .filter(
                        BankTransaction.bank_account_id == account.id,
                        func.lower(BankTransaction.company_name).in_(removed),
                    )
                    .first()
                )
                if in_use:
                    raise ValueError("Cannot remove an owner company that already has transactions on this bank account.")
            account.company_name = owners[0]
            account.company_names_json = json.dumps(owners) if len(owners) > 1 else None
            try:
                from app.core.company_resolver import resolve_company
                c = resolve_company(self.db, company_name=owners[0])
                if c and c.company_id:
                    account.company_id = c.company_id
            except Exception:
                pass
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

    def deposit(self, account_id: str, data: BankDepositWithdrawRequest, source_sale_id: Optional[int] = None) -> Tuple[BankAccount, BankTransaction]:
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
            source_sale_id=source_sale_id,
            company_name=self.resolve_tx_company(account, data.company_name),
        )
        account.current_balance = account.current_balance + amount

        self.db.add(tx)
        self.db.commit()
        self.db.refresh(account)
        self.db.refresh(tx)
        return account, tx

    def withdraw(self, account_id: str, data: BankDepositWithdrawRequest, source_sale_id: Optional[int] = None) -> Tuple[BankAccount, BankTransaction]:
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
            source_sale_id=source_sale_id,
            company_name=self.resolve_tx_company(account, data.company_name),
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
        found = (
            self.db.query(BankAccount)
            .filter(or_(
                func.lower(BankAccount.company_name).contains(norm),
                func.lower(BankAccount.company_names_json).contains(norm),
            ))
            .first()
        )
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

    def record_deposit_by_account_id(self, account_id: str, amount: Decimal, particulars: str, reference_no: Optional[str] = None, tx_date: Optional[str] = None, source_sale_id: Optional[int] = None) -> Optional[BankTransaction]:
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
        _, tx = self.deposit(account.id, req, source_sale_id=source_sale_id)
        return tx

    def record_withdrawal_by_account_id(self, account_id: str, amount: Decimal, particulars: str, cheque_no: Optional[str] = None, tx_date: Optional[str] = None, source_sale_id: Optional[int] = None) -> Optional[BankTransaction]:
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
            _, tx = self.withdraw(account.id, req, source_sale_id=source_sale_id)
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
                source_sale_id=source_sale_id,
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

    def _post_linked_entry(
        self,
        account: BankAccount,
        *,
        link_attr: str,
        link_id: int,
        is_deposit: bool,
        amount: Decimal,
        particulars: str,
        reference_no: Optional[str],
        tx_date: Optional[str],
        is_reversal: bool = False,
        company_name: Optional[str] = None,
    ) -> BankTransaction:
        """Add one bank entry linked to its source record and move the account balance with it."""
        label = particulars or "Bank entry"
        tx = BankTransaction(
            company_name=self.resolve_tx_company(account, company_name),
            id=self._generate_transaction_id(),
            bank_account_id=account.id,
            transaction_date=tx_date or datetime.now().strftime("%m/%d/%y"),
            cheque_no=reference_no,
            particulars=f"Reversal: {label}" if is_reversal else label,
            withdrawal=Decimal("0.00") if is_deposit else amount,
            deposit=amount if is_deposit else Decimal("0.00"),
            category="Cash",
            net_amount=amount,
        )
        setattr(tx, link_attr, link_id)
        account.current_balance = account.current_balance + (amount if is_deposit else -amount)
        self.db.add(tx)
        self.db.flush()
        return tx

    def _sync_linked_entries(
        self,
        *,
        link_attr: str,
        link_id: int,
        credit: bool,
        target_amount: Decimal,
        company_name: Optional[str],
        account_id: Optional[str],
        particulars: Optional[str],
        reference_no: Optional[str],
        tx_date: Optional[str],
        linked: List[BankTransaction],
    ) -> Optional[BankTransaction]:
        """
        Make the bank net for one record equal `target_amount`, on the record's OWN bank account.
        `credit=True` is a sale (money in), `credit=False` an expense (money out). Only the difference
        is posted, so the bank always equals what the Transactions ledger counts for the record.
        If entries sit on a different account than the record's bank, they are moved over.
        """
        target = Decimal(str(target_amount or 0)).quantize(Decimal("0.01"))
        sign = Decimal("1") if credit else Decimal("-1")

        def recognized(t: BankTransaction) -> Decimal:
            return (Decimal(str(t.deposit or 0)) - Decimal(str(t.withdrawal or 0))) * sign

        # Which account should hold this record: its own bank, else where it already is, else the company's
        account = self.get_account(account_id) if account_id else None
        if not account and linked:
            account = self.get_account(linked[0].bank_account_id)
        if not account and company_name:
            account = self.find_account_for_company(company_name)
        if not account:
            self.db.commit()
            return None

        # Move anything recorded on another account: offset it there, count it here instead
        by_account: Dict[str, Decimal] = {}
        for t in linked:
            by_account[t.bank_account_id] = by_account.get(t.bank_account_id, Decimal("0")) + recognized(t)
        for other_id, net in by_account.items():
            if other_id == account.id or net == Decimal("0.00"):
                continue
            other = self.get_account(other_id)
            if other is None:
                continue
            # Entries that recognized `net` there are undone by posting the opposite direction
            undo_as_deposit = (net < 0) if credit else (net > 0)
            self._post_linked_entry(
                other,
                link_attr=link_attr,
                link_id=link_id,
                is_deposit=undo_as_deposit,
                amount=abs(net),
                particulars=particulars or "Bank entry",
                reference_no=reference_no,
                tx_date=tx_date,
                is_reversal=True,
                company_name=next((t.company_name for t in linked if t.bank_account_id == other_id and t.company_name), None),
            )

        current = sum((recognized(t) for t in linked if t.bank_account_id == account.id), Decimal("0.00"))
        delta = (target - current).quantize(Decimal("0.01"))
        tx = None
        if delta != Decimal("0.00"):
            more = delta > 0
            tx = self._post_linked_entry(
                account,
                link_attr=link_attr,
                link_id=link_id,
                is_deposit=(more if credit else not more),
                amount=abs(delta),
                particulars=particulars or "Bank entry",
                reference_no=reference_no,
                tx_date=tx_date,
                is_reversal=not more,
                company_name=company_name or next((t.company_name for t in linked if t.bank_account_id == account.id and t.company_name), None),
            )
        self.db.commit()
        if tx is not None:
            self.db.refresh(tx)
        return tx

    def purge_linked_entries(self, *, link_attr: str, link_id: int) -> int:
        """
        Delete every bank entry linked to a deleted sale/expense (`source_sale_id` / `source_expense_id`).
        Each account's balance is corrected by the net of the entries removed, so balances stay right
        even if the offsetting reversal was never posted. Returns how many entries were removed.
        """
        if link_attr not in ("source_sale_id", "source_expense_id"):
            raise ValueError("Unsupported link attribute.")
        linked = self.db.query(BankTransaction).filter(getattr(BankTransaction, link_attr) == link_id).all()
        if not linked:
            return 0
        net_by_account: Dict[str, Decimal] = {}
        for t in linked:
            net = Decimal(str(t.deposit or 0)) - Decimal(str(t.withdrawal or 0))
            net_by_account[t.bank_account_id] = net_by_account.get(t.bank_account_id, Decimal("0")) + net
        for account_id, net in net_by_account.items():
            account = self.get_account(account_id)
            if account is not None and net != Decimal("0"):
                account.current_balance = account.current_balance - net
        for t in linked:
            self.db.delete(t)
        self.db.commit()
        return len(linked)

    def sync_sale_deposit(
        self,
        sale_id: int,
        target_amount: Decimal,
        company_name: Optional[str] = None,
        account_id: Optional[str] = None,
        particulars: Optional[str] = None,
        reference_no: Optional[str] = None,
        tx_date: Optional[str] = None,
        legacy_particulars: Optional[str] = None,
    ) -> Optional[BankTransaction]:
        """
        Make the bank net for one sale equal `target_amount` (the cash the ledger counts:
        the paid amount while the sale is Deposited, otherwise 0), on the sale's own bank.
        """
        linked = self.db.query(BankTransaction).filter(BankTransaction.source_sale_id == sale_id).all()

        # Adopt an older unlinked credit for this sale (made before linking existed), so it is not doubled.
        if not linked and legacy_particulars:
            legacy = (
                self.db.query(BankTransaction)
                .filter(
                    BankTransaction.source_sale_id.is_(None),
                    BankTransaction.category == "Cash",
                    BankTransaction.deposit > 0,
                    BankTransaction.particulars == f"Sales Collection: {legacy_particulars}",
                )
                .order_by(BankTransaction.created_at.desc())
                .first()
            )
            if legacy:
                legacy.source_sale_id = sale_id
                linked = [legacy]

        return self._sync_linked_entries(
            link_attr="source_sale_id",
            link_id=sale_id,
            credit=True,
            target_amount=target_amount,
            company_name=company_name,
            account_id=account_id,
            particulars=particulars or "Sales Collection",
            reference_no=reference_no,
            tx_date=tx_date,
            linked=linked,
        )

    def sync_expense_disbursement(
        self,
        expense_id: int,
        target_amount: Decimal,
        company_name: Optional[str] = None,
        account_id: Optional[str] = None,
        particulars: Optional[str] = None,
        reference_no: Optional[str] = None,
        tx_date: Optional[str] = None,
        legacy_particulars: Optional[str] = None,
    ) -> Optional[BankTransaction]:
        """
        Make the bank net for one expense equal `target_amount` (only the PAID part leaves the bank;
        Pending and Unpaid lines do not), on the expense's own bank.
        """
        linked = self.db.query(BankTransaction).filter(BankTransaction.source_expense_id == expense_id).all()

        # Adopt an older unlinked disbursement for this expense (made before linking existed).
        if not linked and legacy_particulars:
            legacy = (
                self.db.query(BankTransaction)
                .filter(
                    BankTransaction.source_expense_id.is_(None),
                    BankTransaction.source_sale_id.is_(None),
                    BankTransaction.withdrawal > 0,
                    BankTransaction.particulars == f"Expense Disbursement: {legacy_particulars}",
                )
                .order_by(BankTransaction.created_at.desc())
                .first()
            )
            if legacy:
                legacy.source_expense_id = expense_id
                linked = [legacy]

        return self._sync_linked_entries(
            link_attr="source_expense_id",
            link_id=expense_id,
            credit=False,
            target_amount=target_amount,
            company_name=company_name,
            account_id=account_id,
            particulars=particulars or "Expense Disbursement",
            reference_no=reference_no,
            tx_date=tx_date,
            linked=linked,
        )

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
