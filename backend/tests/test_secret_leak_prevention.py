import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock
from pydantic import SecretStr
from fastapi import Request

sys.path.insert(0, os.path.abspath("backend"))
sys.path.insert(0, os.path.abspath("."))

from app.api.v1.endpoints.health import health_check
from app.core.config import settings, unwrap_secret
from app.core.errors import global_unhandled_exception_handler

FORBIDDEN_SECRET_PATTERNS = [
    "BREVO_API_KEY",
    "xkeysib-",
    "RESEND_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DATABASE_URL",
]


class TestSecretLeakPrevention(unittest.TestCase):
    """
    Automated security guardrail tests ensuring backend secrets and API keys
    never leak into frontend source files, build bundles, or HTTP API responses.
    """

    def test_frontend_source_contains_no_server_secrets(self):
        """Scans all source files under frontend/src/ for forbidden server secret strings."""
        frontend_src = Path("frontend/src")
        if not frontend_src.exists():
            frontend_src = Path("../frontend/src")

        self.assertTrue(frontend_src.exists(), "frontend/src directory must exist")

        scanned_count = 0
        for file_path in frontend_src.rglob("*"):
            if file_path.is_file() and file_path.suffix in (".ts", ".tsx", ".js", ".jsx", ".html", ".json"):
                scanned_count += 1
                try:
                    content = file_path.read_text(encoding="utf-8")
                except UnicodeDecodeError:
                    continue

                for pattern in FORBIDDEN_SECRET_PATTERNS:
                    self.assertNotIn(
                        pattern,
                        content,
                        f"CRITICAL: Found forbidden secret pattern {pattern!r} in client file {file_path}",
                    )

        self.assertGreater(scanned_count, 10, "Expected to scan multiple frontend source files")

    def test_settings_redacts_sensitive_keys(self):
        """Asserts that SecretStr fields mask credentials when serialized or printed."""
        # When str() or repr() is called on SecretStr, it must be masked
        self.assertEqual(str(settings.BREVO_API_KEY), "**********")
        self.assertIn("**********", repr(settings.BREVO_API_KEY))

        # Full settings repr must not expose raw Brevo key or service role key
        settings_repr = repr(settings)
        self.assertNotIn("xkeysib-", settings_repr)

        # unwrap_secret safely retrieves the raw string value when required for backend execution
        plain_key = unwrap_secret(settings.BREVO_API_KEY)
        self.assertIsInstance(plain_key, str)

    def test_global_exception_handler_sanitizes_500_responses(self):
        """Asserts that unhandled server exceptions return generic error responses without echoing secrets."""
        mock_request = MagicMock(spec=Request)
        sensitive_crash_error = RuntimeError(f"Database crash with secret token {unwrap_secret(settings.BREVO_API_KEY)}")

        response = global_unhandled_exception_handler(mock_request, sensitive_crash_error)
        self.assertEqual(response.status_code, 500)

        body_str = response.body.decode("utf-8")
        self.assertIn("An internal server error occurred. Please try again later.", body_str)
        # Must not contain raw secret or internal traceback
        self.assertNotIn("xkeysib-", body_str)
        self.assertNotIn("Database crash with secret token", body_str)

    def test_health_endpoint_does_not_leak_secrets(self):
        """Verifies health check endpoint returns only service metadata and no credentials."""
        data = health_check()
        self.assertIn("status", data)
        self.assertEqual(data["status"], "healthy")

        import json
        payload_str = json.dumps(data)
        for pattern in FORBIDDEN_SECRET_PATTERNS:
            self.assertNotIn(pattern, payload_str)


if __name__ == "__main__":
    unittest.main()
