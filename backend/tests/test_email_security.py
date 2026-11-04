import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError

sys.path.insert(0, os.path.abspath("backend"))
sys.path.insert(0, os.path.abspath("."))

from app.core.config import settings
from app.core.resilience import CircuitBreaker, CircuitBreakerState, email_circuit_breaker
from app.services.email_service import (
    check_and_update_recipient_cooldown,
    is_valid_email,
    mask_email,
    mask_sensitive_url,
    sanitize_header_value,
    send_transactional_email,
)


class TestEmailSecurity(unittest.TestCase):
    def setUp(self):
        email_circuit_breaker.record_success()

    def test_mask_email_pii_protection(self):
        self.assertEqual(mask_email("john.doe@example.com"), "j***e@example.com")
        self.assertEqual(mask_email("al@example.com"), "a***@example.com")
        self.assertEqual(mask_email("invalid"), "[INVALID_EMAIL]")
        self.assertEqual(mask_email(""), "[INVALID_EMAIL]")

    def test_mask_sensitive_url(self):
        url = "http://localhost:5173/setup-password?token=secret123456&email=test@example.com"
        masked = mask_sensitive_url(url)
        self.assertNotIn("secret123456", masked)
        self.assertIn("token=%5BREDACTED%5D", masked)
        self.assertIn("email=test%40example.com", masked)

    def test_crlf_header_injection_rejection(self):
        with self.assertRaises(ValueError):
            sanitize_header_value("Subject line\r\nBcc: attacker@example.com", "Subject")

        with self.assertRaises(ValueError):
            sanitize_header_value("Subject line\nInject-Header: evil", "Subject")

        clean = sanitize_header_value("  Valid Subject Line  ", "Subject")
        self.assertEqual(clean, "Valid Subject Line")

    def test_is_valid_email(self):
        self.assertTrue(is_valid_email("user@example.com"))
        self.assertTrue(is_valid_email("user.name+tag@company.co.uk"))
        self.assertFalse(is_valid_email("user@example.com\r\nBcc: evil@test.com"))
        self.assertFalse(is_valid_email("plainaddress"))
        self.assertFalse(is_valid_email("@missingusername.com"))
        self.assertFalse(is_valid_email(""))

    def test_recipient_abuse_cooldown(self):
        test_email = "victim-bomb@example.com"
        # First call allowed
        self.assertTrue(check_and_update_recipient_cooldown(test_email, cooldown_seconds=60.0))
        # Second immediate call suppressed by cooldown
        self.assertFalse(check_and_update_recipient_cooldown(test_email, cooldown_seconds=60.0))
        # Different recipient allowed
        self.assertTrue(check_and_update_recipient_cooldown("another-user@example.com", cooldown_seconds=60.0))

    @patch("urllib.request.urlopen")
    def test_send_transactional_email_brevo_payload(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.status = 201
        mock_urlopen.return_value.__enter__.return_value = mock_response

        with patch.object(settings, "BREVO_API_KEY", "xkeysib-test-key-12345"), \
             patch.object(settings, "BREVO_FROM_EMAIL", "sender@verified.com"), \
             patch.object(settings, "BREVO_FROM_NAME", "MCT System"):

            success = send_transactional_email(
                to_email="recipient@example.com",
                subject="Test Subject",
                html_content="<p>Test HTML</p>",
                text_content="Test Text",
                to_name="Recipient User",
                enforce_cooldown=False,
            )

            self.assertTrue(success)
            self.assertTrue(mock_urlopen.called)

            req = mock_urlopen.call_args[0][0]
            self.assertEqual(req.full_url, "https://api.brevo.com/v3/smtp/email")
            self.assertEqual(req.headers.get("Api-key"), "xkeysib-test-key-12345")
            self.assertEqual(req.headers.get("Content-type"), "application/json")

            payload = json.loads(req.data.decode("utf-8"))
            self.assertEqual(payload["sender"]["email"], "sender@verified.com")
            self.assertEqual(payload["sender"]["name"], "MCT System")
            self.assertEqual(payload["to"][0]["email"], "recipient@example.com")
            self.assertEqual(payload["to"][0]["name"], "Recipient User")
            self.assertEqual(payload["subject"], "Test Subject")
            self.assertEqual(payload["htmlContent"], "<p>Test HTML</p>")
            self.assertEqual(payload["textContent"], "Test Text")

    @patch("urllib.request.urlopen", side_effect=HTTPError("https://api.brevo.com/v3/smtp/email", 500, "Internal Server Error", {}, None))
    def test_circuit_breaker_trips_on_failures(self, mock_urlopen):
        test_breaker = CircuitBreaker(name="TestBreaker", failure_threshold=2, recovery_timeout=30.0)

        with patch("app.services.email_service.email_circuit_breaker", test_breaker), \
             patch.object(settings, "BREVO_API_KEY", "test_key"), \
             patch.object(settings, "BREVO_FROM_EMAIL", "sender@verified.com"):

            # 1st failure
            res1 = send_transactional_email(
                to_email="test1@example.com",
                subject="Test 1",
                html_content="<p>1</p>",
                text_content="1",
                enforce_cooldown=False,
            )
            self.assertFalse(res1)
            self.assertEqual(test_breaker.state, CircuitBreakerState.CLOSED)

            # 2nd failure - should trip to OPEN
            res2 = send_transactional_email(
                to_email="test2@example.com",
                subject="Test 2",
                html_content="<p>2</p>",
                text_content="2",
                enforce_cooldown=False,
            )
            self.assertFalse(res2)
            self.assertEqual(test_breaker.state, CircuitBreakerState.OPEN)

            # 3rd attempt short-circuited by breaker without calling urlopen
            mock_urlopen.reset_mock()
            res3 = send_transactional_email(
                to_email="test3@example.com",
                subject="Test 3",
                html_content="<p>3</p>",
                text_content="3",
                enforce_cooldown=False,
            )
            self.assertFalse(res3)
            self.assertFalse(mock_urlopen.called)


if __name__ == "__main__":
    unittest.main()
