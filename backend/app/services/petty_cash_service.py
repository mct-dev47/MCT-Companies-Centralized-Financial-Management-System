import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.cache import system_cache
from app.core.dependencies import AuthenticatedUser
from app.core.websocket import ws_manager
from app.db.supabase import get_supabase_admin_client
from app.models.bank import BankAccount
from app.models.company import Company
from app.models.finance import Category, Expense
from app.models.intercompany_transfer import IntercompanyTransfer
from app.models.petty_cash import PettyCashTopUp, PettyCashWallet
from app.schemas.bank import BankDepositWithdrawRequest
from app.services.bank_service import BankService
from app.schemas.petty_cash import (
    IntercompanyTransferOut,
    PettyCashLedgerEntry,
    PettyCashMovementOut,
    PettyCashSummaryOut,
    PettyCashTopUpCreate,
    PettyCashTopUpOut,
)
from app.services.bills_service import _resolve_company


PETTY_CASH_METHOD = "petty cash"

LEDGER_MOVEMENT_STATUSES = {"pending audit approval", "approved"}
DEFAULT_LOW_BALANCE_THRESHOLD = Decimal("1000.00")
ZERO = Decimal("0.00")


def is_petty_cash(payment_method: Optional[str] = None, category_name: Optional[str] = None) -> bool:
    pm = (payment_method or "").strip().lower()
    cat = (category_name or "").strip().lower()
    return "petty cash" in pm or "petty cash" in cat


def _to_decimal(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _to_date(value) -> Optional[date]:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _in_period(day: Optional[date], start: Optional[date], end: Optional[date]) -> bool:
    if day is None:
        return False
    if start and day < start:
        return False
    if end and day > end:
        return False
    return True


class PettyCashService:
    """
    Petty cash wallet per company.

    """

    def __init__(self, db: Session):
        self.db = db

    # ── Data sources ─────────────────────────────────────────────────────────

    def _petty_cash_expenses(self, company_id: Optional[int] = None) -> List[dict]:
        """Expenses paid from petty cash or categorized as Petty Cash. Supabase first, local DB as fallback."""
        try:
            client = get_supabase_admin_client()
            cat_map: Dict[int, str] = {}
            petty_cat_ids = []
            try:
                categories = client.table("category").select("category_id, name").execute().data or []
                for c in categories:
                    cat_map[c["category_id"]] = c["name"]
                    if "petty cash" in (c.get("name") or "").strip().lower():
                        petty_cat_ids.append(c["category_id"])
            except Exception:
                pass

            query = (
                client.table("expenses")
                .select("expense_id, company_id, category_id, expense_date, amount, description, reference_no, payment_method, created_at")
            )
            if company_id:
                query = query.eq("company_id", company_id)

            if petty_cat_ids:
                cat_filter = f"category_id.in.({','.join(str(x) for x in petty_cat_ids)})"
                query = query.or_(f"payment_method.ilike.%petty cash%,{cat_filter}")
            else:
                query = query.ilike("payment_method", "%petty cash%")

            rows = query.execute().data or []
            # Exclude any sample or seeded rows
            rows = [r for r in rows if not (r.get("reference_no") or "").upper().startswith("SEED-") and not (r.get("reference_no") or "").upper().startswith("REIMB-")]

            return [
                {
                    "expense_id": row["expense_id"],
                    "company_id": row.get("company_id"),
                    "expense_date": _to_date(row.get("expense_date")),
                    "amount": _to_decimal(row.get("amount")),
                    "description": row.get("description") or "",
                    "category": cat_map.get(row.get("category_id")) or "Petty Cash",
                    "reference_no": row.get("reference_no"),
                    "created_at": row.get("created_at"),
                }
                for row in rows
            ]
        except Exception:
            from sqlalchemy import or_
            query = (
                self.db.query(Expense, Category.name)
                .outerjoin(Category, Expense.category_id == Category.category_id)
                .filter(
                    or_(
                        func.lower(func.trim(func.coalesce(Expense.payment_method, ""))).like("%petty cash%"),
                        func.lower(func.trim(func.coalesce(Category.name, ""))) == "petty cash",
                    )
                )
            )
            if company_id:
                query = query.filter(Expense.company_id == company_id)
            query = query.filter((~Expense.reference_no.like("SEED-%") & ~Expense.reference_no.like("REIMB-%")) | (Expense.reference_no == None))
            return [
                {
                    "expense_id": exp.expense_id,
                    "company_id": exp.company_id,
                    "expense_date": exp.expense_date,
                    "amount": _to_decimal(exp.amount),
                    "description": exp.description or "",
                    "category": cat_name or "Petty Cash",
                    "reference_no": exp.reference_no,
                    "created_at": exp.created_at,
                }
                for exp, cat_name in query.all()
            ]

    def _topups(self, company_id: Optional[int] = None) -> List[PettyCashTopUp]:
        query = self.db.query(PettyCashTopUp).filter(
            ~PettyCashTopUp.reference_no.like("SEED-%") | (PettyCashTopUp.reference_no == None)
        )
        if company_id:
            query = query.filter(PettyCashTopUp.company_id == company_id)
        return query.all()

    def _threshold(self, company_id: int) -> Decimal:
        wallet = self.db.query(PettyCashWallet).filter(PettyCashWallet.company_id == company_id).first()
        return _to_decimal(wallet.low_balance_threshold) if wallet else DEFAULT_LOW_BALANCE_THRESHOLD

    # ── Balance & summaries ──────────────────────────────────────────────────

    def resolve_company(self, company_id: Optional[int], company_name: Optional[str]) -> Company:
        return _resolve_company(self.db, company_id, company_name)

    def _get_wallet_with_lock(self, company_id: int) -> PettyCashWallet:
        if self.db.bind and self.db.bind.dialect.name == "postgresql":
            wallet = self.db.query(PettyCashWallet).filter(PettyCashWallet.company_id == company_id).with_for_update().first()
        else:
            wallet = self.db.query(PettyCashWallet).filter(PettyCashWallet.company_id == company_id).first()
        if not wallet:
            wallet = PettyCashWallet(company_id=company_id, balance=Decimal("0.00"), low_balance_threshold=DEFAULT_LOW_BALANCE_THRESHOLD)
            self.db.add(wallet)
            self.db.flush()
        return wallet

    def _get_bank_account_with_lock(self, bank_id: str) -> Optional[BankAccount]:
        if self.db.bind and self.db.bind.dialect.name == "postgresql":
            return self.db.query(BankAccount).filter(BankAccount.id == bank_id).with_for_update().first()
        return self.db.query(BankAccount).filter(BankAccount.id == bank_id).first()

    def get_unreserved_balance(self, company_id: int, exclude_topup_id: Optional[int] = None) -> Decimal:
        ledger_bal = self.get_balance(company_id)
        active_statuses = [
            "pending finance endorsement",
            "pending audit approval",
            "approved",
            "transfer in transit",
            "return pending",
            "transfer received",
        ]
        query = self.db.query(PettyCashTopUp).filter(
            PettyCashTopUp.company_id == company_id,
            func.lower(PettyCashTopUp.status).in_(active_statuses),
        )
        if exclude_topup_id:
            query = query.filter(PettyCashTopUp.topup_id != exclude_topup_id)
        total_reserved = sum((_to_decimal(t.reserved_amount) for t in query.all() if t.reserved_amount), ZERO)
        return ledger_bal - total_reserved

    def get_balance(self, company_id: int, exclude_expense_id: Optional[int] = None) -> Decimal:
        approved_topups = [t for t in self._topups(company_id) if (t.status or "Approved").lower() == "approved"]
        topped_up = sum(
            (_to_decimal(t.amount) for t in approved_topups if (getattr(t, "request_type", "topup") or "topup").lower() != "reimbursement"),
            ZERO,
        )
        reimbursed = sum(
            (_to_decimal(t.amount) for t in approved_topups if (getattr(t, "request_type", "topup") or "topup").lower() == "reimbursement" and t.total_expenses is None),
            ZERO,
        )
        spent = sum(
            (e["amount"] for e in self._petty_cash_expenses(company_id) if e["expense_id"] != exclude_expense_id),
            ZERO,
        ) + reimbursed
        return topped_up - spent

    def ensure_sufficient_balance(
        self,
        company_id: Optional[int],
        payment_method: Optional[str],
        amount: Optional[Decimal],
        exclude_expense_id: Optional[int] = None,
        category: Optional[str] = None,
    ) -> None:
        """Allow petty cash expenses to be recorded; wallet displays low-balance alert if balance is in deficit."""
        return

    def _build_summary(
        self,
        company: Company,
        topups: List[PettyCashTopUp],
        expenses: List[dict],
        start: Optional[date],
        end: Optional[date],
    ) -> PettyCashSummaryOut:
        approved_topups = [t for t in topups if (t.status or "Approved").lower() == "approved"]
        total_topups = sum(
            (_to_decimal(t.amount) for t in approved_topups if (getattr(t, "request_type", "topup") or "topup").lower() != "reimbursement"),
            ZERO,
        )
        reimbursed = sum(
            (_to_decimal(t.amount) for t in approved_topups if (getattr(t, "request_type", "topup") or "topup").lower() == "reimbursement" and t.total_expenses is None),
            ZERO,
        )
        total_spent = sum((e["amount"] for e in expenses), ZERO) + reimbursed
        period_topups = sum(
            (_to_decimal(t.amount) for t in approved_topups if _in_period(t.topup_date, start, end) and (getattr(t, "request_type", "topup") or "topup").lower() != "reimbursement"),
            ZERO,
        )
        period_reimbursed = sum(
            (_to_decimal(t.amount) for t in approved_topups if _in_period(t.topup_date, start, end) and (getattr(t, "request_type", "topup") or "topup").lower() == "reimbursement" and t.total_expenses is None),
            ZERO,
        )
        period_spent = sum((e["amount"] for e in expenses if _in_period(e["expense_date"], start, end)), ZERO) + period_reimbursed
        balance = total_topups - total_spent
        threshold = self._threshold(company.company_id)
        return PettyCashSummaryOut(
            company_id=company.company_id,
            company_name=company.company_name,
            balance=balance,
            total_topups=total_topups,
            total_spent=total_spent,
            period_topups=period_topups,
            period_spent=period_spent,
            low_balance_threshold=threshold,
            is_low=balance < threshold,
        )

    def get_summary(self, company: Company, start: Optional[date] = None, end: Optional[date] = None) -> PettyCashSummaryOut:
        return self._build_summary(
            company,
            self._topups(company.company_id),
            self._petty_cash_expenses(company.company_id),
            start,
            end,
        )

    def list_summaries(self, start: Optional[date] = None, end: Optional[date] = None) -> List[PettyCashSummaryOut]:
        """One summary per company (wallets with no activity yet show a zero balance)."""
        topups = self._topups()
        expenses = self._petty_cash_expenses()
        companies = self.db.query(Company).all()
        return [
            self._build_summary(
                company,
                [t for t in topups if t.company_id == company.company_id],
                [e for e in expenses if e["company_id"] == company.company_id],
                start,
                end,
            )
            for company in sorted(companies, key=lambda c: c.company_name)
        ]

    def list_ledger(
        self,
        company: Optional[Company] = None,
        start: Optional[date] = None,
        end: Optional[date] = None,
        user_role: Optional[str] = None,
    ) -> List[PettyCashLedgerEntry]:
        """Top-ups, requests, and petty cash expenses, newest first, each with the balance after it."""
        company_id = company.company_id if company else None
        cache_key = f"pc_ledger_{company_id}_{start}_{end}_{user_role}"
        cached = system_cache.get(cache_key)
        if cached is not None:
            return cached

        comp_map = system_cache.get("comp_id_map")
        if not comp_map:
            comp_map = {c.company_id: c.company_name for c in self.db.query(Company).all()}
            system_cache.set("comp_id_map", comp_map, ttl=300, tags=["companies"])

        topups = self._topups(company_id)
        # Internal Audit cannot see unendorsed submissions
        is_auditor = bool(user_role and ("audit" in user_role.lower() or "auditor" in user_role.lower()))
        if is_auditor:
            topups = [
                t for t in topups
                if (t.status or "").lower() not in ["pending finance endorsement", "pending finance approval"]
            ]

        expenses = self._petty_cash_expenses(company_id)

        # Funding bank for each top up that has one (spec 0014).
        name_to_id = {(name or "").strip().lower(): cid for cid, name in comp_map.items()}
        banks = self._banks_by_id({t.bank_account_id for t in topups})

        entries = []
        for t in topups:
            status_val = t.status or "Approved"
            is_approved = status_val.lower() == "approved"
            amt = _to_decimal(t.amount)
            funding = self._resolve_funding(t, banks, comp_map, name_to_id)
            funding_bank = funding["bank"] if funding else None
            req_type = (getattr(t, "request_type", "topup") or "topup").strip().lower()
            is_reimbursement = req_type == "reimbursement"

            amt_in = ZERO
            amt_out = ZERO
            if is_approved:
                if is_reimbursement:
                    amt_out = ZERO if t.total_expenses is not None else amt
                else:
                    amt_in = amt

            default_desc = (
                "Petty cash reimbursement" if is_reimbursement
                else ("Top-up from sales" if is_approved else "Petty cash replenishment request")
            )

            entries.append({
                "funding_bank_id": funding_bank.id if funding_bank else None,
                "funding_bank_name": funding_bank.bank_name if funding_bank else None,
                "funding_account_name": funding_bank.account_name if funding_bank else None,
                "funding_company_name": funding["company_name"] if funding else None,
                "is_own_account": bool(funding and funding["is_own_account"]),
                "entry_id": f"topup-{t.topup_id}",
                "entry_type": ("expense" if is_reimbursement else "topup") if is_approved else "request",
                "record_id": t.topup_id,
                "company_id": t.company_id,
                "company_name": comp_map.get(t.company_id, t.company.company_name if t.company else "Unknown"),
                "entry_date": t.topup_date,
                "description": t.description or default_desc,
                "category": getattr(t, "category", None) or ("Reimbursement" if is_reimbursement else None),
                "reference_no": t.reference_no,
                "amount_requested": amt,
                "amount_in": amt_in,
                "amount_out": amt_out,
                "status": status_val,
                "request_type": req_type,
                "paid_by": getattr(t, "paid_by", None),
                "receipt_url": getattr(t, "receipt_url", None),
                "attachments": getattr(t, "attachments", None),
                "items": getattr(t, "items", None),
                "endorsed_by": t.endorsed_by,
                "endorsed_at": t.endorsed_at,
                "finance_remark": t.finance_remark,
                "remark": t.remark,
                "reviewed_by": t.reviewed_by,
                "reviewed_at": t.reviewed_at,
                "created_at": t.created_at,
                "total_expenses": t.total_expenses,
                "company_funded_amount": t.company_funded_amount or ZERO,
                "employee_out_of_pocket": t.employee_out_of_pocket or ZERO,
                "existing_expense_id": t.existing_expense_id,
                "payment_method_option": t.payment_method_option,
                "destination_bank_id": t.destination_bank_id,
                "destination_bank_name": (self.db.query(BankAccount).filter(BankAccount.id == t.destination_bank_id).first().bank_name) if t.destination_bank_id else None,
                "intercompany_transfer_id": t.intercompany_transfer_id,
                "transfer_status": t.intercompany_transfer.transfer_status if t.intercompany_transfer else None,
                "settlement_status": t.intercompany_transfer.settlement_status if t.intercompany_transfer else None,
                "reimbursed_at": t.reimbursed_at,
                "reimbursed_by": t.reimbursed_by,
                "transfer_received_at": t.transfer_received_at,
                "transfer_received_by": t.transfer_received_by,
            })

        for e in expenses:
            if not e["expense_date"]:
                continue
            amt_out = e["amount"]
            entries.append({
                "entry_id": f"expense-{e['expense_id']}",
                "entry_type": "expense",
                "record_id": e["expense_id"],
                "company_id": e["company_id"],
                "company_name": comp_map.get(e["company_id"], "Unknown"),
                "entry_date": e["expense_date"],
                "description": e["description"],
                "category": e["category"],
                "reference_no": e["reference_no"],
                "amount_requested": ZERO,
                "amount_in": ZERO,
                "amount_out": amt_out,
                "status": "Approved",
                "request_type": "expense",
                "paid_by": None,
                "receipt_url": None,
                "attachments": None,
                "items": None,
                "endorsed_by": None,
                "endorsed_at": None,
                "finance_remark": None,
                "remark": None,
                "reviewed_by": None,
                "reviewed_at": None,
                "created_at": e.get("created_at"),
            })

        # Running balance is computed over the full history chronologically
        entries.sort(key=lambda e: (e["entry_date"], 0 if e["entry_type"] == "topup" else (1 if e["entry_type"] == "request" else 2), e["record_id"]))
        running = ZERO
        for entry in entries:
            running += entry["amount_in"] - entry["amount_out"]
            entry["running_balance"] = running

        result = [
            PettyCashLedgerEntry(**entry)
            for entry in reversed(entries)
            if _in_period(entry["entry_date"], start, end)
        ]
        system_cache.set(cache_key, result, ttl=60, tags=["petty_cash"])
        return result

    def _banks_by_id(self, bank_ids) -> Dict[str, BankAccount]:
        ids = {(b or "").strip() for b in bank_ids if (b or "").strip()}
        if not ids:
            return {}
        return {b.id: b for b in self.db.query(BankAccount).filter(BankAccount.id.in_(ids)).all()}

    @staticmethod
    def _resolve_funding(topup, banks: Dict[str, BankAccount], comp_names: Dict[int, str], name_to_id: Dict[str, int]):
        """
        Who funds a top up (specs 0012, 0013, 0014). Returns None when the top up has no funding
        bank or the bank cannot be found. The funding company is the bank's `company_id`, else the
        company matched by the bank's `company_name`. "Own account" means the funding company is
        the requesting company.
        """
        bank = banks.get((topup.bank_account_id or "").strip())
        if bank is None:
            return None

        funding_company_id = bank.company_id
        if funding_company_id is None:
            funding_company_id = name_to_id.get((bank.company_name or "").strip().lower())
        funding_company_name = (
            comp_names.get(funding_company_id) if funding_company_id is not None else None
        ) or bank.company_name

        requesting_name = comp_names.get(topup.company_id)
        is_own_account = funding_company_id == topup.company_id
        if not is_own_account and funding_company_id is None and requesting_name:
            is_own_account = (bank.company_name or "").strip().lower() == requesting_name.strip().lower()

        return {
            "bank": bank,
            "company_id": funding_company_id,
            "company_name": funding_company_name,
            "is_own_account": is_own_account,
        }

    def list_movements(self, company: Optional[Company] = None) -> List[PettyCashMovementOut]:
        """
        Top-ups for the Transaction page ledger 
        """
        topups = [
            t for t in self._topups(None)
            if (t.status or "").strip().lower() in LEDGER_MOVEMENT_STATUSES
            and (t.bank_account_id or "").strip()
        ]
        if not topups:
            return []

        comp_names = {c.company_id: c.company_name for c in self.db.query(Company).all()}
        name_to_id = {(name or "").strip().lower(): cid for cid, name in comp_names.items()}

        banks = self._banks_by_id({t.bank_account_id for t in topups})

        movements: List[PettyCashMovementOut] = []
        for t in topups:
            funding = self._resolve_funding(t, banks, comp_names, name_to_id)
            if funding is None:
                # Funding bank cannot be found: nothing reliable to show for either side.
                continue

            bank = funding["bank"]
            funding_company_id = funding["company_id"]
            funding_company_name = funding["company_name"]
            requesting_name = comp_names.get(t.company_id)
            is_own_account = funding["is_own_account"]

            if company is not None and company.company_id not in (t.company_id, funding_company_id):
                continue

            movements.append(
                PettyCashMovementOut(
                    topup_id=t.topup_id,
                    reference_no=t.reference_no,
                    topup_date=t.topup_date,
                    amount=_to_decimal(t.amount),
                    description=t.description,
                    status=t.status,
                    company_id=t.company_id,
                    company_name=requesting_name,
                    funding_company_id=funding_company_id,
                    funding_company_name=funding_company_name,
                    is_own_account=is_own_account,
                    created_at=t.created_at,
                )
            )

        movements.sort(key=lambda m: (m.topup_date, m.topup_id), reverse=True)
        return movements

    # ── Mutations ────────────────────────────────────────────────────────────

    def _topup_output(self, topup: PettyCashTopUp) -> PettyCashTopUpOut:
        output = PettyCashTopUpOut.model_validate(topup)
        output.company_name = topup.company.company_name if topup.company else None
        if topup.bank_account_id:
            b = self.db.query(BankAccount).filter(BankAccount.id == topup.bank_account_id).first()
            if b:
                output.funding_bank_name = b.bank_name
        if topup.destination_bank_id:
            db_acc = self.db.query(BankAccount).filter(BankAccount.id == topup.destination_bank_id).first()
            if db_acc:
                output.destination_bank_name = db_acc.bank_name
        if topup.intercompany_transfer_id:
            ict = self.db.query(IntercompanyTransfer).filter(IntercompanyTransfer.transfer_id == topup.intercompany_transfer_id).first()
            if ict:
                output.transfer_status = ict.transfer_status
                output.settlement_status = ict.settlement_status
        return output

    def create_topup(self, topup_in: PettyCashTopUpCreate, current_user: Optional[AuthenticatedUser] = None) -> PettyCashTopUpOut:
        company = self.resolve_company(topup_in.company_id, topup_in.company_name or topup_in.company)
        req_type = (topup_in.request_type or "topup").strip().lower()

        total_expenses = topup_in.total_expenses
        company_funded = topup_in.company_funded_amount if topup_in.company_funded_amount is not None else ZERO
        employee_out_of_pocket = topup_in.employee_out_of_pocket if topup_in.employee_out_of_pocket is not None else ZERO
        reserved_amount = ZERO
        existing_exp_id = topup_in.existing_expense_id

        if req_type == "reimbursement":
            if total_expenses is None:
                total_expenses = topup_in.amount
            E = _to_decimal(total_expenses)
            C = _to_decimal(company_funded)
            if E <= ZERO:
                raise HTTPException(status_code=422, detail="Total business expenses must be greater than zero.")
            if C < ZERO:
                raise HTTPException(status_code=422, detail="Company funded amount cannot be negative.")
            if C > E:
                raise HTTPException(status_code=422, detail="Company funded amount cannot exceed total expenses.")
            employee_out_of_pocket = E - C
            payable_amount = employee_out_of_pocket

            # Coordinate under wallet lock
            self._get_wallet_with_lock(company.company_id)

            if existing_exp_id:
                # Pre-recorded expense validation under lock (AC-2)
                exp = self.db.query(Expense).filter(Expense.expense_id == existing_exp_id).first()
                if not exp:
                    raise HTTPException(status_code=422, detail="Linked expense record not found.")
                if exp.company_id != company.company_id:
                    raise HTTPException(status_code=422, detail="Linked expense belongs to a different company.")
                if not (exp.payment_method and "petty cash" in exp.payment_method.lower()):
                    raise HTTPException(status_code=422, detail="Linked expense must have payment method 'Petty Cash'.")
                if _to_decimal(exp.amount) != C:
                    raise HTTPException(status_code=422, detail=f"Linked expense amount (₱{exp.amount:,.2f}) does not match company funded amount (₱{C:,.2f}).")
                if exp.linked_topup_id is not None:
                    raise HTTPException(status_code=422, detail="Linked expense is already associated with another reimbursement claim.")

                # Check if another active topup is already claiming this existing expense
                active_statuses = ["pending finance endorsement", "pending audit approval", "approved", "transfer in transit", "return pending", "transfer received", "reimbursed", "settled"]
                conflict = self.db.query(PettyCashTopUp).filter(
                    PettyCashTopUp.existing_expense_id == existing_exp_id,
                    func.lower(PettyCashTopUp.status).in_(active_statuses),
                ).first()
                if conflict:
                    raise HTTPException(status_code=422, detail="Linked expense is already claimed by an active reimbursement request.")

                reserved_amount = ZERO
            else:
                # Unrecorded cash spending: reservation logic under lock (AC-2)
                if C > ZERO:
                    unreserved = self.get_unreserved_balance(company.company_id)
                    if C > unreserved:
                        raise HTTPException(
                            status_code=422,
                            detail=f"Insufficient unreserved petty cash float. Available unreserved balance: ₱{unreserved:,.2f}, requested company funding: ₱{C:,.2f}."
                        )
                    reserved_amount = C
        else:
            payable_amount = topup_in.amount
            if payable_amount < Decimal("1.00"):
                raise HTTPException(status_code=422, detail="Top-up amount must be at least 1.00.")

        role = (current_user.get("role") or "").lower() if current_user else ""
        is_finance = role in ("finance", "admin", "superadmin")
        is_direct_endorse = (
            (topup_in.status or "").lower() == "pending audit approval"
            or (is_finance and bool(topup_in.bank_account_id))
        )
        status_to_use = "Pending Audit Approval" if is_direct_endorse else (topup_in.status or "Pending Finance Endorsement")
        endorser_name = None
        endorsed_time = None
        fin_remark = None
        bank_id = None
        if is_direct_endorse:
            endorser_name = (
                current_user.get("full_name")
                or current_user.get("email")
                or "Finance Officer"
            ) if current_user else "Finance Officer"
            endorsed_time = func.now()
            fin_remark = topup_in.finance_remark or topup_in.endorsement_remark or "Endorsed upon creation by Finance"
            bank_id = str(topup_in.bank_account_id).strip() if topup_in.bank_account_id else None

        topup = PettyCashTopUp(
            company_id=company.company_id,
            amount=payable_amount,
            topup_date=topup_in.topup_date,
            reference_no=(topup_in.reference_no or "").strip() or None,
            description=(topup_in.description or "").strip() or None,
            bank_account_id=bank_id,
            status=status_to_use,
            request_type=req_type,
            paid_by=(topup_in.paid_by or "").strip() or None,
            receipt_url=topup_in.receipt_url,
            attachments=topup_in.attachments,
            items=topup_in.items,
            category=(topup_in.category or "").strip() or None,
            total_expenses=total_expenses,
            company_funded_amount=company_funded,
            employee_out_of_pocket=employee_out_of_pocket,
            reserved_amount=reserved_amount,
            amount_reimbursed=ZERO,
            existing_expense_id=existing_exp_id,
            endorsed_by=endorser_name,
            endorsed_at=endorsed_time,
            finance_remark=fin_remark,
            remark=None,
            reviewed_by=None,
            reviewed_at=None,
            created_by=topup_in.created_by or (current_user.get("user_id") if current_user else None),
        )
        self.db.add(topup)
        self.db.commit()
        self.db.refresh(topup)
        system_cache.invalidate_tag("petty_cash")
        system_cache.invalidate_tag("notifications")
        ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})
        return self._topup_output(topup)

    def update_topup(
        self,
        topup_id: int,
        amount: Optional[Decimal] = None,
        description: Optional[str] = None,
        total_expenses: Optional[Decimal] = None,
        company_funded_amount: Optional[Decimal] = None,
        existing_expense_id: Optional[int] = None,
    ) -> PettyCashTopUpOut:
        topup = self.db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == topup_id).first()
        if not topup:
            raise HTTPException(status_code=404, detail="Petty cash request not found.")

        current_status = (topup.status or "").lower()
        if current_status not in ["pending finance endorsement", "pending finance approval"]:
            raise HTTPException(
                status_code=400,
                detail=f"This request has already been reviewed by finance ({topup.status}) and cannot be edited."
            )

        req_type = (topup.request_type or "topup").lower()
        if req_type == "reimbursement":
            new_e = total_expenses if total_expenses is not None else topup.total_expenses
            new_c = company_funded_amount if company_funded_amount is not None else topup.company_funded_amount
            new_existing = existing_expense_id if existing_expense_id is not None else topup.existing_expense_id

            if new_e is not None and new_c is not None:
                E = _to_decimal(new_e)
                C = _to_decimal(new_c)
                if E <= ZERO:
                    raise HTTPException(status_code=422, detail="Total business expenses must be greater than zero.")
                if C < ZERO:
                    raise HTTPException(status_code=422, detail="Company funded amount cannot be negative.")
                if C > E:
                    raise HTTPException(status_code=422, detail="Company funded amount cannot exceed total expenses.")
                O = E - C
                topup.total_expenses = E
                topup.company_funded_amount = C
                topup.employee_out_of_pocket = O
                topup.amount = O

                # Revalidate under lock
                self._get_wallet_with_lock(topup.company_id)
                if new_existing:
                    exp = self.db.query(Expense).filter(Expense.expense_id == new_existing).first()
                    if not exp:
                        raise HTTPException(status_code=422, detail="Linked expense record not found.")
                    if exp.company_id != topup.company_id:
                        raise HTTPException(status_code=422, detail="Linked expense belongs to a different company.")
                    if _to_decimal(exp.amount) != C:
                        raise HTTPException(status_code=422, detail=f"Linked expense amount does not match company funded amount.")
                    topup.existing_expense_id = new_existing
                    topup.reserved_amount = ZERO
                else:
                    topup.existing_expense_id = None
                    if C > ZERO:
                        unreserved = self.get_unreserved_balance(topup.company_id, exclude_topup_id=topup.topup_id)
                        if C > unreserved:
                            raise HTTPException(
                                status_code=422,
                                detail=f"Insufficient unreserved petty cash float. Available unreserved balance: ₱{unreserved:,.2f}, requested company funding: ₱{C:,.2f}."
                            )
                        topup.reserved_amount = C
                    else:
                        topup.reserved_amount = ZERO
        else:
            if amount is not None:
                if amount < Decimal("1.00"):
                    raise HTTPException(status_code=400, detail="Amount must be at least 1.00.")
                topup.amount = amount

        if description is not None:
            topup.description = description.strip() or None

        self.db.commit()
        self.db.refresh(topup)
        system_cache.invalidate_tag("petty_cash")
        system_cache.invalidate_tag("notifications")
        ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})
        return self._topup_output(topup)

    def endorse_topup(
        self,
        topup_id: int,
        action: str,
        remark: str,
        endorser_name: Optional[str] = None,
        bank_account_id: Optional[str] = None,
        payment_method_option: Optional[str] = None,
        destination_bank_id: Optional[str] = None,
    ) -> PettyCashTopUpOut:
        topup = self.db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == topup_id).first()
        if not topup:
            raise HTTPException(status_code=404, detail="Petty cash transaction not found.")

        current_status = (topup.status or "").lower()
        if current_status in ["approved", "reimbursed", "settled"]:
            raise HTTPException(status_code=400, detail="This transaction is already approved and cannot be changed.")

        if not remark or not remark.strip():
            raise HTTPException(status_code=422, detail="A remark is required when endorsing or rejecting.")

        is_endorse = action.lower() == "endorse"

        if not is_endorse:
            topup.status = "Rejected by Finance"
            topup.reserved_amount = ZERO
            topup.finance_remark = remark.strip()
            topup.endorsed_by = endorser_name or "Finance Officer"
            topup.endorsed_at = func.now()
            self.db.commit()
            self.db.refresh(topup)
            system_cache.invalidate_tag("petty_cash")
            system_cache.invalidate_tag("notifications")
            ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})
            return self._topup_output(topup)

        is_reimbursement = (getattr(topup, "request_type", "topup") or "topup").lower() == "reimbursement"
        is_zero_excess = is_reimbursement and (_to_decimal(topup.amount) == ZERO or _to_decimal(topup.employee_out_of_pocket) == ZERO)

        if is_zero_excess:
            if bank_account_id and str(bank_account_id).strip():
                topup.bank_account_id = str(bank_account_id).strip()
        else:
            if not (bank_account_id and str(bank_account_id).strip()):
                raise HTTPException(status_code=422, detail="Please choose a funding bank account before endorsing.")

            source_acc = self.db.query(BankAccount).filter(BankAccount.id == str(bank_account_id).strip()).first()
            if not source_acc:
                raise HTTPException(status_code=422, detail="Selected funding bank account not found.")

            topup.bank_account_id = source_acc.id

            company = self.db.query(Company).filter(Company.company_id == topup.company_id).first()
            company_name = company.company_name if company else None
            is_own_account = (source_acc.company_id == topup.company_id)
            if not is_own_account and source_acc.company_id is None and company_name:
                is_own_account = (source_acc.company_name or "").strip().lower() == company_name.strip().lower()

            if is_own_account:
                topup.payment_method_option = None
                topup.destination_bank_id = None
            else:
                opt = (payment_method_option or "").strip().lower()
                if opt not in ("direct", "transfer_first"):
                    raise HTTPException(
                        status_code=422,
                        detail="Please select a payment method option ('direct' or 'transfer_first') for cross-company funding."
                    )
                topup.payment_method_option = opt

                if opt == "transfer_first":
                    if not (destination_bank_id and str(destination_bank_id).strip()):
                        raise HTTPException(
                            status_code=422,
                            detail="Please choose an eligible destination bank account belonging to the requesting company."
                        )
                    dest_acc = self.db.query(BankAccount).filter(BankAccount.id == str(destination_bank_id).strip()).first()
                    if not dest_acc:
                        raise HTTPException(status_code=422, detail="Selected destination bank account not found.")
                    is_dest_own = (dest_acc.company_id == topup.company_id)
                    if not is_dest_own and dest_acc.company_id is None and company_name:
                        is_dest_own = (dest_acc.company_name or "").strip().lower() == company_name.strip().lower()
                    if not is_dest_own:
                        raise HTTPException(status_code=422, detail="Destination bank account must belong to the requesting company.")
                    topup.destination_bank_id = dest_acc.id
                else:
                    topup.destination_bank_id = None

        topup.status = "Pending Audit Approval"
        topup.finance_remark = remark.strip()
        topup.endorsed_by = endorser_name or "Finance Officer"
        topup.endorsed_at = func.now()

        self.db.commit()
        self.db.refresh(topup)
        system_cache.invalidate_tag("petty_cash")
        system_cache.invalidate_tag("notifications")
        ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})
        return self._topup_output(topup)

    def review_topup(
        self,
        topup_id: int,
        action: str,
        remark: str,
        reviewer_name: Optional[str] = None,
    ) -> PettyCashTopUpOut:
        topup = self.db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == topup_id).first()
        if not topup:
            raise HTTPException(status_code=404, detail="Petty cash transaction not found.")

        current_status = (topup.status or "").lower()
        if current_status in ["approved", "reimbursed", "settled"]:
            raise HTTPException(status_code=400, detail="This transaction is already approved and cannot be changed.")

        if not remark or not remark.strip():
            raise HTTPException(status_code=422, detail="A remark is required when approving or disapproving.")

        is_approve = action.lower() == "approve"
        if not is_approve:
            topup.status = "Disapproved by Audit"
            topup.reserved_amount = ZERO
            topup.remark = remark.strip()
            topup.reviewed_by = reviewer_name or "Internal Auditor"
            topup.reviewed_at = func.now()
            self.db.commit()
            self.db.refresh(topup)
            system_cache.invalidate_tag("petty_cash")
            system_cache.invalidate_tag("notifications")
            ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})
            return self._topup_output(topup)

        topup.status = "Approved"
        topup.remark = remark.strip()
        topup.reviewed_by = reviewer_name or "Internal Auditor"
        topup.reviewed_at = func.now()
        self.db.commit()
        self.db.refresh(topup)

        req_type = (getattr(topup, "request_type", "topup") or "topup").lower()
        if req_type == "topup" and topup.bank_account_id:
            self._disburse_to_bank(topup)

        system_cache.invalidate_tag("petty_cash")
        system_cache.invalidate_tag("notifications")
        ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})
        return self._topup_output(topup)

    def finalize_settlement(
        self,
        topup_id: int,
        notes: Optional[str] = None,
        current_user: Optional[AuthenticatedUser] = None,
    ) -> PettyCashTopUpOut:
        topup = self.db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == topup_id).first()
        if not topup:
            raise HTTPException(status_code=404, detail="Petty cash claim not found.")

        if (topup.status or "").lower() == "settled":
            return self._topup_output(topup)

        if (topup.status or "").lower() != "approved":
            raise HTTPException(
                status_code=400,
                detail=f"Claim in status '{topup.status}' cannot be finalized. It must be in 'Approved' status."
            )

        O = _to_decimal(topup.amount)
        if O > ZERO:
            raise HTTPException(
                status_code=400,
                detail="This claim has positive employee out-of-pocket expenses. Use Reimburse instead of Finalize Settlement."
            )

        C = _to_decimal(topup.company_funded_amount) if topup.company_funded_amount is not None else _to_decimal(topup.total_expenses)

        # Coordinate under wallet lock
        self._get_wallet_with_lock(topup.company_id)

        if topup.existing_expense_id:
            existing_exp = self.db.query(Expense).filter(Expense.expense_id == topup.existing_expense_id).first()
            if existing_exp:
                existing_exp.linked_topup_id = topup.topup_id
            topup.petty_cash_expense_id = topup.existing_expense_id
        else:
            cat_obj = None
            if topup.category:
                cat_obj = self.db.query(Category).filter(func.lower(Category.name) == topup.category.strip().lower()).first()
            new_exp = Expense(
                company_id=topup.company_id,
                category_id=cat_obj.category_id if cat_obj else None,
                expense_date=topup.topup_date or date.today(),
                amount=C,
                description=topup.description or f"Petty Cash Expense for {topup.paid_by or 'Employee'}",
                payment_method="Petty Cash",
                reference_no=f"PC-EXP-{topup.topup_id}",
                linked_topup_id=topup.topup_id,
            )
            self.db.add(new_exp)
            self.db.flush()
            topup.petty_cash_expense_id = new_exp.expense_id

        topup.reserved_amount = ZERO
        topup.status = "Settled"
        topup.reimbursed_at = func.now()
        topup.reimbursed_by = current_user.get("full_name") if current_user else "Finance Officer"

        self.db.commit()
        self.db.refresh(topup)
        system_cache.invalidate_tag("petty_cash")
        system_cache.invalidate_tag("notifications")
        ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})
        return self._topup_output(topup)

    def reimburse(
        self,
        topup_id: int,
        notes: Optional[str] = None,
        current_user: Optional[AuthenticatedUser] = None,
    ) -> PettyCashTopUpOut:
        topup = self.db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == topup_id).first()
        if not topup:
            raise HTTPException(status_code=404, detail="Petty cash claim not found.")

        if (topup.status or "").lower() == "reimbursed":
            return self._topup_output(topup)

        is_transfer_first = (topup.payment_method_option or "").lower() == "transfer_first"
        current_status = (topup.status or "").lower()

        if is_transfer_first:
            if current_status != "transfer received":
                raise HTTPException(
                    status_code=400,
                    detail=f"Transfer first reimbursement requires funds to be received first (current status: '{topup.status}')."
                )
            funding_bank_id = topup.destination_bank_id
        else:
            if current_status != "approved":
                raise HTTPException(
                    status_code=400,
                    detail=f"Claim in status '{topup.status}' cannot be reimbursed. It must be in 'Approved' status."
                )
            funding_bank_id = topup.bank_account_id

        if not funding_bank_id:
            raise HTTPException(status_code=400, detail="No funding bank account configured for reimbursement.")

        # Lock funding bank account and validate balance (AC-14)
        bank_acc = self._get_bank_account_with_lock(funding_bank_id)
        if not bank_acc:
            raise HTTPException(status_code=400, detail="Funding bank account not found.")

        O = _to_decimal(topup.amount)
        if _to_decimal(bank_acc.current_balance) < O:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient bank funds in {bank_acc.bank_name}. Available balance: ₱{bank_acc.current_balance:,.2f}, required: ₱{O:,.2f}."
            )

        # Coordinate under wallet lock
        self._get_wallet_with_lock(topup.company_id)

        # 1. Execute bank withdrawal
        bank_svc = BankService(self.db)
        ref_no = topup.reference_no or f"REIMB-{topup.topup_id}"
        tx_date = datetime.now().strftime("%m/%d/%y")
        withdraw_req = BankDepositWithdrawRequest(
            amount=O,
            date=tx_date,
            particulars=f"Petty Cash Reimbursement for {topup.paid_by or 'Employee'} (Ref: {ref_no})",
            category="Bank Transfer" if topup.payment_method_option == "direct" else "Cheque",
            reference_no=ref_no,
        )
        _, tx = bank_svc.withdraw(bank_acc.id, withdraw_req)

        # 2. Method A (Direct Payment): record intercompany transfer
        if topup.payment_method_option == "direct":
            ict_ref = f"ICT-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
            transfer = IntercompanyTransfer(
                source_company_id=bank_acc.company_id,
                destination_company_id=topup.company_id,
                source_bank_id=bank_acc.id,
                source_bank_tx_id=tx.id,
                amount=O,
                transfer_type="reimbursement_direct",
                reference_no=ict_ref,
                transfer_status="NOT_APPLICABLE",
                settlement_status="UNSETTLED",
                initiated_by=current_user.get("full_name") if current_user else "Finance Officer",
                linked_topup_id=topup.topup_id,
                notes=notes,
            )
            self.db.add(transfer)
            self.db.flush()
            topup.intercompany_transfer_id = transfer.transfer_id

        # 3. Finalize expenses (AC-3)
        C = _to_decimal(topup.company_funded_amount) if topup.company_funded_amount is not None else ZERO
        cat_obj = None
        if topup.category:
            cat_obj = self.db.query(Category).filter(func.lower(Category.name) == topup.category.strip().lower()).first()

        if topup.existing_expense_id:
            existing_exp = self.db.query(Expense).filter(Expense.expense_id == topup.existing_expense_id).first()
            if existing_exp:
                existing_exp.linked_topup_id = topup.topup_id
            topup.petty_cash_expense_id = topup.existing_expense_id
        elif C > ZERO:
            new_pc_exp = Expense(
                company_id=topup.company_id,
                category_id=cat_obj.category_id if cat_obj else None,
                expense_date=topup.topup_date or date.today(),
                amount=C,
                description=topup.description or f"Petty Cash Expense for {topup.paid_by or 'Employee'}",
                payment_method="Petty Cash",
                reference_no=f"PC-EXP-{topup.topup_id}",
                linked_topup_id=topup.topup_id,
            )
            self.db.add(new_pc_exp)
            self.db.flush()
            topup.petty_cash_expense_id = new_pc_exp.expense_id

        if O > ZERO:
            new_reimb_exp = Expense(
                company_id=topup.company_id,
                category_id=cat_obj.category_id if cat_obj else None,
                expense_date=topup.topup_date or date.today(),
                amount=O,
                description=topup.description or f"Reimbursement Payout for {topup.paid_by or 'Employee'}",
                payment_method="Bank Reimbursement",
                reference_no=f"REIMB-{topup.topup_id}",
                linked_topup_id=topup.topup_id,
            )
            self.db.add(new_reimb_exp)
            self.db.flush()
            topup.reimbursement_expense_id = new_reimb_exp.expense_id

        topup.reserved_amount = ZERO
        topup.status = "Reimbursed"
        topup.amount_reimbursed = O
        topup.reimbursed_at = func.now()
        topup.reimbursed_by = current_user.get("full_name") if current_user else "Finance Officer"

        self.db.commit()
        self.db.refresh(topup)
        system_cache.invalidate_tag("petty_cash")
        system_cache.invalidate_tag("notifications")
        ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})
        return self._topup_output(topup)

    def initiate_transfer(
        self,
        topup_id: int,
        notes: Optional[str] = None,
        current_user: Optional[AuthenticatedUser] = None,
    ) -> PettyCashTopUpOut:
        topup = self.db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == topup_id).first()
        if not topup:
            raise HTTPException(status_code=404, detail="Petty cash claim not found.")

        if (topup.status or "").lower() == "transfer in transit":
            return self._topup_output(topup)

        if (topup.status or "").lower() != "approved":
            raise HTTPException(
                status_code=400,
                detail=f"Transfer cannot be initiated in status '{topup.status}'. It must be in 'Approved' status."
            )

        if (topup.payment_method_option or "").lower() != "transfer_first":
            raise HTTPException(status_code=400, detail="This claim is not configured for 'transfer_first'.")

        if not topup.bank_account_id or not topup.destination_bank_id:
            raise HTTPException(status_code=400, detail="Source and destination bank accounts must be configured.")

        source_acc = self._get_bank_account_with_lock(topup.bank_account_id)
        dest_acc = self.db.query(BankAccount).filter(BankAccount.id == topup.destination_bank_id).first()
        if not source_acc or not dest_acc:
            raise HTTPException(status_code=400, detail="Configured source or destination bank account not found.")

        O = _to_decimal(topup.amount)
        if _to_decimal(source_acc.current_balance) < O:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient bank funds in funding bank {source_acc.bank_name}. Available balance: ₱{source_acc.current_balance:,.2f}, required: ₱{O:,.2f}."
            )

        # Withdraw from source bank (Company B)
        bank_svc = BankService(self.db)
        ict_ref = f"ICT-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
        tx_date = datetime.now().strftime("%m/%d/%y")
        withdraw_req = BankDepositWithdrawRequest(
            amount=O,
            date=tx_date,
            particulars=f"Intercompany Transfer for Reimbursement {topup.reference_no or f'REIMB-{topup.topup_id}'} (Ref: {ict_ref})",
            category="Bank Transfer",
            reference_no=ict_ref,
        )
        _, tx = bank_svc.withdraw(source_acc.id, withdraw_req)

        transfer = IntercompanyTransfer(
            source_company_id=source_acc.company_id,
            destination_company_id=topup.company_id,
            source_bank_id=source_acc.id,
            destination_bank_id=dest_acc.id,
            source_bank_tx_id=tx.id,
            amount=O,
            transfer_type="reimbursement_transfer_first",
            reference_no=ict_ref,
            transfer_status="IN_TRANSIT",
            settlement_status="UNSETTLED",
            initiated_by=current_user.get("full_name") if current_user else "Finance Officer",
            linked_topup_id=topup.topup_id,
            notes=notes,
        )
        self.db.add(transfer)
        self.db.flush()

        topup.intercompany_transfer_id = transfer.transfer_id
        topup.status = "Transfer In Transit"

        self.db.commit()
        self.db.refresh(topup)
        system_cache.invalidate_tag("petty_cash")
        system_cache.invalidate_tag("notifications")
        ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})
        return self._topup_output(topup)

    def confirm_transfer(
        self,
        topup_id: int,
        notes: Optional[str] = None,
        current_user: Optional[AuthenticatedUser] = None,
    ) -> PettyCashTopUpOut:
        topup = self.db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == topup_id).first()
        if not topup:
            raise HTTPException(status_code=404, detail="Petty cash claim not found.")

        if (topup.status or "").lower() == "transfer received":
            return self._topup_output(topup)

        if (topup.status or "").lower() != "transfer in transit":
            raise HTTPException(
                status_code=400,
                detail=f"Transfer cannot be confirmed in status '{topup.status}'. It must be 'Transfer In Transit'."
            )

        transfer = self.db.query(IntercompanyTransfer).filter(IntercompanyTransfer.transfer_id == topup.intercompany_transfer_id).first()
        if not transfer or transfer.transfer_status != "IN_TRANSIT":
            raise HTTPException(status_code=400, detail="Active in-transit transfer record not found.")

        # Deposit into destination bank (Company A)
        bank_svc = BankService(self.db)
        tx_date = datetime.now().strftime("%m/%d/%y")
        deposit_req = BankDepositWithdrawRequest(
            amount=_to_decimal(transfer.amount),
            date=tx_date,
            particulars=f"Intercompany Transfer Received (Ref: {transfer.reference_no})",
            category="Bank Transfer",
            reference_no=transfer.reference_no,
        )
        _, tx = bank_svc.deposit(transfer.destination_bank_id, deposit_req)

        officer = current_user.get("full_name") if current_user else "Receiving Officer"
        transfer.destination_bank_tx_id = tx.id
        transfer.transfer_status = "RECEIVED"
        transfer.received_by = officer
        transfer.received_at = func.now()

        topup.status = "Transfer Received"
        topup.transfer_received_by = officer
        topup.transfer_received_at = func.now()

        self.db.commit()
        self.db.refresh(topup)
        system_cache.invalidate_tag("petty_cash")
        system_cache.invalidate_tag("notifications")
        ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})
        return self._topup_output(topup)

    def cancel_transfer(
        self,
        topup_id: int,
        reason: str,
        current_user: Optional[AuthenticatedUser] = None,
    ) -> PettyCashTopUpOut:
        topup = self.db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == topup_id).first()
        if not topup:
            raise HTTPException(status_code=404, detail="Petty cash claim not found.")

        if (topup.status or "").lower() == "return pending":
            return self._topup_output(topup)

        if (topup.status or "").lower() in ["transfer received", "reimbursed"]:
            raise HTTPException(status_code=400, detail="Cannot cancel transfer that has already been received or reimbursed.")

        if (topup.status or "").lower() != "transfer in transit":
            raise HTTPException(
                status_code=400,
                detail=f"Transfer cannot be cancelled in status '{topup.status}'. It must be 'Transfer In Transit'."
            )

        transfer = self.db.query(IntercompanyTransfer).filter(IntercompanyTransfer.transfer_id == topup.intercompany_transfer_id).first()
        if not transfer or transfer.transfer_status != "IN_TRANSIT":
            raise HTTPException(status_code=400, detail="Active in-transit transfer record not found.")

        transfer.transfer_status = "RETURN_PENDING"
        transfer.notes = f"{transfer.notes or ''}\nCancellation reason: {reason.strip()}".strip()

        topup.status = "Return Pending"

        self.db.commit()
        self.db.refresh(topup)
        system_cache.invalidate_tag("petty_cash")
        system_cache.invalidate_tag("notifications")
        ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})
        return self._topup_output(topup)

    def confirm_reversal(
        self,
        topup_id: int,
        verification_notes: Optional[str] = None,
        current_user: Optional[AuthenticatedUser] = None,
    ) -> PettyCashTopUpOut:
        topup = self.db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == topup_id).first()
        if not topup:
            raise HTTPException(status_code=404, detail="Petty cash claim not found.")

        if (topup.status or "").lower() == "cancelled":
            return self._topup_output(topup)

        if (topup.status or "").lower() != "return pending":
            raise HTTPException(
                status_code=400,
                detail=f"Reversal cannot be confirmed in status '{topup.status}'. It must be in 'Return Pending'."
            )

        transfer = self.db.query(IntercompanyTransfer).filter(IntercompanyTransfer.transfer_id == topup.intercompany_transfer_id).first()
        if not transfer or transfer.transfer_status != "RETURN_PENDING":
            raise HTTPException(status_code=400, detail="Transfer is not in RETURN_PENDING status.")

        # Post reversal deposit to Company B bank account
        bank_svc = BankService(self.db)
        rev_ref = f"REV-{transfer.reference_no}"
        tx_date = datetime.now().strftime("%m/%d/%y")
        deposit_req = BankDepositWithdrawRequest(
            amount=_to_decimal(transfer.amount),
            date=tx_date,
            particulars=f"Intercompany Transfer Reversal for {transfer.reference_no}",
            category="Intercompany Transfer Reversal",
            reference_no=rev_ref,
        )
        _, tx = bank_svc.deposit(transfer.source_bank_id, deposit_req)

        transfer.reversal_bank_tx_id = tx.id
        transfer.transfer_status = "CANCELLED"
        if verification_notes:
            transfer.notes = f"{transfer.notes or ''}\nReversal notes: {verification_notes.strip()}".strip()

        # Invalidate previous approvals per AC-12
        topup.status = "Pending Finance Endorsement"
        topup.endorsed_by = None
        topup.endorsed_at = None
        topup.finance_remark = None
        topup.reviewed_by = None
        topup.reviewed_at = None
        topup.remark = None
        topup.payment_method_option = None
        topup.destination_bank_id = None

        self.db.commit()
        self.db.refresh(topup)
        system_cache.invalidate_tag("petty_cash")
        system_cache.invalidate_tag("notifications")
        ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})
        return self._topup_output(topup)

    def list_intercompany_transfers(
        self,
        company_id: Optional[int] = None,
        settlement_status: Optional[str] = None,
    ) -> List[IntercompanyTransferOut]:
        query = self.db.query(IntercompanyTransfer)
        if company_id:
            query = query.filter(
                (IntercompanyTransfer.source_company_id == company_id) | (IntercompanyTransfer.destination_company_id == company_id)
            )
        if settlement_status:
            query = query.filter(func.lower(IntercompanyTransfer.settlement_status) == settlement_status.strip().lower())

        query = query.order_by(IntercompanyTransfer.initiated_at.desc())
        transfers = query.all()

        comp_map = {c.company_id: c.company_name for c in self.db.query(Company).all()}
        bank_map = {b.id: b.bank_name for b in self.db.query(BankAccount).all()}

        results = []
        for t in transfers:
            item = IntercompanyTransferOut.model_validate(t)
            item.source_company_name = comp_map.get(t.source_company_id)
            item.destination_company_name = comp_map.get(t.destination_company_id)
            item.source_bank_name = bank_map.get(t.source_bank_id)
            item.destination_bank_name = bank_map.get(t.destination_bank_id) if t.destination_bank_id else None
            results.append(item)
        return results

    def settle_intercompany_transfer(
        self,
        transfer_id: int,
        source_bank_id: str,
        destination_bank_id: str,
        notes: Optional[str] = None,
        current_user: Optional[AuthenticatedUser] = None,
    ) -> IntercompanyTransferOut:
        transfer = self.db.query(IntercompanyTransfer).filter(IntercompanyTransfer.transfer_id == transfer_id).first()
        if not transfer:
            raise HTTPException(status_code=404, detail="Intercompany transfer not found.")

        if transfer.settlement_status == "SETTLED":
            comp_map = {c.company_id: c.company_name for c in self.db.query(Company).all()}
            bank_map = {b.id: b.bank_name for b in self.db.query(BankAccount).all()}
            item = IntercompanyTransferOut.model_validate(transfer)
            item.source_company_name = comp_map.get(transfer.source_company_id)
            item.destination_company_name = comp_map.get(transfer.destination_company_id)
            item.source_bank_name = bank_map.get(transfer.source_bank_id)
            item.destination_bank_name = bank_map.get(transfer.destination_bank_id) if transfer.destination_bank_id else None
            return item

        if transfer.transfer_status not in ("NOT_APPLICABLE", "RECEIVED"):
            raise HTTPException(
                status_code=400,
                detail=f"Transfer in status '{transfer.transfer_status}' cannot be settled. Only completed transfers can be repaid."
            )

        source_bank = self._get_bank_account_with_lock(source_bank_id)
        dest_bank = self.db.query(BankAccount).filter(BankAccount.id == destination_bank_id).first()
        if not source_bank or not dest_bank:
            raise HTTPException(status_code=422, detail="Source or destination bank account not found.")

        if source_bank.company_id != transfer.destination_company_id:
            raise HTTPException(status_code=422, detail="Source bank account must belong to the debtor company (Company A).")

        if dest_bank.company_id != transfer.source_company_id:
            raise HTTPException(status_code=422, detail="Destination bank account must belong to the creditor company (Company B).")

        amt = _to_decimal(transfer.amount)
        if _to_decimal(source_bank.current_balance) < amt:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient bank funds in {source_bank.bank_name}. Available balance: ₱{source_bank.current_balance:,.2f}, required: ₱{amt:,.2f}."
            )

        bank_svc = BankService(self.db)
        tx_date = datetime.now().strftime("%m/%d/%y")
        settle_ref = f"SETTLE-{transfer.reference_no}"

        # 1. Withdrawal from Company A bank
        withdraw_req = BankDepositWithdrawRequest(
            amount=amt,
            date=tx_date,
            particulars=f"Intercompany Repayment to {dest_bank.company_name} (Ref: {settle_ref})",
            category="Bank Transfer",
            reference_no=settle_ref,
        )
        _, tx_w = bank_svc.withdraw(source_bank.id, withdraw_req)

        # 2. Deposit into Company B bank
        deposit_req = BankDepositWithdrawRequest(
            amount=amt,
            date=tx_date,
            particulars=f"Intercompany Repayment from {source_bank.company_name} (Ref: {settle_ref})",
            category="Bank Transfer",
            reference_no=settle_ref,
        )
        _, tx_d = bank_svc.deposit(dest_bank.id, deposit_req)

        transfer.repayment_source_bank_tx_id = tx_w.id
        transfer.repayment_destination_bank_tx_id = tx_d.id
        transfer.settlement_status = "SETTLED"
        transfer.settled_at = func.now()
        transfer.repaid_by = current_user.get("full_name") if current_user else "Finance Officer"
        if notes:
            transfer.notes = f"{transfer.notes or ''}\nSettlement notes: {notes.strip()}".strip()

        self.db.commit()
        self.db.refresh(transfer)
        system_cache.invalidate_tag("petty_cash")
        system_cache.invalidate_tag("notifications")
        ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})

        comp_map = {c.company_id: c.company_name for c in self.db.query(Company).all()}
        bank_map = {b.id: b.bank_name for b in self.db.query(BankAccount).all()}
        item = IntercompanyTransferOut.model_validate(transfer)
        item.source_company_name = comp_map.get(transfer.source_company_id)
        item.destination_company_name = comp_map.get(transfer.destination_company_id)
        item.source_bank_name = bank_map.get(transfer.source_bank_id)
        item.destination_bank_name = bank_map.get(transfer.destination_bank_id) if transfer.destination_bank_id else None
        return item

    def _disburse_to_bank(self, topup: PettyCashTopUp) -> None:

        amount = _to_decimal(topup.amount)
        if amount <= ZERO:
            return

        funding_bank_id = (topup.bank_account_id or "").strip()
        if not funding_bank_id:
            # No funding bank chosen (e.g. a historical row). Nothing to move; the wallet
            # credit from the Approved status still applies.
            return

        bank_svc = BankService(self.db)
        funding_acc = self.db.query(BankAccount).filter(BankAccount.id == funding_bank_id).first()
        if not funding_acc:
            raise HTTPException(
                status_code=400,
                detail="The selected funding bank account was not found. Please re-endorse with a valid bank.",
            )

        # Is the funding bank the requesting company's own account?
        company = self.db.query(Company).filter(Company.company_id == topup.company_id).first()
        company_name = company.company_name if company else None
        is_own_account = funding_acc.company_id == topup.company_id
        if not is_own_account and funding_acc.company_id is None and company_name:
            # Fallback when the account has no company_id: match by company name.
            is_own_account = (funding_acc.company_name or "").strip().lower() == company_name.strip().lower()

        ref = topup.reference_no or f"PC-{topup.topup_id}"
        c_disp = company_name or f"Company #{topup.company_id}"
        tx_date = topup.topup_date.strftime("%m/%d/%y") if topup.topup_date else datetime.now().strftime("%m/%d/%y")

        if is_own_account:
            # Own-account funding: withdraw from the company's own bank account to fund the petty cash wallet.
            try:
                withdraw_req = BankDepositWithdrawRequest(
                    amount=amount,
                    date=tx_date,
                    particulars=f"Petty Cash Replenishment for {c_disp} (Ref: {ref})",
                    category="Bank Transfer",
                    reference_no=ref,
                )
                bank_svc.withdraw(funding_acc.id, withdraw_req)
                ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"account_id": funding_acc.id}})
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Bank withdrawal for petty cash failed: {exc}")
            return

        try:
            # 1. Withdraw from the outside funding bank.
            withdraw_req = BankDepositWithdrawRequest(
                amount=amount,
                date=tx_date,
                particulars=f"Petty Cash Funding for {c_disp} (Ref: {ref})",
                category="Bank Transfer",
                reference_no=ref,
            )
            bank_svc.withdraw(funding_acc.id, withdraw_req)
            ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"account_id": funding_acc.id}})
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Bank withdrawal for petty cash failed: {exc}")

        # 2. Deposit into the requesting company's own bank account.
        dest_acc = self.db.query(BankAccount).filter(BankAccount.company_id == topup.company_id).first()
        if not dest_acc and company_name:
            dest_acc = bank_svc.find_account_for_company(company_name)
        if dest_acc:
            try:
                deposit_req = BankDepositWithdrawRequest(
                    amount=amount,
                    date=tx_date,
                    particulars=f"Petty Cash Top-up received (Ref: {ref})",
                    category="Bank Transfer",
                    reference_no=ref,
                )
                bank_svc.deposit(dest_acc.id, deposit_req)
                ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"account_id": dest_acc.id}})
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Bank deposit for petty cash failed: {exc}")

    def delete_topup(self, topup_id: int) -> PettyCashTopUp:
        topup = self.db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == topup_id).first()
        if not topup:
            raise HTTPException(status_code=404, detail="Top-up not found.")

        current_status = (topup.status or "").lower()
        if current_status not in ["pending finance endorsement", "pending finance approval"]:
            raise HTTPException(
                status_code=400,
                detail=f"This request has already been reviewed by finance ({topup.status}) and cannot be deleted."
            )

        # Removing the top-up must not leave already-recorded petty cash spending uncovered
        if self.get_balance(topup.company_id) - _to_decimal(topup.amount) < ZERO:
            raise HTTPException(
                status_code=400,
                detail="Cannot remove this top-up: petty cash expenses already use these funds.",
            )
        self.db.delete(topup)
        self.db.commit()
        system_cache.invalidate_tag("petty_cash")
        system_cache.invalidate_tag("notifications")
        ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})
        return topup

    def update_threshold(self, company: Company, threshold: Decimal) -> PettyCashSummaryOut:
        wallet = self.db.query(PettyCashWallet).filter(PettyCashWallet.company_id == company.company_id).first()
        if not wallet:
            wallet = PettyCashWallet(company_id=company.company_id)
            self.db.add(wallet)
        wallet.low_balance_threshold = threshold
        self.db.commit()
        system_cache.invalidate_tag("petty_cash")
        system_cache.invalidate_tag("notifications")
        return self.get_summary(company)

    def topups_total_in_period(self, company_id: int, start: Optional[date], end: Optional[date]) -> Decimal:
        return sum(
            (_to_decimal(t.amount) for t in self._topups(company_id) if _in_period(t.topup_date, start, end)),
            ZERO,
        )
