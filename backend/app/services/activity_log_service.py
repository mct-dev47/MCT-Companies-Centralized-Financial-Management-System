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
from app.schemas.activity_log import ActivityLogOut, TimelineEventOut

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

    def cleanup_expired_logs_batched(
        self,
        db: Session,
        retention_days: int = 180,
        batch_size: int = 1000,
        now: Optional[datetime] = None,
    ) -> int:
        """
        Batched local database purge of AuditLog rows older than retention_days.
        Avoids unbatched table locks and synchronous external HTTP calls.
        """
        from sqlalchemy import delete, select

        resolved_now = now if now is not None else datetime.now(timezone.utc)
        if resolved_now.tzinfo is None:
            resolved_now = resolved_now.replace(tzinfo=timezone.utc)
        cutoff = resolved_now - timedelta(days=retention_days)
        total_deleted = 0
        try:
            while True:
                ids = db.scalars(
                    select(AuditLog.audit_log_id)
                    .where(AuditLog.created_at < cutoff)
                    .limit(batch_size)
                ).all()
                if not ids:
                    break
                res = db.execute(
                    delete(AuditLog).where(AuditLog.audit_log_id.in_(ids))
                )
                db.commit()
                deleted = res.rowcount or 0
                total_deleted += deleted
                if deleted < batch_size:
                    break
        except Exception as exc:
            db.rollback()
            logger.warning("Batched local audit_logs retention purge failed: %s", exc)
        return total_deleted

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

            from app.core.user_name_resolver import resolve_real_name
            user_name = users.get(r.get("user_id")) or (resolve_real_name(str(details["email"])) if details.get("email") else "System")
            user_name = resolve_real_name(user_name)
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

    def get_entity_timeline(
        self,
        *,
        record_type: str,
        record_id: Optional[Union[str, int]] = None,
        ref_no: Optional[str] = None,
        company_id: Optional[int] = None,
        db: Optional[Session] = None,
    ) -> List[TimelineEventOut]:
        """
        Build an enriched, chronological timeline of an entity (Sale, Expense, Loan,
        Petty Cash topup/reimbursement, Tenant collection, etc.), combining official
        audit log events with database lifecycle milestones.
        """
        import re
        from app.core.user_name_resolver import resolve_real_name
        from app.models.finance import Sale, Expense
        from app.models.petty_cash import PettyCashTopUp
        from app.models.loan import Loan

        norm_type = (record_type or "").strip().lower()
        if norm_type in ("sales", "sale"):
            norm_type = "sale"
        elif norm_type in ("expenses", "expense"):
            norm_type = "expense"
        elif norm_type in ("petty_cash", "petty cash", "pettycash", "topup", "reimbursement", "replenishment"):
            norm_type = "petty_cash"
        elif norm_type in ("loans", "loan"):
            norm_type = "loan"
        elif norm_type in ("tenants", "tenant", "lease", "income"):
            norm_type = "tenant"

        raw_id_str = str(record_id or "").strip()
        parsed_id: Optional[int] = None
        match = re.search(r"(\d+)", raw_id_str)
        if match:
            parsed_id = int(match.group(1))

        close_session = False
        if db is None:
            db = SessionLocal()
            close_session = True

        timeline: List[TimelineEventOut] = []

        try:
            # 1. Fetch relevant audit logs from local DB / Supabase
            local_logs = (
                db.query(AuditLog)
                .order_by(AuditLog.created_at.asc())
                .all()
            )

            # Filter relevant logs for this entity
            matched_audit_rows = []
            for al in local_logs:
                d = _parse_details(al.details)
                al_rec_type = str(d.get("record_type") or "").strip().lower()
                al_rec_id = str(d.get("record_id") or "").strip()
                al_ref = str(d.get("reference_no") or d.get("record_ref") or d.get("ref") or "").strip()

                is_type_match = False
                if al_rec_type == norm_type:
                    is_type_match = True
                elif norm_type == "sale" and al.action.startswith("SALE_"):
                    is_type_match = True
                elif norm_type == "expense" and al.action.startswith("EXPENSE_"):
                    is_type_match = True
                elif norm_type == "petty_cash" and al.action.startswith("PETTY_CASH_"):
                    is_type_match = True
                elif norm_type == "loan" and al.action.startswith("LOAN_"):
                    is_type_match = True
                elif norm_type == "tenant" and al.action.startswith("TENANT_"):
                    is_type_match = True

                if not is_type_match:
                    continue

                id_matches = False
                if parsed_id is not None and al_rec_id == str(parsed_id):
                    id_matches = True
                elif ref_no and al_ref and al_ref.lower() == ref_no.strip().lower():
                    id_matches = True
                elif ref_no and d.get("cheque_number") and str(d.get("cheque_number")).strip().lower() == ref_no.strip().lower():
                    id_matches = True

                if id_matches:
                    matched_audit_rows.append(al)

            # Enrich matched audit rows
            if matched_audit_rows:
                enriched = self._enrich_logs(
                    [
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
                        for r in matched_audit_rows
                    ],
                    db=db,
                )
                for item in enriched:
                    evt_type = "general"
                    title = item.description or item.action
                    act_lower = item.action.lower()
                    if "create" in act_lower:
                        evt_type = "created"
                        title = f"{norm_type.title()} Created"
                    elif "update" in act_lower or "wallet" in act_lower:
                        evt_type = "edited"
                        title = "Details Modified"
                    elif "endorse" in act_lower:
                        evt_type = "endorsed"
                        title = "Endorsed by Finance"
                    elif "audit" in act_lower or "review" in act_lower:
                        evt_type = "audited"
                        title = "Audited & Verified"
                    elif "reimburse" in act_lower or "disburse" in act_lower:
                        evt_type = "disbursed"
                        title = "Reimbursement Disbursed"
                    elif "payment" in act_lower:
                        evt_type = "payment"
                        title = "Payment Recorded"

                    raw_d = _parse_details(item.details)
                    notes_val = raw_d.get("notes") or raw_d.get("remark") or raw_d.get("remarks")
                    changes_val = raw_d.get("changes") if isinstance(raw_d.get("changes"), dict) else None

                    timeline.append(
                        TimelineEventOut(
                            id=f"audit-{item.audit_log_id}",
                            action=item.action,
                            event_type=evt_type,
                            title=title,
                            actor_name=item.user_name,
                            actor_role=item.module or None,
                            timestamp=item.created_at,
                            description=item.description,
                            changes=changes_val,
                            notes=str(notes_val) if notes_val else None,
                            status_badge=raw_d.get("status") or raw_d.get("audit_status"),
                        )
                    )

            # 2. Extract database model milestones
            if norm_type == "sale" and parsed_id is not None:
                sale = db.query(Sale).filter(Sale.sales_id == parsed_id).first()
                if sale:
                    # Created milestone
                    has_created = any(t.event_type == "created" for t in timeline)
                    if not has_created:
                        timeline.append(
                            TimelineEventOut(
                                id=f"sale-{sale.sales_id}-created",
                                action="SALE_CREATED",
                                event_type="created",
                                title="Sale Recorded",
                                actor_name="Authorized Staff",
                                actor_role="Staff",
                                timestamp=str(sale.created_at) if sale.created_at else str(sale.transaction_date),
                                description=f"Initial sale recorded: {sale.particulars} (₱{sale.amount:,.2f})",
                                status_badge=sale.payment_status,
                            )
                        )
                    # Audit milestone
                    if sale.audit_status and sale.audit_status != "Pending Audit":
                        has_audit = any(t.event_type == "audited" for t in timeline)
                        if not has_audit:
                            auditor = resolve_real_name(sale.audited_by) if sale.audited_by else "Internal Auditor"
                            timeline.append(
                                TimelineEventOut(
                                    id=f"sale-{sale.sales_id}-audited",
                                    action="SALE_AUDITED",
                                    event_type="audited",
                                    title="Audited & Verified" if sale.audit_status == "Verified" else "Flagged for Audit Review",
                                    actor_name=auditor,
                                    actor_role="Audit Officer",
                                    timestamp=str(sale.audited_at) if sale.audited_at else str(sale.updated_at or sale.created_at),
                                    description=f"Transaction audited and marked as {sale.audit_status}",
                                    notes=sale.audit_remarks,
                                    status_badge=sale.audit_status,
                                )
                            )
                    # Modified milestone
                    if sale.updated_at and sale.created_at and str(sale.updated_at) != str(sale.created_at):
                        has_edit = any(t.event_type == "edited" for t in timeline)
                        if not has_edit:
                            timeline.append(
                                TimelineEventOut(
                                    id=f"sale-{sale.sales_id}-updated",
                                    action="SALE_UPDATED",
                                    event_type="edited",
                                    title="Details Modified",
                                    actor_name="Authorized Staff",
                                    actor_role="Supervisor",
                                    timestamp=str(sale.updated_at),
                                    description="Transaction particulars, amount, or status updated",
                                )
                            )

            elif norm_type == "expense" and parsed_id is not None:
                exp = db.query(Expense).filter(Expense.expense_id == parsed_id).first()
                if exp:
                    creator_user = db.query(User).filter(User.user_id == exp.created_by).first() if exp.created_by else None
                    creator_name = resolve_real_name(creator_user.name) if creator_user else "Authorized Staff"

                    has_created = any(t.event_type == "created" for t in timeline)
                    if not has_created:
                        timeline.append(
                            TimelineEventOut(
                                id=f"expense-{exp.expense_id}-created",
                                action="EXPENSE_CREATED",
                                event_type="created",
                                title="Expense Recorded",
                                actor_name=creator_name,
                                actor_role="Staff",
                                timestamp=str(exp.created_at) if exp.created_at else str(exp.expense_date),
                                description=f"Initial expense recorded: {exp.description or exp.particulars} (₱{exp.amount:,.2f})",
                                status_badge="Paid",
                            )
                        )
                    # Audit milestone
                    if exp.audit_status and exp.audit_status != "Pending Audit":
                        has_audit = any(t.event_type == "audited" for t in timeline)
                        if not has_audit:
                            auditor = resolve_real_name(exp.audited_by) if exp.audited_by else "Internal Auditor"
                            timeline.append(
                                TimelineEventOut(
                                    id=f"expense-{exp.expense_id}-audited",
                                    action="EXPENSE_AUDITED",
                                    event_type="audited",
                                    title="Audited & Verified" if exp.audit_status == "Verified" else "Flagged for Audit Review",
                                    actor_name=auditor,
                                    actor_role="Audit Officer",
                                    timestamp=str(exp.audited_at) if exp.audited_at else str(exp.updated_at or exp.created_at),
                                    description=f"Expense audited and marked as {exp.audit_status}",
                                    notes=exp.audit_remarks,
                                    status_badge=exp.audit_status,
                                )
                            )
                    # Modified milestone
                    if exp.updated_at and exp.created_at and str(exp.updated_at) != str(exp.created_at):
                        has_edit = any(t.event_type == "edited" for t in timeline)
                        if not has_edit:
                            timeline.append(
                                TimelineEventOut(
                                    id=f"expense-{exp.expense_id}-updated",
                                    action="EXPENSE_UPDATED",
                                    event_type="edited",
                                    title="Details Modified",
                                    actor_name="Authorized Staff",
                                    actor_role="Supervisor",
                                    timestamp=str(exp.updated_at),
                                    description="Expense details, amounts, or receipts updated",
                                )
                            )

            elif norm_type == "petty_cash" and parsed_id is not None:
                topup = db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == parsed_id).first()
                if topup:
                    is_reimb = (topup.request_type or "").strip().lower() in ("reimbursement", "replenishment")
                    creator_user = db.query(User).filter(User.user_id == topup.created_by).first() if topup.created_by else None
                    claimant_name = resolve_real_name(topup.paid_by) if topup.paid_by else (resolve_real_name(creator_user.name) if creator_user else "Employee")

                    has_created = any(t.event_type == "created" for t in timeline)
                    if not has_created:
                        timeline.append(
                            TimelineEventOut(
                                id=f"topup-{topup.topup_id}-created",
                                action="PETTY_CASH_TOPUP_CREATED",
                                event_type="created",
                                title="Replenishment / Reimbursement Claim Filed" if is_reimb else "Petty Cash Top Up Requested",
                                actor_name=claimant_name,
                                actor_role="Employee / Staff",
                                timestamp=str(topup.created_at) if topup.created_at else str(topup.topup_date),
                                description=f"Submitted {topup.request_type or 'topup'} request for ₱{topup.amount:,.2f}: {topup.description or 'Petty cash replenishment'}",
                                status_badge=topup.status,
                            )
                        )

                    # Finance Endorsement milestone
                    if topup.endorsed_by or topup.endorsed_at or topup.finance_remark:
                        has_endorse = any(t.event_type == "endorsed" for t in timeline)
                        if not has_endorse:
                            timeline.append(
                                TimelineEventOut(
                                    id=f"topup-{topup.topup_id}-endorsed",
                                    action="PETTY_CASH_ENDORSED",
                                    event_type="endorsed",
                                    title="Endorsed by Finance",
                                    actor_name=resolve_real_name(topup.endorsed_by or "Finance Officer"),
                                    actor_role="Finance Officer",
                                    timestamp=str(topup.endorsed_at) if topup.endorsed_at else str(topup.created_at),
                                    description="Funding bank assigned and request endorsed to Internal Audit",
                                    notes=topup.finance_remark,
                                    status_badge="Pending Audit Approval",
                                )
                            )

                    # Audit review milestone
                    if topup.reviewed_by or topup.reviewed_at or topup.remark or (topup.status or "").lower() in ("approved", "disapproved by audit", "reimbursed", "settled"):
                        has_review = any(t.event_type == "audited" for t in timeline)
                        if not has_review:
                            is_approved = (topup.status or "").lower() in ("approved", "reimbursed", "settled", "transfer in transit", "transfer received")
                            timeline.append(
                                TimelineEventOut(
                                    id=f"topup-{topup.topup_id}-reviewed",
                                    action="PETTY_CASH_AUDIT_REVIEW",
                                    event_type="audited",
                                    title="Audited & Approved" if is_approved else "Disapproved by Audit",
                                    actor_name=resolve_real_name(topup.reviewed_by or "Internal Auditor"),
                                    actor_role="Audit Officer",
                                    timestamp=str(topup.reviewed_at) if topup.reviewed_at else str(topup.endorsed_at or topup.created_at),
                                    description=f"Internal audit review complete. Status: {topup.status}",
                                    notes=topup.remark,
                                    status_badge=topup.status,
                                )
                            )

                    # Transfer received milestone
                    if topup.transfer_received_at or topup.transfer_received_by:
                        timeline.append(
                            TimelineEventOut(
                                id=f"topup-{topup.topup_id}-transfer",
                                action="PETTY_CASH_TRANSFER_RECEIVED",
                                event_type="payment",
                                title="Bank Transfer Confirmed Received",
                                actor_name=resolve_real_name(topup.transfer_received_by or "Finance Officer"),
                                actor_role="Finance Officer",
                                timestamp=str(topup.transfer_received_at),
                                description="Funding transfer verified and received by requesting company bank",
                                status_badge="Transfer Received",
                            )
                        )

                    # Reimbursed / Settled milestone
                    if topup.reimbursed_at or topup.reimbursed_by or (topup.status or "").lower() in ("reimbursed", "settled"):
                        has_payout = any(t.event_type == "disbursed" for t in timeline)
                        if not has_payout:
                            is_settled = (topup.status or "").lower() == "settled"
                            timeline.append(
                                TimelineEventOut(
                                    id=f"topup-{topup.topup_id}-reimbursed",
                                    action="PETTY_CASH_REIMBURSED",
                                    event_type="disbursed",
                                    title="Float Finalized & Settled" if is_settled else "Reimbursement Payout Disbursed",
                                    actor_name=resolve_real_name(topup.reimbursed_by or "Finance Officer"),
                                    actor_role="Finance Officer",
                                    timestamp=str(topup.reimbursed_at) if topup.reimbursed_at else str(topup.reviewed_at or topup.created_at),
                                    description="Disbursement finalized and petty cash ledger updated" if is_settled else f"Employee reimbursement of ₱{topup.amount_reimbursed or topup.amount:,.2f} disbursed",
                                    status_badge=topup.status,
                                )
                            )

            elif norm_type == "loan" and parsed_id is not None:
                loan = db.query(Loan).filter(Loan.id == parsed_id).first()
                if loan:
                    timeline.append(
                        TimelineEventOut(
                            id=f"loan-{loan.id}-created",
                            action="LOAN_CREATED",
                            event_type="created",
                            title="Loan Facility Originated",
                            actor_name="Authorized Finance Officer",
                            actor_role="Finance Officer",
                            timestamp=str(loan.created_at) if hasattr(loan, "created_at") and loan.created_at else str(loan.date),
                            description=f"Loan originated: ₱{loan.amount:,.2f} to {loan.borrower_name or 'Borrower'}",
                            status_badge=loan.status,
                        )
                    )
                    if hasattr(loan, "audit_status") and loan.audit_status and loan.audit_status != "Pending Audit":
                        timeline.append(
                            TimelineEventOut(
                                id=f"loan-{loan.id}-audited",
                                action="LOAN_AUDITED",
                                event_type="audited",
                                title="Audited & Verified",
                                actor_name=resolve_real_name(getattr(loan, "audited_by", "Internal Auditor")),
                                actor_role="Audit Officer",
                                timestamp=str(getattr(loan, "audited_at", loan.date)),
                                description=f"Loan verified by audit. Status: {loan.audit_status}",
                                status_badge=loan.audit_status,
                            )
                        )

            # Sort chronological
            timeline.sort(key=lambda x: str(x.timestamp or ""))
            return timeline
        finally:
            if close_session:
                db.close()



# Global singleton instance
activity_log_service = ActivityLogService()

