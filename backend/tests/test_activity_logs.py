"""
test_activity_logs.py
---------------------
Unit tests for event-driven activity logging, ActivityLogService,
schemas, and 6-month data retention policy.
"""

import unittest
import os
import sys

os.environ.setdefault("TESTING", "1")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from app.core.events import ActivityEvent, EventBus, dispatch_activity_event
from app.schemas.activity_log import ActivityLogCreate, ActivityLogOut, RetentionPurgeResponse
from app.services.activity_log_service import (
    ActivityLogService,
    _module_for,
    _parse_details,
    _target_for,
)


class TestActivityEventBus(unittest.TestCase):
    """Verify EventBus publish/subscribe mechanisms."""

    def test_event_bus_dispatch_sync(self):
        bus = EventBus(max_workers=2)
        received_events = []

        def handler(event: ActivityEvent):
            received_events.append(event)

        bus.subscribe(handler)
        event = ActivityEvent(action="USER_CREATED", user_id=1, company_id=2)
        bus.dispatch(event, sync=True)

        self.assertEqual(len(received_events), 1)
        self.assertEqual(received_events[0].action, "USER_CREATED")
        self.assertEqual(received_events[0].user_id, 1)

        # Test unsubscribe
        bus.unsubscribe(handler)
        bus.dispatch(ActivityEvent(action="USER_DELETED"), sync=True)
        self.assertEqual(len(received_events), 1)


class TestActivityLogService(unittest.TestCase):
    """Verify ActivityLogService enrichment, module classification, and retention cleanup."""

    def setUp(self):
        self.service = ActivityLogService()

    def test_module_categorization(self):
        self.assertEqual(_module_for("SALE_CREATED", "TRANSACTION"), "Sales")
        self.assertEqual(_module_for("EXPENSE_UPDATED", "TRANSACTION"), "Expense")
        self.assertEqual(_module_for("LOAN_CREATED", "LOAN"), "Loan")
        self.assertEqual(_module_for("PETTY_CASH_TOPUP_CREATED", "PETTY_CASH"), "Petty Cash")
        self.assertEqual(_module_for("TENANT_LEASE_CREATED", "TENANT"), "Tenant")
        self.assertEqual(_module_for("LOGIN_SUCCESS", "AUTH"), "Auth")
        self.assertEqual(_module_for("UNKNOWN_ACTION", "CUSTOM_CAT"), "Custom Cat")

    def test_parse_details_and_target(self):
        details_json = '{"record_id": 42, "record_type": "expense", "ref": "EXP-2026-001"}'
        parsed = _parse_details(details_json)
        self.assertEqual(parsed.get("ref"), "EXP-2026-001")
        self.assertEqual(_target_for(parsed), "EXP-2026-001")

        email_details = {"email": "admin@mct.com"}
        self.assertEqual(_target_for(email_details), "admin@mct.com")

    def test_enrich_logs(self):
        raw_rows = [
            {
                "audit_log_id": 1,
                "user_id": 99,
                "company_id": 88,
                "action": "EXPENSE_CREATED",
                "action_category": "TRANSACTION",
                "ip_address": "127.0.0.1",
                "details": '{"ref": "EXP-001"}',
                "created_at": "2026-11-01T10:00:00+00:00",
            }
        ]

        with patch("app.services.activity_log_service.get_supabase_admin_client") as mock_supa:
            mock_client = MagicMock()
            mock_supa.return_value = mock_client
            # Mock users table
            mock_users_q = MagicMock()
            mock_users_q.select.return_value.in_.return_value.execute.return_value.data = [
                {"user_id": 99, "name": "Alice Auditor"}
            ]
            # Mock company table
            mock_comp_q = MagicMock()
            mock_comp_q.select.return_value.in_.return_value.execute.return_value.data = [
                {"company_id": 88, "company_name": "MCT Corp"}
            ]

            def table_side_effect(name):
                if name == "users":
                    return mock_users_q
                if name == "company":
                    return mock_comp_q
                return MagicMock()

            mock_client.table.side_effect = table_side_effect

            enriched = self.service._enrich_logs(raw_rows)
            self.assertEqual(len(enriched), 1)
            item = enriched[0]
            self.assertEqual(item.user_name, "Alice Auditor")
            self.assertEqual(item.company_name, "MCT Corp")
            self.assertEqual(item.module, "Expense")
            self.assertEqual(item.target, "EXP-001")
            self.assertEqual(item.description, "Expense recorded")

    def test_cleanup_expired_logs_retention(self):
        """Verify 6-month retention cleanup (purges records older than cutoff)."""
        retention_days = 180
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)

        with patch("app.services.activity_log_service.get_supabase_admin_client") as mock_supa, \
             patch("app.services.activity_log_service.SessionLocal") as mock_session_cls:

            # Mock Supabase delete query
            mock_client = MagicMock()
            mock_supa.return_value = mock_client
            mock_delete_q = MagicMock()
            mock_delete_q.delete.return_value.lt.return_value.execute.return_value.data = [
                {"audit_log_id": 10},
                {"audit_log_id": 11},
            ]
            mock_client.table.return_value = mock_delete_q

            # Mock local session
            mock_session = MagicMock()
            mock_session_cls.return_value = mock_session
            mock_session.query.return_value.filter.return_value.delete.return_value = 2

            purged_count = self.service.cleanup_expired_logs(retention_days=180)
            self.assertEqual(purged_count, 2)
            mock_delete_q.delete.return_value.lt.assert_called_once()


class TestActivityLogSchemas(unittest.TestCase):
    """Verify serialization of ActivityLog schemas."""

    def test_schema_serialization(self):
        log_out = ActivityLogOut(
            audit_log_id=1,
            user_id=10,
            company_id=20,
            action="LOGIN_SUCCESS",
            action_category="AUTH",
            ip_address="192.168.1.1",
            details="User logged in",
            created_at="2026-11-01T12:00:00Z",
            user_name="John Doe",
            company_name="Acme Inc",
            description="User logged in successfully",
            module="Auth",
            target="-",
        )
        self.assertEqual(log_out.audit_log_id, 1)
        self.assertEqual(log_out.user_name, "John Doe")
        self.assertEqual(log_out.module, "Auth")

    def test_retention_response_schema(self):
        resp = RetentionPurgeResponse(
            purged_count=15,
            cutoff_date="2026-05-06T00:00:00Z",
            message="Purged 15 expired logs",
        )
        self.assertEqual(resp.purged_count, 15)
        self.assertEqual(resp.cutoff_date, "2026-05-06T00:00:00Z")


class TestActivityLogEndpoints(unittest.TestCase):
    """Verify endpoint functions for activity log listing and retention purging."""

    def test_list_activity_logs_endpoint(self):
        from app.api.v1.endpoints.activity_logs import list_activity_logs

        mock_admin = {"user_id": 1, "is_admin": True, "role": "admin"}
        mock_logs = [
            ActivityLogOut(
                audit_log_id=100,
                action="USER_CREATED",
                action_category="USER",
                user_name="Admin",
                company_name="MCT HQ",
                description="New user account created",
                module="User",
                target="employee@mct.com",
            )
        ]

        with patch("app.api.v1.endpoints.activity_logs.activity_log_service.get_activity_logs", return_value=(mock_logs, 1)):
            result = list_activity_logs(
                _=mock_admin,
                search="Admin",
                limit=10,
                offset=0,
                db=MagicMock(),
            )
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0].audit_log_id, 100)
            self.assertEqual(result[0].user_name, "Admin")

    def test_purge_expired_endpoint(self):
        from app.api.v1.endpoints.activity_logs import purge_expired_activity_logs

        mock_admin = {"user_id": 1, "is_admin": True, "role": "admin"}

        with patch("app.api.v1.endpoints.activity_logs.activity_log_service.cleanup_expired_logs", return_value=8):
            resp = purge_expired_activity_logs(
                _=mock_admin,
                retention_days=180,
            )
            self.assertEqual(resp.purged_count, 8)
            self.assertIn("180 days", resp.message)


class TestAuditDiffAndIpExtraction(unittest.TestCase):
    """Verify compute_dict_diff, sensitive field redaction, and client IP extraction."""

    def test_compute_dict_diff_update_and_redaction(self):
        from app.core.audit import compute_dict_diff

        old_row = {
            "amount": 1000.0,
            "description": "Old toner",
            "password": "plain_password_1",
            "access_token": "token_abc_123",
            "status": "PENDING",
            "updated_at": "2026-11-01T00:00:00",
        }
        new_row = {
            "amount": 1500.0,
            "description": "New toner and paper",
            "password": "plain_password_2",
            "access_token": "token_xyz_789",
            "status": "APPROVED",
            "updated_at": "2026-11-06T00:00:00",
        }

        diffs = compute_dict_diff(old_row, new_row)

        self.assertIn("amount", diffs)
        self.assertEqual(diffs["amount"]["old"], 1000.0)
        self.assertEqual(diffs["amount"]["new"], 1500.0)

        self.assertIn("description", diffs)
        self.assertEqual(diffs["description"]["old"], "Old toner")

        # Sensitive attributes must be masked
        self.assertIn("password", diffs)
        self.assertEqual(diffs["password"]["old"], "[REDACTED]")
        self.assertEqual(diffs["password"]["new"], "[REDACTED]")

        self.assertIn("access_token", diffs)
        self.assertEqual(diffs["access_token"]["old"], "[REDACTED]")
        self.assertEqual(diffs["access_token"]["new"], "[REDACTED]")

        # Ignored key updated_at should not appear
        self.assertNotIn("updated_at", diffs)

    def test_compute_dict_diff_create_and_delete(self):
        from app.core.audit import compute_dict_diff

        # Create
        created = compute_dict_diff(None, {"title": "Expense Voucher", "pin_code": "1234"})
        self.assertEqual(created["title"]["old"], None)
        self.assertEqual(created["title"]["new"], "Expense Voucher")
        self.assertEqual(created["pin_code"]["old"], None)
        self.assertEqual(created["pin_code"]["new"], "[REDACTED]")

        # Delete
        deleted = compute_dict_diff({"title": "Expense Voucher", "secret_key": "xyz"}, None)
        self.assertEqual(deleted["title"]["old"], "Expense Voucher")
        self.assertEqual(deleted["title"]["new"], None)
        self.assertEqual(deleted["secret_key"]["old"], "[REDACTED]")
        self.assertEqual(deleted["secret_key"]["new"], None)

    def test_get_client_ip_headers(self):
        from app.core.audit import get_client_ip

        # 1. X-Forwarded-For
        mock_req_fwd = MagicMock()
        mock_req_fwd.headers = {"x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178"}
        self.assertEqual(get_client_ip(mock_req_fwd), "203.0.113.195")

        # 2. X-Real-IP
        mock_req_real = MagicMock()
        mock_req_real.headers = {"x-real-ip": "198.51.100.4"}
        self.assertEqual(get_client_ip(mock_req_real), "198.51.100.4")

        # 3. CF-Connecting-IP
        mock_req_cf = MagicMock()
        mock_req_cf.headers = {"cf-connecting-ip": "192.0.2.1"}
        self.assertEqual(get_client_ip(mock_req_cf), "192.0.2.1")

        # 4. Direct host fallback
        mock_req_host = MagicMock()
        mock_req_host.headers = {}
        mock_req_host.client.host = "10.0.0.5"
        self.assertEqual(get_client_ip(mock_req_host), "10.0.0.5")

        # 5. None request
        self.assertIsNone(get_client_ip(None))

    def test_enriched_activity_log_diff_fields(self):
        service = ActivityLogService()
        raw_rows = [
            {
                "audit_log_id": 42,
                "user_id": None,
                "company_id": None,
                "action": "EXPENSE_UPDATED",
                "action_category": "EXPENSE",
                "ip_address": "192.168.1.100",
                "details": {
                    "severity": "WARNING",
                    "record_type": "expense",
                    "record_id": 105,
                    "record_ref": "EXP-2026-0042",
                    "user_agent": "Mozilla/5.0 Chrome",
                    "changes": {
                        "amount": {"old": 1000.0, "new": 1200.0}
                    }
                },
                "created_at": "2026-11-06T09:00:00+00:00",
            }
        ]

        enriched = service._enrich_logs(raw_rows)
        self.assertEqual(len(enriched), 1)
        item = enriched[0]
        self.assertEqual(item.severity, "WARNING")
        self.assertEqual(item.record_type, "expense")
        self.assertEqual(item.record_id, 105)
        self.assertEqual(item.record_ref, "EXP-2026-0042")
        self.assertEqual(item.target, "EXP-2026-0042")
        self.assertEqual(item.ip_address, "192.168.1.100")
        self.assertEqual(item.user_agent, "Mozilla/5.0 Chrome")
        self.assertIn("amount", item.changes)
        self.assertEqual(item.changes["amount"]["new"], 1200.0)

    def test_get_entity_timeline_integration(self):
        service = ActivityLogService()
        # Test get_entity_timeline returns timeline events
        events = service.get_entity_timeline(
            record_type="sale",
            record_id="9999",
            ref_no="SAL-2026-9999",
            company_id=1,
        )
        # Should return a list without error
        self.assertIsInstance(events, list)


if __name__ == "__main__":
    unittest.main()
