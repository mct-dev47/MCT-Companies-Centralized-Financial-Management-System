from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.core.dependencies import AdminUser, CurrentUser
from app.db.session import get_db
from app.schemas.company import CompanyCreate, CompanyOut, CompanyUpdate
from app.services.company_service import CompanyService, CompanyServiceError
from app.services.audit_service import AuditAction, log_company_management

router = APIRouter()
MAX_COMPANY_PICTURE_BYTES = 5 * 1024 * 1024

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
    starting_balance: Decimal = Form(...),
    petty_cash: Decimal = Form(Decimal("0.00")),
    picture: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not picture.content_type or not picture.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Company picture must be an image.",
        )

    picture_data = await picture.read()
    if len(picture_data) > MAX_COMPANY_PICTURE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Company picture must be 5 MB or smaller.",
        )

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
    if not picture.content_type or not picture.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Company picture must be an image.",
        )

    picture_data = await picture.read()
    if len(picture_data) > MAX_COMPANY_PICTURE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Company picture must be 5 MB or smaller.",
        )

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
