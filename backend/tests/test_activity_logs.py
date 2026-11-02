"""
test_activity_logs.py
---------------------
Unit tests for event-driven activity logging, ActivityLogService,
schemas, and 6-month data retention policy.
"""

import unittest
import os
import sys

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



if __name__ == "__main__":
    unittest.main()
