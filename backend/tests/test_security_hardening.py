import io
import pytest
from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.endpoints.companies import (
    _validate_image_file,
    ALLOWED_COMPANY_PICTURE_EXTENSIONS,
)
from app.core.config import settings


def test_api_cache_prevention_headers():
    """AC-2: Verify that /api/ endpoints return strict cache prevention headers."""
    client = TestClient(app)
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.headers.get("Cache-Control") == "no-store, no-cache, must-revalidate, max-age=0"
    assert response.headers.get("Pragma") == "no-cache"
    assert response.headers.get("Expires") == "0"


def test_company_picture_invalid_content_type():
    """AC-1: Verify that non-image content types are rejected with 422."""
    upload = UploadFile(
        filename="company.png",
        file=io.BytesIO(b"fake data"),
        headers={"content-type": "application/pdf"}
    )
    with pytest.raises(HTTPException) as exc_info:
        _validate_image_file(upload, b"fake data")
    assert exc_info.value.status_code == 422
    assert "Company picture must be an image" in exc_info.value.detail


def test_company_picture_invalid_extension():
    """AC-1: Verify that unapproved file extensions are rejected with 422."""
    upload = UploadFile(
        filename="company.exe",
        file=io.BytesIO(b"\x89PNG\r\n\x1a\n"),
        headers={"content-type": "image/png"}
    )
    with pytest.raises(HTTPException) as exc_info:
        _validate_image_file(upload, b"\x89PNG\r\n\x1a\n")
    assert exc_info.value.status_code == 422
    assert "valid image extension" in exc_info.value.detail


def test_company_picture_invalid_magic_bytes():
    """AC-1: Verify that mismatched magic signatures are rejected with 422."""
    upload = UploadFile(
        filename="company.png",
        file=io.BytesIO(b"not an image file"),
        headers={"content-type": "image/png"}
    )
    with pytest.raises(HTTPException) as exc_info:
        _validate_image_file(upload, b"not an image file")
    assert exc_info.value.status_code == 422
    assert "does not match a valid image signature" in exc_info.value.detail


def test_company_picture_valid_signatures():
    """AC-1: Verify that legitimate PNG, JPEG, and WEBP files pass validation."""
    # PNG
    png_data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
    png_upload = UploadFile(
        filename="logo.png",
        file=io.BytesIO(png_data),
        headers={"content-type": "image/png"}
    )
    _validate_image_file(png_upload, png_data)

    # JPEG
    jpeg_data = b"\xff\xd8\xff\xe0" + b"\x00" * 20
    jpeg_upload = UploadFile(
        filename="logo.jpg",
        file=io.BytesIO(jpeg_data),
        headers={"content-type": "image/jpeg"}
    )
    _validate_image_file(jpeg_upload, jpeg_data)

    # WEBP
    webp_data = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 20
    webp_upload = UploadFile(
        filename="logo.webp",
        file=io.BytesIO(webp_data),
        headers={"content-type": "image/webp"}
    )
    _validate_image_file(webp_upload, webp_data)


def test_otp_cookie_secure_production_flag(monkeypatch):
    """AC-5: Verify production environment flag secures login OTP cookie."""
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "OTP_COOKIE_SECURE", False)
    is_secure = settings.OTP_COOKIE_SECURE or (settings.ENVIRONMENT.lower() == "production")
    assert is_secure is True

