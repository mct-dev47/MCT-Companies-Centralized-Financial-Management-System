from decimal import Decimal
from pathlib import PurePosixPath
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.core.dependencies import (
    AdminUser,
    AuthenticatedUser,
    CurrentUser,
    check_company_access,
    get_current_user,
    require_reauthentication,
)
from app.db.session import get_db
from app.models.company import Company
from app.schemas.company import AuthorizedCompanyOut, CompanyCreate, CompanyLookupOut, CompanyOut, CompanyUpdate
from app.schemas.notification import CompanyNotificationSettingsOut, CompanyNotificationSettingsUpdate
from app.services.company_service import CompanyService, CompanyServiceError
from app.services.audit_service import AuditAction, log_company_management

router = APIRouter()
ALLOWED_COMPANY_PICTURE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_COMPANY_PICTURE_BYTES = 5 * 1024 * 1024


def _validate_image_file(picture: UploadFile, picture_data: bytes) -> None:
    if not picture.content_type or not picture.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Company picture must be an image.",
        )

    filename = picture.filename or ""
    extension = PurePosixPath(filename).suffix.lower()
    if extension not in ALLOWED_COMPANY_PICTURE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Company picture must have a valid image extension (.jpg, .jpeg, .png, .webp).",
        )

    if len(picture_data) > MAX_COMPANY_PICTURE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Company picture must be 5 MB or smaller.",
        )

    is_valid_image = (
        picture_data.startswith(b"\xff\xd8\xff")  # JPEG
        or picture_data.startswith(b"\x89PNG\r\n\x1a\n")  # PNG
        or (picture_data.startswith(b"RIFF") and picture_data[8:12] == b"WEBP")  # WEBP
        or picture_data.startswith(b"GIF87a")
        or picture_data.startswith(b"GIF89a")  # GIF
    )
    if not is_valid_image:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Company picture content does not match a valid image signature (JPEG, PNG, WEBP, or GIF).",
        )


# get all companies (accessible to authenticated users)
@router.get("", response_model=list[CompanyOut], summary="List all MCT companies")
def get_companies(
    _: CurrentUser,
    db: Session = Depends(get_db),
):
    try:
        return CompanyService(db).list_companies()
    except CompanyServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error


# fast lightweight lookup for company dropdowns and selectors
@router.get("/lookup", response_model=list[CompanyLookupOut], summary="Fast company lookup for dropdowns")
def lookup_companies(
    _: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return CompanyService(db).list_companies_lookup()
    except CompanyServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error


# list authorized companies for centralized authentication portal
# strictly returns data from the company table in the database
@router.get("/authorized", response_model=list[AuthorizedCompanyOut], summary="List authorized companies for centralized auth")
def get_authorized_companies(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = (current_user.get("role") or "").lower()
    if role == "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin users manage companies at /employee and do not access centralized business portals.",
        )

    query = db.query(Company)

    allowed_ids = set()
    if current_user.get("company_ids"):
        for cid in current_user["company_ids"]:
            try:
                if cid is not None:
                    allowed_ids.add(int(cid))
            except (ValueError, TypeError):
                pass
    if current_user.get("company_id") is not None:
        try:
            allowed_ids.add(int(current_user["company_id"]))
        except (ValueError, TypeError):
            pass

    if role in ("finance", "audit", "auditor"):
        user_role_label = "Finance" if role == "finance" else "Auditor"
        if allowed_ids:
            companies = query.filter(Company.company_id.in_(allowed_ids)).order_by(Company.company_id.asc()).all()
        else:
            companies = query.order_by(Company.company_id.asc()).all()
    elif role == "supervisor":
        user_role_label = "Supervisor"
        if not allowed_ids:
            return []
        companies = query.filter(Company.company_id.in_(allowed_ids)).order_by(Company.company_id.asc()).all()
    else:
        if not allowed_ids:
            return []
        user_role_label = role.capitalize()
        companies = query.filter(Company.company_id.in_(allowed_ids)).order_by(Company.company_id.asc()).all()

    return [
        AuthorizedCompanyOut(
            id=c.company_id,
            name=c.company_name,
            location=c.location,
            contact_number=c.contact_number,
            phone=c.phone,
            starting_balance=float(c.starting_balance),
            petty_cash=float(c.petty_cash or 0.0),
            logo_url=c.logo_url,
            role=user_role_label,
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c in companies
    ]


# get company by ID
@router.get("/{company_id}", response_model=CompanyOut, summary="Get company by ID")
def get_company(
    company_id: int,
    _: CurrentUser,
    db: Session = Depends(get_db),
):
    try:
        company = CompanyService(db).get_company_response(company_id)
    except CompanyServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return company


# create a new company (Admin only)
@router.post("", response_model=CompanyOut, status_code=status.HTTP_201_CREATED, summary="Create a new company")
def create_company(
    company: CompanyCreate,
    request: Request,
    admin: AdminUser,
    db: Session = Depends(get_db),
):
    try:
        result = CompanyService(db).create_company(company)
    except CompanyServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error

    log_company_management(
        db, AuditAction.COMPANY_CREATED,
        user_id=admin.get("user_id"),
        company_id=result.id,
        ip_address=request.client.host if request.client else "unknown",
        extra={"company_name": result.name},
    )
    return result


@router.post(
    "/with-picture",
    response_model=CompanyOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new company with a profile picture (Admin only)",
)
async def create_company_with_picture(
    request: Request,
    admin: AdminUser,
    name: str = Form(...),
    location: str = Form(...),
    contact_number: str | None = Form(None),
    phone: str | None = Form(None),
    starting_balance: Decimal = Form(Decimal("0.00")),
    petty_cash: Decimal = Form(Decimal("0.00")),
    picture: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    picture_data = await picture.read()
    _validate_image_file(picture, picture_data)

    company = CompanyCreate(
        name=name,
        location=location,
        contact_number=contact_number,
        phone=phone,
        starting_balance=starting_balance,
        petty_cash=petty_cash,
    )
    try:
        result = CompanyService(db).create_company_with_picture(
            company,
            picture_data,
            picture.content_type,
            picture.filename or "company-picture",
        )
    except CompanyServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error

    log_company_management(
        db,
        AuditAction.COMPANY_CREATED,
        user_id=admin.get("user_id"),
        company_id=result.id,
        ip_address=request.client.host if request.client else "unknown",
        extra={"company_name": result.name},
    )
    return result


# update an existing company (Admin only)
@router.patch("/{company_id}", response_model=CompanyOut, summary="Update an existing company (Admin only)")
def update_company(
    company_id: int,
    company_update: CompanyUpdate,
    request: Request,
    admin: AdminUser,
    db: Session = Depends(get_db),
):
    service = CompanyService(db)
    try:
        result = service.update_company(company_id, company_update)
    except CompanyServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    log_company_management(
        db, AuditAction.COMPANY_UPDATED,
        user_id=admin.get("user_id"),
        company_id=result.id,
        ip_address=request.client.host if request.client else "unknown",
        extra={"company_name": result.name},
    )
    return result


@router.post(
    "/{company_id}/picture",
    response_model=CompanyOut,
    summary="Upload or update profile picture for an existing company (Admin only)",
)
async def upload_company_picture(
    company_id: int,
    request: Request,
    admin: AdminUser,
    picture: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    picture_data = await picture.read()
    _validate_image_file(picture, picture_data)

    try:
        result = CompanyService(db).upload_company_picture(
            company_id,
            picture_data,
            picture.content_type,
            picture.filename or "company-picture",
        )
    except CompanyServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error

    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    log_company_management(
        db,
        AuditAction.COMPANY_UPDATED,
        user_id=admin.get("user_id"),
        company_id=result.id,
        ip_address=request.client.host if request.client else "unknown",
        extra={"company_name": result.name, "action": "update_picture"},
    )
    return result


# delete a company (Admin only)
@router.delete("/{company_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a company (Admin only)")
def delete_company(
    company_id: int,
    request: Request,
    admin: AdminUser,
    _reauth: AuthenticatedUser = Depends(require_reauthentication),
    db: Session = Depends(get_db),
):
    try:
        deleted = CompanyService(db).delete_company(company_id)
    except CompanyServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    log_company_management(
        db, AuditAction.COMPANY_DELETED,
        user_id=admin.get("user_id"),
        company_id=None,
        ip_address=request.client.host if request.client else "unknown",
        extra={"deleted_company_id": company_id},
    )


@router.get(
    "/{company_id}/notification-settings",
    response_model=CompanyNotificationSettingsOut,
    summary="Get company notification alert settings",
)
def get_company_notification_settings(
    company_id: int,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    check_company_access(current_user, company_id)
    try:
        result = CompanyService(db).get_notification_settings(company_id)
    except CompanyServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return result


@router.put(
    "/{company_id}/notification-settings",
    response_model=CompanyNotificationSettingsOut,
    summary="Update company notification alert settings (Admin only)",
)
def update_company_notification_settings(
    company_id: int,
    settings_in: CompanyNotificationSettingsUpdate,
    request: Request,
    admin: AdminUser,
    db: Session = Depends(get_db),
):
    try:
        result = CompanyService(db).update_notification_settings(company_id, settings_in)
    except CompanyServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    log_company_management(
        db,
        AuditAction.COMPANY_UPDATED,
        user_id=admin.get("user_id"),
        company_id=company_id,
        ip_address=request.client.host if request.client else "unknown",
        extra={
            "action": "update_notification_settings",
            "transaction_alerts": result.transaction_alerts,
            "loan_reminders": result.loan_reminders,
            "daily_summary": result.daily_summary,
            "audit_alerts": result.audit_alerts,
        },
    )
    return result

