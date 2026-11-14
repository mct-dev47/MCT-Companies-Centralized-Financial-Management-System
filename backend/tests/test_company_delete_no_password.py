import unittest
from unittest.mock import MagicMock, patch
from fastapi import FastAPI, status
from fastapi.testclient import TestClient

from app.api.v1.endpoints import companies as companies_endpoints
from app.core.dependencies import get_db, get_current_user, require_admin_user


class TestCompanyDeleteNoPassword(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(companies_endpoints.router, prefix="/api/v1/companies")

        self.mock_admin = {"user_id": 1, "is_admin": True, "role": "admin"}
        self.app.dependency_overrides[get_current_user] = lambda: self.mock_admin
        self.app.dependency_overrides[require_admin_user] = lambda: self.mock_admin
        self.app.dependency_overrides[get_db] = lambda: MagicMock()

        self.client = TestClient(self.app)

    @patch("app.api.v1.endpoints.companies.CompanyService")
    @patch("app.api.v1.endpoints.companies.log_company_management")
    def test_delete_company_without_reauth_header(self, mock_log, mock_service_cls):
        mock_service = MagicMock()
        mock_service.delete_company.return_value = True
        mock_service_cls.return_value = mock_service

        response = self.client.delete("/api/v1/companies/42")

        # Must return 204 No Content without requiring X-MCT-Reauth
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        mock_service.delete_company.assert_called_once_with(42)
        mock_log.assert_called_once()

    @patch("app.api.v1.endpoints.companies.CompanyService")
    def test_delete_company_non_admin_forbidden(self, mock_service_cls):
        mock_non_admin = {"user_id": 2, "is_admin": False, "role": "staff"}
        self.app.dependency_overrides[get_current_user] = lambda: mock_non_admin
        # Remove require_admin_user override so real check runs
        del self.app.dependency_overrides[require_admin_user]

        response = self.client.delete("/api/v1/companies/42")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


if __name__ == "__main__":
    unittest.main()

