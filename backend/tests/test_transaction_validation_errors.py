from decimal import Decimal
import json
from fastapi.exceptions import RequestValidationError
from starlette.requests import Request

from app.core.errors import validation_exception_handler
from app.schemas.sale import SaleCreate
from app.schemas.expense import ExpenseCreate


def test_validation_exception_handler_names_failing_field():
    """Verify validation_exception_handler returns clear field-level details instead of a generic string."""
    scope = {"type": "http", "method": "POST", "path": "/api/v1/sales", "headers": []}
    req = Request(scope)

    try:
        SaleCreate(
            company="MCT Main",
            transaction_date="2026-11-17",
            amount=Decimal("0.50"),  # Invalid: must be >= 1.00
            particulars="Test",
            category="Services",
        )
    except Exception as exc:
        pydantic_errors = exc.errors() if hasattr(exc, "errors") else []
        req_exc = RequestValidationError(pydantic_errors)
        resp = validation_exception_handler(req, req_exc)
        assert resp.status_code == 422
        body = json.loads(resp.body.decode())
        assert body["code"] == "VALIDATION_ERROR"
        assert "amount" in body["detail"]
        assert len(body["errors"]) > 0
        assert body["errors"][0]["loc"] == ["amount"]


def test_validation_exception_handler_names_client_ref_too_short():
    """Verify short client_ref generates clear message naming client_ref."""
    scope = {"type": "http", "method": "POST", "path": "/api/v1/sales", "headers": []}
    req = Request(scope)

    try:
        SaleCreate(
            company="MCT Main",
            transaction_date="2026-11-17",
            amount=Decimal("150.00"),
            particulars="Test",
            category="Services",
            client_ref="row-1",  # 5 characters, triggers string_too_short
        )
    except Exception as exc:
        pydantic_errors = exc.errors() if hasattr(exc, "errors") else []
        req_exc = RequestValidationError(pydantic_errors)
        resp = validation_exception_handler(req, req_exc)
        assert resp.status_code == 422
        body = json.loads(resp.body.decode())
        assert body["code"] == "VALIDATION_ERROR"
        assert "client_ref" in body["detail"]
        assert "8 characters" in body["detail"]
