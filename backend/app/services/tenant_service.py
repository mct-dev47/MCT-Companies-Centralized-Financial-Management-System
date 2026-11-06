"""
Tenant leases and payments 
"""
from __future__ import annotations

import calendar
import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload
from app.core.cache import system_cache

from app.core.company_resolver import resolve_company
from app.core.dependencies import AuthenticatedUser, check_company_access
from app.models.company import Company
from app.models.tenant import TenantLease, TenantLeasePayment
from app.models.user import User
from app.schemas.audit_review import PENDING_AUDIT

logger = logging.getLogger(__name__)

MAX_PERIODS = 1000
EPS = 0.005
REPEAT_MODES = ("None", "Daily", "Monthly", "Quarterly", "Annually")


# ---------------------------------------------------------------------------
# Period maths (same rules as frontend tenantScheduleService.ts, spec 0015)
# ---------------------------------------------------------------------------

def round2(value: float) -> float:
    return round(float(value) + 1e-9, 2)


def add_period_clamped(anchor: date, mode: str, n: int) -> date:
    """The n-th due date from the anchor. Keeps the anchor's day, clamped to the month length."""
    if mode == "Daily":
        return date.fromordinal(anchor.toordinal() + n)
    step = {"Monthly": 1, "Quarterly": 3, "Annually": 12}[mode]
    total_months = anchor.year * 12 + (anchor.month - 1) + n * step
    year, month = divmod(total_months, 12)
    month += 1
    day = min(anchor.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def count_periods(first: date, end: date, mode: str) -> int:
    """Due dates from `first` up to and including `end`. Stops one past MAX_PERIODS."""
    if mode not in ("Daily", "Monthly", "Quarterly", "Annually") or end < first:
        return 0
    if mode == "Daily":
        return min(MAX_PERIODS + 1, end.toordinal() - first.toordinal() + 1)
    count = 0
    while count <= MAX_PERIODS:
        try:
            due = add_period_clamped(first, mode, count)
        except (ValueError, OverflowError):  # past the last date a date can hold
            break
        if due > end:
            break
        count += 1
    return count


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _to_date(value: Any) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


# ---------------------------------------------------------------------------
# Stores
# ---------------------------------------------------------------------------

LEASE_COLUMNS = (
    "lease_id", "tenant_ref", "company_id", "tenant_name", "unit_name", "rent_amount",
    "contract_date", "due_date", "lease_end_date", "repeat_mode", "penalty_rate",
    "total_amount_payable", "status", "notes", "audit_status", "audited_by", "audited_at",
    "audit_remarks", "created_by", "created_at", "updated_at",
)
PAYMENT_COLUMNS = (
    "payment_id", "lease_id", "payment_date", "amount", "method", "reference_no", "notes",
    "status", "missed_reason", "period_index", "created_by", "created_at",
)


def _model_to_dict(obj: Any, columns: tuple) -> Dict[str, Any]:
    row: Dict[str, Any] = {}
    for col in columns:
        value = getattr(obj, col, None)
        if col in ("rent_amount", "penalty_rate", "total_amount_payable", "amount") and value is not None:
            value = float(value)
        elif isinstance(value, (date, datetime)):
            value = value.isoformat()
        row[col] = value
    return row


class SqlStore:
    """The tenant tables through SQLAlchemy."""

    def __init__(self, db: Session):
        self.db = db

    def _lease_row(self, lease: TenantLease) -> Dict[str, Any]:
        row = _model_to_dict(lease, LEASE_COLUMNS)
        row["payments"] = [_model_to_dict(p, PAYMENT_COLUMNS) for p in lease.payments]
        return row

    def list_leases(self, company_ids: Optional[List[int]]) -> List[Dict[str, Any]]:
        if company_ids is not None and not company_ids:
            return []
        q = self.db.query(TenantLease).options(selectinload(TenantLease.payments))
        if company_ids is not None:
            q = q.filter(TenantLease.company_id.in_(company_ids))
        return [self._lease_row(l) for l in q.order_by(TenantLease.lease_id.desc()).all()]

    def get_lease(self, lease_id: int) -> Optional[Dict[str, Any]]:
        lease = self.db.query(TenantLease).options(selectinload(TenantLease.payments)).filter(TenantLease.lease_id == lease_id).first()
        return self._lease_row(lease) if lease else None

    def list_refs(self, prefix: str) -> List[str]:
        rows = self.db.query(TenantLease.tenant_ref).filter(TenantLease.tenant_ref.like(f"{prefix}%")).all()
        return [r[0] for r in rows if r[0]]

    def find_recent_duplicate(self, company_id: int, tenant_name: str, unit_name: str, seconds: int = 5, contract_date: Optional[str] = None) -> Optional[Dict[str, Any]]:
        q = self.db.query(TenantLease).filter(
            TenantLease.company_id == company_id,
            func.lower(TenantLease.tenant_name) == tenant_name.strip().lower(),
            func.lower(TenantLease.unit_name) == unit_name.strip().lower(),
        )
        c_d = _to_date(contract_date) if contract_date else None
        if c_d is not None:
            q = q.filter(TenantLease.contract_date == c_d)
        leases = q.order_by(TenantLease.lease_id.desc()).all()
        now = datetime.now(timezone.utc)
        for lease in leases:
            if lease.created_at:
                created = lease.created_at
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                if abs((now - created).total_seconds()) <= seconds:
                    return self._lease_row(lease)
        return None

    def insert_lease(self, data: Dict[str, Any]) -> Dict[str, Any]:
        lease = TenantLease(**{k: (_to_date(v) if k in ("contract_date", "due_date", "lease_end_date") else v)
                               for k, v in data.items()})
        self.db.add(lease)
        try:
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        self.db.refresh(lease)
        return self._lease_row(lease)

    def update_lease(self, lease_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        lease = self.db.query(TenantLease).options(selectinload(TenantLease.payments)).filter(TenantLease.lease_id == lease_id).first()
        if lease is None:
            raise HTTPException(status_code=404, detail="Tenant lease not found.")
        for key, value in data.items():
            if key in ("contract_date", "due_date", "lease_end_date"):
                value = _to_date(value)
            elif key == "audited_at" and isinstance(value, str):
                value = datetime.fromisoformat(value)
            setattr(lease, key, value)
        try:
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        self.db.refresh(lease)
        return self._lease_row(lease)

    def delete_lease(self, lease_id: int) -> None:
        lease = self.db.query(TenantLease).options(selectinload(TenantLease.payments)).filter(TenantLease.lease_id == lease_id).first()
        if lease is not None:
            self.db.delete(lease)
            self.db.commit()

    def insert_payment(self, data: Dict[str, Any]) -> Dict[str, Any]:
        pay = TenantLeasePayment(**{k: (_to_date(v) if k == "payment_date" else v) for k, v in data.items()})
        self.db.add(pay)
        try:
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        self.db.refresh(pay)
        return _model_to_dict(pay, PAYMENT_COLUMNS)

    def update_payment(self, payment_id: int, data: Dict[str, Any]) -> None:
        pay = self.db.query(TenantLeasePayment).filter(TenantLeasePayment.payment_id == payment_id).first()
        if pay is None:
            raise HTTPException(status_code=404, detail="Payment not found.")
        for key, value in data.items():
            setattr(pay, key, _to_date(value) if key == "payment_date" else value)
        try:
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    def delete_payment(self, payment_id: int) -> None:
        pay = self.db.query(TenantLeasePayment).filter(TenantLeasePayment.payment_id == payment_id).first()
        if pay is not None:
            self.db.delete(pay)
            self.db.commit()


class SupabaseStore:
    """The tenant tables through the Supabase REST client (service role, so the API does the access checks)."""

    LEASES = "tenant_leases"
    PAYMENTS = "tenant_lease_payments"

    def __init__(self, client: Any):
        self.client = client

    def _attach_payments(self, leases: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        by_lease: Dict[int, List[Dict[str, Any]]] = {l["lease_id"]: [] for l in leases}
        ids = list(by_lease.keys())
        for i in range(0, len(ids), 100):
            chunk = ids[i:i + 100]
            res = self.client.table(self.PAYMENTS).select("*").in_("lease_id", chunk).execute()
            for p in res.data or []:
                by_lease.setdefault(p["lease_id"], []).append(p)
        for lease in leases:
            pays = by_lease.get(lease["lease_id"], [])
            pays.sort(key=lambda p: (str(p.get("payment_date")), p.get("payment_id") or 0), reverse=True)
            lease["payments"] = pays
        return leases

    def list_leases(self, company_ids: Optional[List[int]]) -> List[Dict[str, Any]]:
        if company_ids is not None and not company_ids:
            return []
        q = self.client.table(self.LEASES).select("*")
        if company_ids is not None:
            q = q.in_("company_id", company_ids)
        res = q.order("lease_id", desc=True).execute()
        return self._attach_payments(list(res.data or []))

    def get_lease(self, lease_id: int) -> Optional[Dict[str, Any]]:
        res = self.client.table(self.LEASES).select("*").eq("lease_id", lease_id).limit(1).execute()
        if not res.data:
            return None
        return self._attach_payments([res.data[0]])[0]

    def list_refs(self, prefix: str) -> List[str]:
        res = self.client.table(self.LEASES).select("tenant_ref").like("tenant_ref", f"{prefix}%").execute()
        return [r["tenant_ref"] for r in res.data or []]

    def insert_lease(self, data: Dict[str, Any]) -> Dict[str, Any]:
        res = self.client.table(self.LEASES).insert(data).execute()
        row = res.data[0]
        row["payments"] = []
        return row

    def update_lease(self, lease_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        payload = dict(data)
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        self.client.table(self.LEASES).update(payload).eq("lease_id", lease_id).execute()
        row = self.get_lease(lease_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Tenant lease not found.")
        return row

    def delete_lease(self, lease_id: int) -> None:
        self.client.table(self.PAYMENTS).delete().eq("lease_id", lease_id).execute()
        self.client.table(self.LEASES).delete().eq("lease_id", lease_id).execute()

    def insert_payment(self, data: Dict[str, Any]) -> Dict[str, Any]:
        res = self.client.table(self.PAYMENTS).insert(data).execute()
        return res.data[0]

    def update_payment(self, payment_id: int, data: Dict[str, Any]) -> None:
        self.client.table(self.PAYMENTS).update(data).eq("payment_id", payment_id).execute()

    def delete_payment(self, payment_id: int) -> None:
        self.client.table(self.PAYMENTS).delete().eq("payment_id", payment_id).execute()


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

def _supabase_client() -> Any:
    """The Supabase client, or None when it is not configured. Kept separate so tests can replace it."""
    from app.core.config import settings
    if not settings.SUPABASE_URL or not (settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_KEY):
        return None
    from app.db.supabase import get_supabase_admin_client
    return get_supabase_admin_client()


def extract_company_code(company_name: Optional[str]) -> str:
    """Extract clean company code for tenant reference formatting."""
    if not company_name:
        return "JK"
    name = company_name.strip()
    upper = name.upper()
    if upper.startswith("JK"):
        return "JK"
    if upper.startswith("FILCAP") or upper.startswith("FILCAM"):
        return "FILCAP"
    if upper.startswith("MCT"):
        return "MCT"
    parts = name.split()
    first_word = "".join(c for c in parts[0] if c.isalnum()).upper()
    return first_word if first_word else "JK"


class TenantService:
    def __init__(self, db: Session, *, use_supabase: bool = True):
        self.db = db
        self.sql = SqlStore(db)
        self._use_supabase = use_supabase
        self._sb: Optional[SupabaseStore] = None

    # -- store plumbing ---------------------------------------------------
    def _supabase(self) -> Optional[SupabaseStore]:
        if not self._use_supabase:
            return None
        if self._sb is None:
            try:
                client = _supabase_client()
            except Exception as exc:
                logger.warning("Supabase client unavailable for tenants: %s", exc)
                return None
            if client is None:
                return None
            self._sb = SupabaseStore(client)
        return self._sb

    def _run(self, name: str, *args: Any) -> Any:
        sb = self._supabase()
        if sb is not None:
            try:
                return getattr(sb, name)(*args)
            except HTTPException:
                raise
            except Exception as exc:
                logger.warning("Supabase tenant call %s failed, using the SQL store: %s", name, exc)
        return getattr(self.sql, name)(*args)

    # -- output -----------------------------------------------------------
    def _company_names(self, ids: List[int]) -> Dict[int, str]:
        if not ids:
            return {}
        rows = self.db.query(Company.company_id, Company.company_name).filter(Company.company_id.in_(ids)).all()
        return {r[0]: r[1] for r in rows}

    def _user_names(self, ids: List[int]) -> Dict[int, str]:
        valid_ids = [i for i in ids if i is not None]
        if not valid_ids:
            return {}
        rows = self.db.query(User.user_id, User.name).filter(User.user_id.in_(valid_ids)).all()
        return {r[0]: r[1] for r in rows}

    def to_out(
        self,
        row: Dict[str, Any],
        names: Optional[Dict[int, str]] = None,
        user_names: Optional[Dict[int, str]] = None,
    ) -> Dict[str, Any]:
        payments = row.get("payments") or []
        paid = round2(sum(float(p.get("amount") or 0) for p in payments if p.get("status") != "Missed"))
        total = float(row.get("total_amount_payable") or 0)
        names = names if names is not None else self._company_names([row["company_id"]])
        if user_names is None:
            user_ids = [p.get("created_by") for p in payments if p.get("created_by") is not None]
            if row.get("created_by") is not None:
                user_ids.append(row.get("created_by"))
            user_names = self._user_names(user_ids)
        out = {k: row.get(k) for k in LEASE_COLUMNS}
        for key in ("rent_amount", "penalty_rate", "total_amount_payable"):
            out[key] = float(out[key]) if out.get(key) is not None else None
        out["audit_status"] = out.get("audit_status") or PENDING_AUDIT
        for key in ("audited_at", "created_at", "updated_at"):
            out[key] = _iso(out.get(key))
        out["company_name"] = names.get(row["company_id"])
        out["amount_paid"] = paid
        out["remaining_balance"] = max(0.0, round2(total - paid))
        out["created_by_name"] = user_names.get(row.get("created_by"))
        out["payments"] = [
            {
                **{k: p.get(k) for k in PAYMENT_COLUMNS},
                "amount": float(p.get("amount") or 0),
                "created_at": _iso(p.get("created_at")),
                "created_by_name": user_names.get(p.get("created_by")),
            }
            for p in payments
        ]
        return out

    # -- reads ------------------------------------------------------------
    def list_leases(self, company_ids: Optional[List[int]]) -> List[Dict[str, Any]]:
        rows = self._run("list_leases", company_ids)
        names = self._company_names(sorted({r["company_id"] for r in rows}))
        user_ids = set()
        for r in rows:
            if r.get("created_by") is not None:
                user_ids.add(r.get("created_by"))
            for p in r.get("payments") or []:
                if p.get("created_by") is not None:
                    user_ids.add(p.get("created_by"))
        user_names = self._user_names(list(user_ids))
        return [self.to_out(r, names, user_names) for r in rows]

    def get_row(self, lease_id: int, user: AuthenticatedUser) -> Dict[str, Any]:
        row = self._run("get_lease", lease_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Tenant lease not found.")
        check_company_access(user, row["company_id"])
        return row

    def get_lease(self, lease_id: int, user: AuthenticatedUser) -> Dict[str, Any]:
        return self.to_out(self.get_row(lease_id, user))

    # -- validation -------------------------------------------------------
    @staticmethod
    def _cap(row: Dict[str, Any]) -> float:
        """The most money a lease can take: Total Payable, or rent times periods plus the late penalty."""
        mode = row.get("repeat_mode") or "None"
        if mode == "None":
            return float(row.get("total_amount_payable") or 0)
        count = count_periods(_to_date(row["due_date"]), _to_date(row["lease_end_date"]), mode)
        penalty = float(row.get("penalty_rate") or 0)
        return round2(float(row["rent_amount"]) * count * (1 + penalty / 100))

    @staticmethod
    def _paid_sum(payments: List[Dict[str, Any]], skip_id: Optional[int] = None) -> float:
        return round2(sum(
            float(p.get("amount") or 0)
            for p in payments
            if p.get("status") != "Missed" and p.get("payment_id") != skip_id
        ))

    def _normalise_lease(self, merged: Dict[str, Any]) -> Dict[str, Any]:
        """Check a whole lease and fill the values the server owns. Raises 400 with a clear message."""
        def bad(message: str) -> None:
            raise HTTPException(status_code=400, detail=message)

        if not str(merged.get("tenant_name") or "").strip():
            bad("Tenant name is required.")
        if not str(merged.get("unit_name") or "").strip():
            bad("Leased unit is required.")
        rent = float(merged.get("rent_amount") or 0)
        if rent <= 0:
            bad("Rent amount must be greater than 0.")
        merged["rent_amount"] = round2(rent)

        contract = _to_date(merged.get("contract_date"))
        first_due = _to_date(merged.get("due_date"))
        if contract is None or first_due is None:
            bad("Date contracted and due date are required.")
        end_date = _to_date(merged.get("lease_end_date"))
        for label, value in (("Date contracted", contract), ("Due date", first_due), ("Lease end date", end_date)):
            if value is not None and not (1990 <= value.year <= 2100):
                bad(f"{label} must be between the years 1990 and 2100.")
        mode = merged.get("repeat_mode") or "None"
        if mode not in REPEAT_MODES:
            bad("Repeat must be None, Daily, Monthly, Quarterly or Annually.")
        merged["repeat_mode"] = mode

        penalty = merged.get("penalty_rate")
        if penalty is not None:
            penalty = float(penalty)
            if penalty < 0 or penalty > 100:
                bad("Late penalty must be blank or a number from 0 to 100.")
            merged["penalty_rate"] = round2(penalty)

        if mode == "None":
            merged["lease_end_date"] = None
            merged["penalty_rate"] = None
            total = merged.get("total_amount_payable")
            total = float(total) if total not in (None, "") else rent
            if total <= 0:
                bad("Total amount payable must be greater than 0.")
            merged["total_amount_payable"] = round2(total)
        else:
            end = _to_date(merged.get("lease_end_date"))
            if end is None:
                bad("Lease end date is required for a repeating lease.")
            if first_due < contract:
                bad("First due date cannot be before the date contracted.")
            if end < first_due:
                bad("Lease end date must be on or after the first due date.")
            count = count_periods(first_due, end, mode)
            if count < 1:
                bad("The schedule needs at least 1 payment.")
            if count > MAX_PERIODS:
                bad(f"The schedule cannot have more than {MAX_PERIODS} payments.")
            merged["total_amount_payable"] = round2(rent * count)

        for key in ("contract_date", "due_date", "lease_end_date"):
            merged[key] = _iso(_to_date(merged.get(key)))
        return merged

    def _check_locks_and_cap(self, old: Dict[str, Any], new: Dict[str, Any]) -> None:
        payments = old.get("payments") or []
        old_mode = old.get("repeat_mode") or "None"
        if old_mode != "None" and any(p.get("period_index") for p in payments):
            if new["repeat_mode"] != old_mode:
                raise HTTPException(status_code=409, detail="Repeat cannot be changed because payments are already recorded against its periods.")
            if str(new["due_date"]) != str(old["due_date"])[:10]:
                raise HTTPException(status_code=409, detail="First due date cannot be changed because payments are already recorded against its periods.")
            if new["repeat_mode"] != "None":
                last = max((p.get("period_index") or 0) for p in payments)
                count = count_periods(_to_date(new["due_date"]), _to_date(new["lease_end_date"]), new["repeat_mode"])
                if count < last:
                    raise HTTPException(status_code=409, detail=f"Lease end date cannot be moved earlier than period {last}, which already has a payment.")
        if self._paid_sum(payments) - self._cap(new) > EPS:
            raise HTTPException(status_code=409, detail="The recorded payments are more than the new total due. Increase the rent or move the lease end date later.")

    @staticmethod
    def _audit_reset(row: Dict[str, Any]) -> Dict[str, Any]:
        """Any change to the lease or its payments sends the audit result back to pending."""
        if (row.get("audit_status") or PENDING_AUDIT) == PENDING_AUDIT:
            return {}
        return {"audit_status": PENDING_AUDIT, "audited_by": None, "audited_at": None, "audit_remarks": None}

    # -- leases -----------------------------------------------------------
    def _next_ref(self, company_code: str = "JK") -> str:
        year = date.today().year
        prefix = f"TNT-{company_code}-{year}-"
        refs = self._run("list_refs", prefix)
        numbers = []
        for r in refs:
            if r.startswith(prefix):
                suffix = r[len(prefix):]
                parts = suffix.split("-")
                if parts[0].isdigit():
                    numbers.append(int(parts[0]))
        next_num = (max(numbers) if numbers else 0) + 1
        return f"{prefix}{next_num:03d}"

    def create_lease(self, body: Any, user: AuthenticatedUser) -> Dict[str, Any]:
        # The resolver falls back to the first company when none is named. A lease must never land in a
        # company by accident, so the caller has to say which one.
        name = (body.company_name or "").strip()
        if not body.company_id and (not name or name.lower() == "all companies"):
            raise HTTPException(status_code=400, detail="A company is required for a tenant lease.")
        company = resolve_company(self.db, company_id=body.company_id, company_name=body.company_name)
        check_company_access(user, company.company_id)

        merged = self._normalise_lease({
            "tenant_name": body.tenant_name.strip(),
            "unit_name": body.unit_name.strip(),
            "rent_amount": body.rent_amount,
            "contract_date": body.contract_date,
            "due_date": body.due_date,
            "lease_end_date": body.lease_end_date,
            "repeat_mode": body.repeat_mode,
            "penalty_rate": body.penalty_rate,
            "total_amount_payable": body.total_amount_payable,
        })

        # Check duplicate submission within 5-second window (AC-2)
        norm_name = body.tenant_name.strip().lower()
        norm_unit = body.unit_name.strip().lower()
        c_date = str(body.contract_date or "")
        dedup_key = f"tenant_lease_create:{company.company_id}:{norm_name}:{norm_unit}:{c_date}"

        if system_cache.get(dedup_key):
            raise HTTPException(
                status_code=409,
                detail="A lease for this tenant and unit was recently submitted. Please wait a moment before trying again.",
            )

        recent_dup = self._run("find_recent_duplicate", company.company_id, norm_name, norm_unit, 5, c_date)
        if recent_dup:
            raise HTTPException(
                status_code=409,
                detail="A lease for this tenant and unit was recently submitted. Please wait a moment before trying again.",
            )

        data = {
            **merged,
            "company_id": company.company_id,
            "status": body.status,
            "notes": (body.notes or "").strip() or None,
            "audit_status": PENDING_AUDIT,
            "audited_by": None,
            "audited_at": None,
            "audit_remarks": None,
            "created_by": user.get("user_id"),
        }

        # Set deduplication lock in cache before insert attempt
        system_cache.set(dedup_key, True, ttl=5)

        company_code = extract_company_code(company.company_name)
        last_error: Optional[Exception] = None
        for _ in range(5):
            data["tenant_ref"] = self._next_ref(company_code)
            try:
                row = self._run("insert_lease", data)
                system_cache.invalidate_tag("notifications")
                return self.to_out(row)
            except HTTPException:
                system_cache._delete_key(dedup_key)
                raise
            except Exception as exc:  # collision on tenant_ref or concurrent insert
                last_error = exc
                logger.warning("Tenant lease insert retry: %s", exc)

        system_cache._delete_key(dedup_key)
        # Keep the database's own error text in the server log only. It can name tables, columns or hosts.
        logger.error("Tenant lease could not be saved after retries: %s", last_error)
        raise HTTPException(status_code=500, detail="Could not save the tenant lease. Please try again.")

    def update_lease(self, lease_id: int, body: Any, user: AuthenticatedUser) -> Dict[str, Any]:
        old = self.get_row(lease_id, user)
        provided = body.model_dump(exclude_unset=True)
        clear_penalty = provided.pop("clear_penalty_rate", False)
        clear_end = provided.pop("clear_lease_end_date", False)

        merged = {k: old.get(k) for k in (
            "tenant_name", "unit_name", "rent_amount", "contract_date", "due_date", "lease_end_date",
            "repeat_mode", "penalty_rate", "total_amount_payable",
        )}
        for key, value in provided.items():
            if key in merged:
                merged[key] = value
        if clear_penalty:
            merged["penalty_rate"] = None
        if clear_end:
            merged["lease_end_date"] = None
        # When the repeat changes, the server recalculates the total unless the caller sent one.
        if "total_amount_payable" not in provided and (old.get("repeat_mode") or "None") != "None" and merged["repeat_mode"] == "None":
            merged["total_amount_payable"] = old.get("total_amount_payable")
        if isinstance(merged["tenant_name"], str):
            merged["tenant_name"] = merged["tenant_name"].strip()
        if isinstance(merged["unit_name"], str):
            merged["unit_name"] = merged["unit_name"].strip()

        merged = self._normalise_lease(merged)
        self._check_locks_and_cap({**old, "payments": old.get("payments") or []}, {**old, **merged})

        update = dict(merged)
        if "status" in provided:
            update["status"] = provided["status"]
        if "notes" in provided:
            update["notes"] = (provided["notes"] or "").strip() or None
        update.update(self._audit_reset(old))
        row = self._run("update_lease", lease_id, update)
        system_cache.invalidate_tag("notifications")
        return self.to_out(row)

    def delete_lease(self, lease_id: int, user: AuthenticatedUser) -> Dict[str, Any]:
        row = self.get_row(lease_id, user)
        self._run("delete_lease", lease_id)
        system_cache.invalidate_tag("notifications")
        return row

    # -- payments ---------------------------------------------------------
    def _payment_data(self, lease: Dict[str, Any], body: Any, skip_id: Optional[int]) -> Dict[str, Any]:
        def bad(message: str) -> None:
            raise HTTPException(status_code=400, detail=message)

        mode = lease.get("repeat_mode") or "None"
        repeating = mode != "None"
        count = 0
        if repeating:
            count = count_periods(_to_date(lease["due_date"]), _to_date(lease["lease_end_date"]), mode)

        period = body.period_index
        if repeating:
            if period is None or period < 1 or period > count:
                bad(f"Pick a period from 1 to {count} for this lease.")
        else:
            period = None

        if body.status == "Missed":
            if repeating and mode != "Daily":
                bad("A missed mark can only be added to a lease that does not repeat or repeats daily.")
            return {
                "payment_date": _iso(body.payment_date),
                "amount": 0,
                "method": "N/A",
                "reference_no": "MISSED",
                "notes": (body.notes or "").strip() or None,
                "status": "Missed",
                "missed_reason": (body.missed_reason or "").strip() or None,
                "period_index": period,
            }

        amount = round2(body.amount)
        if amount <= 0:
            bad("Payment amount must be greater than 0.")
        if self._paid_sum(lease.get("payments") or [], skip_id) + amount - self._cap(lease) > EPS:
            bad("This payment puts more money on the lease than it can owe.")
        return {
            "payment_date": _iso(body.payment_date),
            "amount": amount,
            "method": (body.method or "Cash").strip(),
            "reference_no": (body.reference_no or "").strip() or None,
            "notes": (body.notes or "").strip() or None,
            "status": "Paid",
            "missed_reason": None,
            "period_index": period,
        }

    def _after_payment_change(self, lease: Dict[str, Any]) -> Dict[str, Any]:
        reset = self._audit_reset(lease)
        if reset:
            self._run("update_lease", lease["lease_id"], reset)
        system_cache.invalidate_tag("notifications")
        return self.to_out(self._run("get_lease", lease["lease_id"]))

    def add_payment(self, lease_id: int, body: Any, user: AuthenticatedUser) -> Dict[str, Any]:
        lease = self.get_row(lease_id, user)
        data = self._payment_data(lease, body, None)
        data.update({"lease_id": lease_id, "created_by": user.get("user_id")})
        self._run("insert_payment", data)
        return self._after_payment_change(lease)

    def _find_payment(self, lease: Dict[str, Any], payment_id: int) -> Dict[str, Any]:
        for p in lease.get("payments") or []:
            if p.get("payment_id") == payment_id:
                return p
        raise HTTPException(status_code=404, detail="Payment not found on this lease.")

    def update_payment(self, lease_id: int, payment_id: int, body: Any, user: AuthenticatedUser) -> Dict[str, Any]:
        lease = self.get_row(lease_id, user)
        self._find_payment(lease, payment_id)
        data = self._payment_data(lease, body, payment_id)
        self._run("update_payment", payment_id, data)
        return self._after_payment_change(lease)

    def delete_payment(self, lease_id: int, payment_id: int, user: AuthenticatedUser) -> Dict[str, Any]:
        lease = self.get_row(lease_id, user)
        self._find_payment(lease, payment_id)
        self._run("delete_payment", payment_id)
        return self._after_payment_change(lease)

    # -- audit review -----------------------------------------------------
    def save_audit_review(self, lease_id: int, status: str, remarks: Optional[str], auditor_name: str,
                          user: AuthenticatedUser) -> Dict[str, Any]:
        lease = self.get_row(lease_id, user)
        if status == PENDING_AUDIT:
            data = {"audit_status": PENDING_AUDIT, "audited_by": None, "audited_at": None, "audit_remarks": None}
        else:
            data = {
                "audit_status": status,
                "audited_by": auditor_name,
                "audited_at": datetime.now(timezone.utc).isoformat(),
                "audit_remarks": (remarks or "").strip() or None,
            }
        row = self._run("update_lease", lease["lease_id"], data)
        system_cache.invalidate_tag("notifications")
        return self.to_out(row)
