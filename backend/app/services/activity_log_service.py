"""
activity_log_service.py
-----------------------
Dedicated service for managing and querying activity logs stored in the
Supabase audit_logs table, with event-driven record creation, user/company
enrichment, search filtering, and an automated 6-month retention policy.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.core.events import ActivityEvent
from app.db.session import SessionLocal
from app.db.supabase import get_supabase_admin_client
from app.models.audit_log import AuditLog
from app.models.company import Company
from app.models.user import User
from app.schemas.activity_log import ActivityLogOut

logger = logging.getLogger(__name__)

# Module prefixes for categorizing logs in the UI
_MODULE_PREFIXES = (
    ("SALE_", "Sales"),
    ("EXPENSE_", "Expense"),
    ("LOAN_", "Loan"),
    ("PETTY_CASH_", "Petty Cash"),
    ("TENANT_", "Tenant"),
    ("USER_", "User"),
    ("COMPANY_", "Company"),
    ("CASH_INFLOW_", "Cash Inflow"),
    ("BUDGET_", "Budget"),
    ("STAFF_CREDIT_", "Staff Credit"),
    ("CATEGORY_", "Category"),
    ("BANK_", "Bank"),
    ("LOGIN", "Auth"),
    ("LOGOUT", "Auth"),
    ("SESSION_", "Auth"),
    ("ACCOUNT_", "Auth"),
    ("PASSWORD_", "Auth"),
    ("FORGOT_PASSWORD", "Auth"),
)

_ACTION_DESCRIPTIONS: Dict[str, str] = {
    "LOGIN_ATTEMPT": "User attempted to log in",
    "LOGIN_SUCCESS": "User logged in successfully",
    "LOGIN_FAILED": "User login attempt failed",
    "LOGIN_OTP_SENT": "Login OTP code sent to user",
    "LOGIN_OTP_VERIFIED": "Login OTP verified successfully",
    "LOGIN_OTP_FAILED": "Login OTP verification failed",
    "LOGIN_OTP_RESENT": "Login OTP resent to user",
    "LOGOUT": "User logged out",
    "SESSION_EXPIRED": "User session expired",
    "ACCOUNT_LOCKED": "Account temporarily locked due to failed attempts",
    "FORGOT_PASSWORD_REQUEST": "Password reset requested",
    "PASSWORD_RESET_SUCCESS": "Password reset completed successfully",
    "PASSWORD_RESET_FAILED": "Password reset attempt failed",
    "PASSWORD_CHANGED": "User changed their password",
    "USER_CREATED": "New user account created",
    "USER_UPDATED": "User account updated",
    "USER_DELETED": "User account deleted",
    "USER_ROLE_CHANGED": "User role or permissions changed",
    "USER_VIEWED": "User account details viewed",
    "COMPANY_CREATED": "New company created",
    "COMPANY_UPDATED": "Company details updated",
    "COMPANY_DELETED": "Company deleted",
    "COMPANY_VIEWED": "Company details viewed",
    "EXPENSE_CREATED": "Expense recorded",
    "EXPENSE_UPDATED": "Expense record updated",
    "EXPENSE_DELETED": "Expense record deleted",
    "EXPENSE_VIEWED": "Expense details viewed",
    "SALE_CREATED": "Sale recorded",
    "SALE_UPDATED": "Sale record updated",
    "SALE_DELETED": "Sale record deleted",
    "SALE_VIEWED": "Sale details viewed",
    "CASH_INFLOW_CREATED": "Cash inflow recorded",
    "CASH_INFLOW_UPDATED": "Cash inflow updated",
    "CASH_INFLOW_DELETED": "Cash inflow deleted",
    "LOAN_CREATED": "Loan facility recorded",
    "LOAN_UPDATED": "Loan details updated",
    "LOAN_DELETED": "Loan deleted",
    "PETTY_CASH_TOPUP_CREATED": "Petty cash replenishment recorded",
    "PETTY_CASH_TOPUP_DELETED": "Petty cash replenishment deleted",
    "PETTY_CASH_WALLET_UPDATED": "Petty cash wallet adjusted",
    "TENANT_LEASE_CREATED": "Tenant lease created",
    "TENANT_LEASE_UPDATED": "Tenant lease updated",
    "TENANT_LEASE_DELETED": "Tenant lease deleted",
    "TENANT_PAYMENT_RECORDED": "Tenant rent payment recorded",
    "TENANT_PAYMENT_UPDATED": "Tenant rent payment updated",
    "TENANT_PAYMENT_REMOVED": "Tenant rent payment removed",
    "TENANT_AUDIT_REVIEWED": "Tenant lease audit status changed",
    "CATEGORY_CREATED": "Financial category added",
    "CATEGORY_UPDATED": "Financial category modified",
    "CATEGORY_DELETED": "Financial category removed",
}


def _module_for(action: str, category: Optional[str]) -> str:
    for prefix, module in _MODULE_PREFIXES:
        if action.startswith(prefix):
            return module
    return (category or "General").replace("_", " ").title()


def _parse_details(raw: Optional[Any]) -> dict:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        data = json.loads(str(raw))
        return data if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        return {"note": str(raw)}


def _target_for(details: dict) -> str:
    if details.get("record_ref"):
        return str(details["record_ref"])
    if details.get("ref"):
        return str(details["ref"])
    if details.get("reference_no"):
        return str(details["reference_no"])
    if details.get("record_id") is not None:
        kind = str(details.get("record_type") or "").replace("_", " ").strip()
        return f"{kind} #{details['record_id']}".strip() if kind else f"#{details['record_id']}"
    if details.get("email"):
        return str(details["email"])
    if details.get("name"):
        return str(details["name"])
    return "-"


class ActivityLogService:
    """
    Core service for recording and retrieving audit/activity logs from Supabase.
    """

    def record_activity(self, event: ActivityEvent) -> Optional[int]:
        """
        Persist an ActivityEvent to the Supabase audit_logs table,
        with fallback to local database sync.
        """
        details_str: Optional[str] = None
        if event.details is not None:
            if isinstance(event.details, dict):
                try:
                    details_str = json.dumps(event.details, default=str)
                except Exception:
                    details_str = str(event.details)
            else:
                details_str = str(event.details)

        ip = event.ip_address[:45] if event.ip_address else None
        created_at_iso = event.created_at.isoformat()

        inserted_id: Optional[int] = None

        # 1. Primary write to Supabase audit_logs table
        try:
            client = get_supabase_admin_client()
            row = {
                "action": event.action,
                "action_category": event.action_category or "GENERAL",
                "user_id": event.user_id,
                "company_id": event.company_id,
                "ip_address": ip,
                "details": details_str,
                "created_at": created_at_iso,
            }
            res = client.table("audit_logs").insert(row).execute()
            if res.data and len(res.data) > 0:
                inserted_id = res.data[0].get("audit_log_id")
        except Exception as exc:
            logger.warning("Supabase direct insert to audit_logs failed: %s", exc)

        # 2. Local database fallback/synchronization
        try:
            session = SessionLocal()
            try:
                entry = AuditLog(
                    audit_log_id=inserted_id if inserted_id else None,
                    user_id=event.user_id,
                    company_id=event.company_id,
                    action=event.action,
                    action_category=event.action_category or "GENERAL",
                    ip_address=ip,
                    details=details_str,
                )
                session.add(entry)
                session.commit()
                if not inserted_id:
                    inserted_id = entry.audit_log_id
            finally:
                session.close()
        except Exception as exc:
            logger.debug("Local DB sync for audit log skipped/failed: %s", exc)

        return inserted_id

    def get_activity_logs(
        self,
        *,
        search: Optional[str] = None,
        user_id: Optional[int] = None,
        company_id: Optional[int] = None,
        module: Optional[str] = None,
        action_category: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        limit: int = 100,
        offset: int = 0,
        db: Optional[Session] = None,
    ) -> Tuple[List[ActivityLogOut], int]:
        """
        Query activity logs strictly from Supabase audit_logs table,
        falling back to local DB if Supabase client is unreachable.
        Returns a tuple of (enriched_logs, total_count).
        """
        raw_rows: List[dict] = []
        total_count: int = 0

        # Try Supabase first
        try:
            client = get_supabase_admin_client()
            q = client.table("audit_logs").select(
                "audit_log_id,user_id,company_id,action,action_category,ip_address,details,created_at",
                count="exact",
            )

            if user_id is not None:
                q = q.eq("user_id", user_id)
            if company_id is not None:
                q = q.eq("company_id", company_id)
            if action_category:
                q = q.eq("action_category", action_category.upper())
            if start_date:
                q = q.gte("created_at", start_date.isoformat())
            if end_date:
                q = q.lte("created_at", f"{end_date.isoformat()}T23:59:59")

            # PostgREST query execution with pagination
            res = (
                q.order("created_at", desc=True)
                .range(offset, offset + limit - 1)
                .execute()
            )
            raw_rows = res.data or []
            total_count = res.count if res.count is not None else len(raw_rows)

        except Exception as exc:
            logger.warning("Failed to fetch audit_logs from Supabase, attempting local fallback: %s", exc)
            # Local DB Fallback
            close_session = False
            if db is None:
                db = SessionLocal()
                close_session = True
            try:
                local_q = db.query(AuditLog)
                if user_id is not None:
                    local_q = local_q.filter(AuditLog.user_id == user_id)
                if company_id is not None:
                    local_q = local_q.filter(AuditLog.company_id == company_id)
                if action_category:
                    local_q = local_q.filter(AuditLog.action_category == action_category.upper())
                if start_date:
                    local_q = local_q.filter(AuditLog.created_at >= start_date.isoformat())
                if end_date:
                    local_q = local_q.filter(AuditLog.created_at <= f"{end_date.isoformat()}T23:59:59")

                total_count = local_q.count()
                db_rows = (
                    local_q.order_by(AuditLog.created_at.desc())
                    .offset(offset)
                    .limit(limit)
                    .all()
                )
                raw_rows = [
                    {
                        "audit_log_id": r.audit_log_id,
                        "user_id": r.user_id,
                        "company_id": r.company_id,
                        "action": r.action,
                        "action_category": r.action_category,
                        "ip_address": r.ip_address,
                        "details": r.details,
                        "created_at": str(r.created_at) if r.created_at else None,
                    }
                    for r in db_rows
                ]
            finally:
                if close_session:
                    db.close()

        # Transform and enrich with names and descriptions
        enriched = self._enrich_logs(raw_rows, db=db)

        # Apply client-side module or search filters if supplied
        if module:
            m_lower = module.strip().lower()
            enriched = [l for l in enriched if l.module.lower() == m_lower]

        if search:
            q_str = search.strip().lower()
            enriched = [
                l for l in enriched
                if q_str in l.company_name.lower()
                or q_str in l.user_name.lower()
                or q_str in l.action.lower()
                or q_str in l.description.lower()
                or q_str in l.module.lower()
                or q_str in l.target.lower()
            ]

        return enriched, total_count

    def get_activity_log_by_id(self, audit_log_id: int) -> Optional[ActivityLogOut]:
        """Retrieve and enrich a single activity log entry."""
        try:
            client = get_supabase_admin_client()
            res = client.table("audit_logs").select("*").eq("audit_log_id", audit_log_id).limit(1).execute()
            if res.data and len(res.data) > 0:
                enriched = self._enrich_logs([res.data[0]])
                return enriched[0] if enriched else None
        except Exception:
            pass

        # Fallback to local DB
        session = SessionLocal()
        try:
            entry = session.query(AuditLog).filter(AuditLog.audit_log_id == audit_log_id).first()
            if not entry:
                return None
            enriched = self._enrich_logs([{
                "audit_log_id": entry.audit_log_id,
                "user_id": entry.user_id,
                "company_id": entry.company_id,
                "action": entry.action,
                "action_category": entry.action_category,
                "ip_address": entry.ip_address,
                "details": entry.details,
                "created_at": str(entry.created_at) if entry.created_at else None,
            }], db=session)
            return enriched[0] if enriched else None
        finally:
            session.close()

    def cleanup_expired_logs(self, retention_days: int = 180) -> int:
        """
        Data Retention Policy: Purge all activity logs older than retention_days (default: 180 days / 6 months).
        Returns the number of deleted records.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        cutoff_iso = cutoff.isoformat()
        purged_count = 0

        # 1. Purge from Supabase audit_logs
        try:
            client = get_supabase_admin_client()
            res = client.table("audit_logs").delete().lt("created_at", cutoff_iso).execute()
            if res.data:
                purged_count += len(res.data)
            logger.info("Purged %d expired audit logs from Supabase older than %s", len(res.data or []), cutoff_iso)
        except Exception as exc:
            logger.warning("Failed to purge expired logs from Supabase: %s", exc)

        # 2. Purge from local SQLite/Postgres DB
        try:
            session = SessionLocal()
            try:
                local_deleted = session.query(AuditLog).filter(AuditLog.created_at < cutoff).delete(synchronize_session=False)
                session.commit()
                if purged_count == 0:
                    purged_count = local_deleted
                logger.info("Purged %d expired audit logs from local DB", local_deleted)
            finally:
                session.close()
        except Exception as exc:
            logger.debug("Local DB retention purge skipped or failed: %s", exc)

        return purged_count

    def _enrich_logs(self, rows: List[dict], db: Optional[Session] = None) -> List[ActivityLogOut]:
        """
        Enrich raw audit rows with readable user names, company names,
        descriptions, module categories, and target references.
        """
        user_ids = sorted({r.get("user_id") for r in rows if r.get("user_id") is not None})
        company_ids = sorted({r.get("company_id") for r in rows if r.get("company_id") is not None})

        users: Dict[int, str] = {}
        companies: Dict[int, str] = {}

        # Look up names via Supabase
        try:
            client = get_supabase_admin_client()
            if user_ids:
                u_res = client.table("users").select("user_id,name").in_("user_id", user_ids).execute()
                if u_res.data:
                    for u in u_res.data:
                        users[u["user_id"]] = u.get("name") or "User"
            if company_ids:
                c_res = client.table("company").select("company_id,company_name").in_("company_id", company_ids).execute()
                if c_res.data:
                    for c in c_res.data:
                        companies[c["company_id"]] = c.get("company_name") or "Company"
        except Exception:
            pass

        # If any remain missing, look up from DB session if available
        if (len(users) < len(user_ids) or len(companies) < len(company_ids)) and db is not None:
            try:
                missing_u = [uid for uid in user_ids if uid not in users]
                if missing_u:
                    for u in db.query(User.user_id, User.name).filter(User.user_id.in_(missing_u)).all():
                        users[u[0]] = u[1]
                missing_c = [cid for cid in company_ids if cid not in companies]
                if missing_c:
                    for c in db.query(Company.company_id, Company.company_name).filter(Company.company_id.in_(missing_c)).all():
                        companies[c[0]] = c[1]
            except Exception:
                pass

        results: List[ActivityLogOut] = []
        for r in rows:
            details = _parse_details(r.get("details"))
            action = str(r.get("action") or "")
            category = r.get("action_category")

            user_name = users.get(r.get("user_id")) or (str(details["email"]) if details.get("email") else "System")
            company_name = companies.get(r.get("company_id")) or "System"
            description = _ACTION_DESCRIPTIONS.get(action) or action.replace("_", " ").capitalize()
            module = _module_for(action, category)
            target = _target_for(details)

            ip_address = r.get("ip_address") or details.get("ip_address") or details.get("ip")
            severity = str(
                details.get("severity")
                or ("CRITICAL" if action in ("ACCOUNT_LOCKED", "LOGIN_FAILED", "PASSWORD_RESET_FAILED") else "INFO")
            ).upper()
            record_type = details.get("record_type")
            record_id = details.get("record_id")
            record_ref = details.get("record_ref") or details.get("ref") or details.get("reference_no")
            user_agent = details.get("user_agent")
            changes = details.get("changes") if isinstance(details.get("changes"), dict) else None

            results.append(
                ActivityLogOut(
                    audit_log_id=r["audit_log_id"],
                    user_id=r.get("user_id"),
                    company_id=r.get("company_id"),
                    action=action,
                    action_category=category,
                    ip_address=ip_address,
                    details=r.get("details"),
                    created_at=str(r.get("created_at")) if r.get("created_at") else None,
                    user_name=user_name,
                    company_name=company_name,
                    description=description,
                    module=module,
                    target=target,
                    severity=severity,
                    record_type=record_type,
                    record_id=record_id,
                    record_ref=record_ref,
                    user_agent=user_agent,
                    changes=changes,
                )
            )

        return results


# Global singleton instance
activity_log_service = ActivityLogService()

