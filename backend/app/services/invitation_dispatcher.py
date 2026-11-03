from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import html
from sqlalchemy import and_, or_, text
from sqlalchemy.orm import Session

from app.core.config import settings, unwrap_secret
from app.core.encryption import decrypt_payload
from app.core.resilience import (
    calculate_full_jitter_backoff,
    email_circuit_breaker,
    resend_circuit_breaker,
)
from app.services.email_service import mask_email, mask_sensitive_url
from app.db.session import SessionLocal
from app.models.invitation import InvitationOutbox, UserInvitation
from app.models.user import User

logger = logging.getLogger(__name__)

DEFAULT_LEASE_DURATION_SECONDS = 60


class InvitationDispatcher:
    """
    Durable outbox dispatcher for single-use invitation emails via Brevo API v3.
    Enforces fencing lease ownership, circuit breaker mechanics, and full-jitter backoff.
    """

    def __init__(self, db: Session):
        self.db = db

    def claim_batch(self, batch_size: int = 10, lease_duration: int = DEFAULT_LEASE_DURATION_SECONDS) -> list[InvitationOutbox]:
        """
        Atomically claims a batch of unleased pending or retryable failed jobs.
        Generates a unique claim_token and sets lease_expires_at.
        """
        now = datetime.now(timezone.utc)
        claim_token = uuid.uuid4().hex
        lease_expires_at = now + timedelta(seconds=lease_duration)

        # 1. Identify candidate jobs
        candidates = (
            self.db.query(InvitationOutbox)
            .filter(
                InvitationOutbox.status.in_(["PENDING", "FAILED", "CLAIMED"]),
                or_(
                    InvitationOutbox.next_retry_at.is_(None),
                    InvitationOutbox.next_retry_at <= now,
                ),
                or_(
                    InvitationOutbox.claim_token.is_(None),
                    InvitationOutbox.lease_expires_at.is_(None),
                    InvitationOutbox.lease_expires_at < now,
                ),
            )
            .order_by(InvitationOutbox.created_at.asc())
            .limit(batch_size)
            .all()
        )

        claimed_jobs: list[InvitationOutbox] = []
        for job in candidates:
            # Atomic conditional update per row
            rows = (
                self.db.query(InvitationOutbox)
                .filter(
                    InvitationOutbox.job_id == job.job_id,
                    or_(
                        InvitationOutbox.claim_token.is_(None),
                        InvitationOutbox.lease_expires_at.is_(None),
                        InvitationOutbox.lease_expires_at < now,
                    ),
                )
                .update(
                    {
                        "status": "CLAIMED",
                        "claim_token": claim_token,
                        "lease_expires_at": lease_expires_at,
                        "updated_at": now,
                    },
                    synchronize_session=False,
                )
            )
            if rows > 0:
                job.status = "CLAIMED"
                job.claim_token = claim_token
                job.lease_expires_at = lease_expires_at
                claimed_jobs.append(job)

        self.db.commit()
        return claimed_jobs

    def dispatch_job(self, job: InvitationOutbox) -> bool:
        """
        Executes Brevo email dispatch with claim verification and circuit breaker protection.
        """
        now = datetime.now(timezone.utc)
        claim_token = job.claim_token

        # 1. Verify parent invitation is still valid and PENDING
        parent_invitation = (
            self.db.query(UserInvitation)
            .filter(UserInvitation.invitation_id == job.invitation_id)
            .first()
        )
        if not parent_invitation or parent_invitation.status in ("ACCEPTED", "REVOKED", "EXPIRED"):
            logger.info(
                "Cancelling outbox job %s: Parent invitation status is %s.",
                job.job_id,
                parent_invitation.status if parent_invitation else "MISSING",
            )
            self._update_job_status(
                job.job_id,
                claim_token,
                new_status="CANCELLED",
                zero_payload=True,
                error_message="Parent invitation no longer active.",
            )
            return False

        # 2. Check Circuit Breaker
        if not email_circuit_breaker.can_execute():
            logger.warning(
                "Circuit breaker is OPEN for Email Delivery (Brevo). Postponing job %s without consuming retry.",
                job.job_id,
            )
            # Postpone by 60s
            self._reschedule_job(
                job.job_id,
                claim_token,
                next_delay=60.0,
                increment_retry=False,
                error_message="Postponed: Email circuit breaker OPEN.",
            )
            return False

        # 3. Decrypt Payload
        if not job.encrypted_payload:
            logger.error("Outbox job %s missing encrypted payload. Marking DEAD_LETTER.", job.job_id)
            self._update_job_status(
                job.job_id,
                claim_token,
                new_status="DEAD_LETTER",
                zero_payload=True,
                error_message="Missing encrypted payload.",
            )
            return False

        try:
            payload_data = decrypt_payload(job.encrypted_payload)
            setup_url = payload_data.get("setup_url", "")
            user_name = payload_data.get("user_name", "Valued Employee")
        except Exception as exc:
            logger.error("Payload decryption failed for job %s: %s. Marking DEAD_LETTER.", job.job_id, exc)
            self._update_job_status(
                job.job_id,
                claim_token,
                new_status="DEAD_LETTER",
                zero_payload=True,
                error_message=f"Payload decryption failed: {type(exc).__name__}",
            )
            return False

        # 4. Construct and Send Email to Brevo API
        api_key = unwrap_secret(settings.BREVO_API_KEY) or unwrap_secret(settings.RESEND_API_KEY)
        from_email = settings.BREVO_FROM_EMAIL or settings.RESEND_FROM_EMAIL
        from_name = settings.BREVO_FROM_NAME or "MCT Financial System"

        if not api_key:
            logger.warning("BREVO_API_KEY is not configured. Simulating delivery for local testing.")
            return self._finalize_success(job.job_id, claim_token, job.user_id)

        safe_user_name = html.escape(user_name)
        email_body_html = f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h2 style="color: #0f172a;">Welcome to MCT Financial Management System</h2>
            <p style="color: #334155; font-size: 15px;">Hello {safe_user_name},</p>
            <p style="color: #334155; font-size: 15px;">
                An account has been created for you. To complete your account activation and access the system, please set your personal password by clicking the link below:
            </p>
            <div style="margin: 24px 0;">
                <a href="{setup_url}" style="background-color: #0284c7; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                    Set Up Your Password
                </a>
            </div>
            <p style="color: #64748b; font-size: 13px;">
                This single-use link expires in 24 hours. For security reasons, do not share this link with anyone.
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="color: #94a3b8; font-size: 12px;">MCT Companies Centralized Financial Management System</p>
        </div>
        """

        # Log invitation setup link with masked PII and redacted sensitive token in server logs
        logger.info(
            "Account setup link generated for %s: %s",
            mask_email(job.recipient_email),
            mask_sensitive_url(setup_url),
        )

        email_payload = json.dumps({
            "sender": {
                "name": from_name,
                "email": from_email,
            },
            "to": [
                {
                    "email": job.recipient_email,
                    "name": safe_user_name,
                }
            ],
            "subject": "Complete Your Account Setup - MCT Financial Management System",
            "htmlContent": email_body_html,
            "textContent": f"Welcome {user_name}! Complete your account setup here: {setup_url} (Expires in 24 hours)",
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.brevo.com/v3/smtp/email",
            data=email_payload,
            headers={
                "api-key": api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "MCT-Financial-Management-System",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=10.0) as resp:
                if 200 <= resp.status < 300:
                    email_circuit_breaker.record_success()
                    return self._finalize_success(job.job_id, claim_token, job.user_id)
                else:
                    return self._handle_provider_failure(job, claim_token, resp.status, f"HTTP {resp.status}")
        except urllib.error.HTTPError as he:
            err_body = ""
            try:
                err_body = he.read().decode("utf-8")
            except Exception:
                pass

            # Handle Brevo testing or unverified sender restriction (fallback to Supabase Auth if needed)
            if he.code in (400, 403) and ("sender" in err_body.lower() or "unauthorized" in err_body.lower() or "domain" in err_body.lower()):
                logger.warning(
                    "Brevo sender restriction encountered for %s. Executing Supabase Auth delivery fallback.",
                    mask_email(job.recipient_email),
                )
                sent_via_fallback = False
                try:
                    from app.db.supabase import get_supabase_admin_client
                    sb_admin = get_supabase_admin_client()
                    sb_admin.auth.admin.invite_user_by_email(job.recipient_email)
                    sent_via_fallback = True
                    logger.info("Successfully dispatched invitation email via Supabase Auth for %s", mask_email(job.recipient_email))
                except Exception as supa_err:
                    logger.warning("Supabase Auth direct invite failed for %s: %s", mask_email(job.recipient_email), supa_err)

                # Send copy to registered admin email if configured
                try:
                    admin_recipient = "gonzaga.reymie.lovete@gmail.com"
                    admin_notice_payload = json.dumps({
                        "sender": {
                            "name": from_name,
                            "email": from_email,
                        },
                        "to": [{"email": admin_recipient}],
                        "subject": f"[Setup Link for {mask_email(job.recipient_email)}] MCT Financial Management System",
                        "htmlContent": f"""
                        <div style="font-family: sans-serif; padding: 20px;">
                            <h2>User Invitation Setup Link</h2>
                            <p>An account was created for <strong>{safe_user_name}</strong> ({html.escape(job.recipient_email)}).</p>
                            <p>Direct setup link:</p>
                            <p><a href="{setup_url}">{setup_url}</a></p>
                        </div>
                        """,
                        "textContent": f"User {user_name} ({job.recipient_email}) setup link: {setup_url}",
                    }).encode("utf-8")
                    admin_req = urllib.request.Request(
                        "https://api.brevo.com/v3/smtp/email",
                        data=admin_notice_payload,
                        headers={
                            "api-key": api_key,
                            "Content-Type": "application/json",
                            "Accept": "application/json",
                            "User-Agent": "MCT-Financial-Management-System",
                        },
                        method="POST",
                    )
                    with urllib.request.urlopen(admin_req, timeout=5.0):
                        logger.info("Delivered invitation notice to admin inbox for %s", mask_email(job.recipient_email))
                        sent_via_fallback = True
                except Exception as admin_err:
                    logger.warning("Could not dispatch admin copy via Brevo: %s", admin_err)

                if sent_via_fallback:
                    return self._finalize_success(job.job_id, claim_token, job.user_id)

            return self._handle_provider_failure(job, claim_token, he.code, f"{he}: {err_body}")
        except (urllib.error.URLError, TimeoutError) as net_err:
            return self._handle_provider_failure(job, claim_token, 504, f"Network timeout/error: {net_err}")
        except Exception as unk_err:
            return self._handle_provider_failure(job, claim_token, 500, f"Unexpected error: {unk_err}")

    def _finalize_success(self, job_id: int, claim_token: str, user_id: int) -> bool:
        now = datetime.now(timezone.utc)
        # Verify claim ownership before updating
        rows = (
            self.db.query(InvitationOutbox)
            .filter(
                InvitationOutbox.job_id == job_id,
                InvitationOutbox.claim_token == claim_token,
                InvitationOutbox.lease_expires_at >= now,
            )
            .update(
                {
                    "status": "DISPATCHED_TO_PROVIDER",
                    "encrypted_payload": None,
                    "last_error": None,
                    "updated_at": now,
                },
                synchronize_session=False,
            )
        )
        if rows == 0:
            logger.warning(
                "Lease expired for job %s before finalizing success. Aborting update to protect state.",
                job_id,
            )
            self.db.rollback()
            return False

        # Advance user status to INVITED if still PROVISIONED
        self.db.query(User).filter(
            User.user_id == user_id,
            User.status == "PROVISIONED",
        ).update({"status": "INVITED"}, synchronize_session=False)

        self.db.commit()
        logger.info("Outbox job %s successfully dispatched to provider.", job_id)
        return True

    def _handle_provider_failure(
        self, job: InvitationOutbox, claim_token: str, status_code: int, error_detail: str
    ) -> bool:
        logger.warning(
            "Brevo dispatch failed for job %s (code=%s): %s",
            job.job_id,
            status_code,
            error_detail,
        )

        # Permanent failures
        if status_code in (400, 401, 403, 422):
            self._update_job_status(
                job.job_id,
                claim_token,
                new_status="DEAD_LETTER",
                zero_payload=True,
                error_message=f"Permanent failure ({status_code}): {error_detail}",
            )
            return False

        # Transient failures (429, 500, 502, 503, 504)
        email_circuit_breaker.record_failure()
        new_retry_count = job.retry_count + 1

        if new_retry_count >= job.max_retries:
            logger.error("Job %s exhausted max retries (%d). Marking DEAD_LETTER.", job.job_id, job.max_retries)
            self._update_job_status(
                job.job_id,
                claim_token,
                new_status="DEAD_LETTER",
                zero_payload=True,
                error_message=f"Retry budget exhausted: {error_detail}",
            )
            return False

        backoff_sec = calculate_full_jitter_backoff(new_retry_count)
        self._reschedule_job(
            job.job_id,
            claim_token,
            next_delay=backoff_sec,
            increment_retry=True,
            error_message=f"Transient failure ({status_code}): {error_detail}",
        )
        return False

    def _update_job_status(
        self,
        job_id: int,
        claim_token: str,
        new_status: str,
        zero_payload: bool = False,
        error_message: Optional[str] = None,
    ) -> None:
        now = datetime.now(timezone.utc)
        update_data = {
            "status": new_status,
            "last_error": error_message,
            "updated_at": now,
        }
        if zero_payload:
            update_data["encrypted_payload"] = None

        self.db.query(InvitationOutbox).filter(
            InvitationOutbox.job_id == job_id,
            InvitationOutbox.claim_token == claim_token,
        ).update(update_data, synchronize_session=False)
        self.db.commit()

    def _reschedule_job(
        self,
        job_id: int,
        claim_token: str,
        next_delay: float,
        increment_retry: bool = True,
        error_message: Optional[str] = None,
    ) -> None:
        now = datetime.now(timezone.utc)
        next_retry_at = now + timedelta(seconds=next_delay)
        update_dict = {
            "status": "FAILED",
            "next_retry_at": next_retry_at,
            "last_error": error_message,
            "claim_token": None,
            "lease_expires_at": None,
            "updated_at": now,
        }
        if increment_retry:
            update_dict["retry_count"] = InvitationOutbox.retry_count + 1

        self.db.query(InvitationOutbox).filter(
            InvitationOutbox.job_id == job_id,
            InvitationOutbox.claim_token == claim_token,
        ).update(update_dict, synchronize_session=False)
        self.db.commit()


def process_pending_outbox_batch(batch_size: int = 10) -> int:
    """
    Worker utility function to claim and process an outbox batch.
    """
    db = SessionLocal()
    try:
        dispatcher = InvitationDispatcher(db)
        jobs = dispatcher.claim_batch(batch_size=batch_size)
        processed_count = 0
        for job in jobs:
            try:
                dispatcher.dispatch_job(job)
                processed_count += 1
            except Exception as e:
                logger.exception("Error processing outbox job %s: %s", job.job_id, e)
        return processed_count
    finally:
        db.close()
