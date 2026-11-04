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
from app.models.petty_cash import PettyCashTopUp, PettyCashWallet
from app.schemas.bank import BankDepositWithdrawRequest
from app.services.bank_service import BankService
from app.schemas.petty_cash import (
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
            rows = [r for r in rows if not (r.get("reference_no") or "").upper().startswith("SEED-")]

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
            query = query.filter(~Expense.reference_no.like("SEED-%") | (Expense.reference_no == None))
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

    def get_balance(self, company_id: int, exclude_expense_id: Optional[int] = None) -> Decimal:
        approved_topups = [t for t in self._topups(company_id) if (t.status or "Approved").lower() == "approved"]
        topped_up = sum((_to_decimal(t.amount) for t in approved_topups), ZERO)
        spent = sum(
            (e["amount"] for e in self._petty_cash_expenses(company_id) if e["expense_id"] != exclude_expense_id),
            ZERO,
        )
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
        total_topups = sum((_to_decimal(t.amount) for t in approved_topups), ZERO)
        total_spent = sum((e["amount"] for e in expenses), ZERO)
        period_topups = sum((_to_decimal(t.amount) for t in approved_topups if _in_period(t.topup_date, start, end)), ZERO)
        period_spent = sum((e["amount"] for e in expenses if _in_period(e["expense_date"], start, end)), ZERO)
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
            entries.append({
                "funding_bank_id": funding_bank.id if funding_bank else None,
                "funding_bank_name": funding_bank.bank_name if funding_bank else None,
                "funding_account_name": funding_bank.account_name if funding_bank else None,
                "funding_company_name": funding["company_name"] if funding else None,
                "is_own_account": bool(funding and funding["is_own_account"]),
                "entry_id": f"topup-{t.topup_id}",
                "entry_type": "topup" if is_approved else "request",
                "record_id": t.topup_id,
                "company_id": t.company_id,
                "company_name": comp_map.get(t.company_id, t.company.company_name if t.company else "Unknown"),
                "entry_date": t.topup_date,
                "description": t.description or ("Top-up from sales" if is_approved else "Petty cash replenishment request"),
                "category": None,
                "reference_no": t.reference_no,
                "amount_requested": amt,
                "amount_in": amt if is_approved else ZERO,
                "amount_out": ZERO,
                "status": status_val,
                "endorsed_by": t.endorsed_by,
                "endorsed_at": t.endorsed_at,
                "finance_remark": t.finance_remark,
                "remark": t.remark,
                "reviewed_by": t.reviewed_by,
                "reviewed_at": t.reviewed_at,
                "created_at": t.created_at,
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
        return output

    def create_topup(self, topup_in: PettyCashTopUpCreate, current_user: Optional[AuthenticatedUser] = None) -> PettyCashTopUpOut:
        company = self.resolve_company(topup_in.company_id, topup_in.company_name or topup_in.company)
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
            amount=topup_in.amount,
            topup_date=topup_in.topup_date,
            reference_no=(topup_in.reference_no or "").strip() or None,
            description=(topup_in.description or "").strip() or None,
            bank_account_id=bank_id,
            status=status_to_use,
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
    ) -> PettyCashTopUpOut:
        topup = self.db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == topup_id).first()
        if not topup:
            raise HTTPException(status_code=404, detail="Petty cash transaction not found.")

        current_status = (topup.status or "").lower()
        if current_status == "approved":
            raise HTTPException(status_code=400, detail="This transaction is already approved and cannot be changed.")

        if not remark or not remark.strip():
            raise HTTPException(status_code=422, detail="A remark is required when endorsing or rejecting.")

        is_endorse = action.lower() == "endorse"

        #Finance must choose a funding bank before endorsing (not required for a rejection).
        if is_endorse and not (bank_account_id and str(bank_account_id).strip()):
            raise HTTPException(status_code=422, detail="Please choose a funding bank account before endorsing.")

        new_status = "Pending Audit Approval" if is_endorse else "Rejected by Finance"
        topup.status = new_status
        topup.finance_remark = remark.strip()
        topup.endorsed_by = endorser_name or "Finance Officer"
        topup.endorsed_at = func.now()
        if is_endorse:
            topup.bank_account_id = str(bank_account_id).strip()

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
        if current_status == "approved":
            raise HTTPException(status_code=400, detail="This transaction is already approved and cannot be changed.")

        if not remark or not remark.strip():
            raise HTTPException(status_code=422, detail="A remark is required when approving or disapproving.")

        is_approve = action.lower() == "approve"
        new_status = "Approved" if is_approve else "Disapproved by Audit"
        topup.status = new_status
        topup.remark = remark.strip()
        topup.reviewed_by = reviewer_name or "Internal Auditor"
        topup.reviewed_at = func.now()

        self.db.commit()
        self.db.refresh(topup)

        # Disapproval moves nothing.
        if is_approve:
            self._disburse_to_bank(topup)

        system_cache.invalidate_tag("petty_cash")
        system_cache.invalidate_tag("notifications")
        ws_manager.broadcast_sync({"type": "PETTY_CASH_UPDATED"})
        return self._topup_output(topup)

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
