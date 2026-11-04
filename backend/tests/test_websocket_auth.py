import logging
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

from app.main import app
from app.core.logging_filter import SensitiveParamRedactionFilter


class TestWebSocketAuthAndLogging(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_sensitive_param_redaction_filter(self):
        f = SensitiveParamRedactionFilter()

        # Test LogRecord with msg string
        record1 = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg='GET /ws?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 HTTP/1.1 101',
            args=(),
            exc_info=None,
        )
        f.filter(record1)
        self.assertIn("?token=***REDACTED***", record1.msg)
        self.assertNotIn("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", record1.msg)

        # Test LogRecord with args tuple (standard uvicorn access format)
        record2 = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg='%s - "%s" %s',
            args=(
                "127.0.0.1:54321",
                "GET /api/v1/resource?access_token=secret_abc123&page=1 HTTP/1.1",
                "200",
            ),
            exc_info=None,
        )
        f.filter(record2)
        self.assertIn("?access_token=***REDACTED***&page=1", record2.args[1])
        self.assertNotIn("secret_abc123", record2.args[1])

    @patch("app.core.security.verify_token")
    def test_websocket_in_band_auth_success(self, mock_verify):
        mock_verify.return_value = {
            "sub": "42",
            "user_id": 42,
            "role": "admin",
            "company_id": 1,
        }

        with self.client.websocket_connect("/ws") as ws:
            # Send in-band authentication frame
            ws.send_json({"type": "auth", "token": "valid-test-token"})
            response = ws.receive_json()
            self.assertEqual(response, {"type": "authenticated"})

            # Ping-pong check
            ws.send_text("ping")
            pong = ws.receive_text()
            self.assertEqual(pong, "pong")

    @patch("app.core.security.verify_token")
    def test_websocket_legacy_query_param_auth(self, mock_verify):
        mock_verify.return_value = {
            "sub": "42",
            "user_id": 42,
            "role": "admin",
            "company_id": 1,
        }

        with self.client.websocket_connect("/ws?token=legacy-valid-token") as ws:
            response = ws.receive_json()
            self.assertEqual(response, {"type": "authenticated"})

            ws.send_text("ping")
            pong = ws.receive_text()
            self.assertEqual(pong, "pong")

    @patch("app.core.security.verify_token")
    def test_websocket_in_band_auth_invalid_token(self, mock_verify):
        mock_verify.side_effect = ValueError("Invalid token signature")

        with self.assertRaises(Exception):
            with self.client.websocket_connect("/ws") as ws:
                ws.send_json({"type": "auth", "token": "invalid-token"})
                ws.receive_json()

