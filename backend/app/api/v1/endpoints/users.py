from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.dependencies import AdminUser, CurrentUser
from app.db.session import get_db
from app.schemas.user import UserCreate, UserResponse, UserUpdate
from app.services.user_service import (
    UserService,
    UserServiceError,
    UserValidationError,
)

router = APIRouter()
MAX_USER_PICTURE_BYTES = 5 * 1024 * 1024

# get all users
@router.get("", response_model=list[UserResponse], summary="List application users")
def get_users(
    _: AdminUser,
    company_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
):
    try:
        return UserService(db).list_users(company_id=company_id)
    except UserServiceError as error:
        raise _service_http_error(error) from error

# get a single user by ID
@router.get("/{user_id}", response_model=UserResponse, summary="Get an application user")
def get_user(user_id: int, _: AdminUser, db: Session = Depends(get_db)):
    try:
        user = UserService(db).get_user_response(user_id)
    except UserServiceError as error:
        raise _service_http_error(error) from error
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user

# create a new user
@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED, summary="Create an employee user")
def create_user(user: UserCreate, _: AdminUser, db: Session = Depends(get_db)):
    try:
        return UserService(db).create_user(user)
    except UserValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    except UserServiceError as error:
        raise _service_http_error(error) from error

# update an existing user
@router.patch("/{user_id}", response_model=UserResponse, summary="Update an application user")
@router.put("/{user_id}", response_model=UserResponse, summary="Update an application user (PUT alias)")
def update_user(
    user_id: int,
    user: UserUpdate,
    _: AdminUser,
    db: Session = Depends(get_db),
):
    try:
        result = UserService(db).update_user(user_id, user)
    except UserValidationError as error:
        if "protected" in str(error).lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=str(error),
            ) from error
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    except UserServiceError as error:
        raise _service_http_error(error) from error
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return result

# upload profile picture for a user
@router.post("/{user_id}/picture", response_model=UserResponse, summary="Upload profile picture for a user")
async def upload_user_picture(
    user_id: int,
    _: AdminUser,
    picture: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not picture.content_type or not picture.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Profile picture must be an image.",
        )

    picture_data = await picture.read()
    if len(picture_data) > MAX_USER_PICTURE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Profile picture must be 5 MB or smaller.",
        )

    # Validate image signature via byte inspection
    is_valid_image = (
        picture_data.startswith(b"\xff\xd8\xff")  # JPEG
        or picture_data.startswith(b"\x89PNG\r\n\x1a\n")  # PNG
        or (picture_data.startswith(b"RIFF") and picture_data[8:12] == b"WEBP")  # WEBP
        or picture_data.startswith(b"GIF87a") or picture_data.startswith(b"GIF89a")  # GIF
    )
    if not is_valid_image:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Profile picture must be a valid image file (JPEG, PNG, or WEBP).",
        )

    try:
        result = UserService(db).upload_user_picture(
            user_id,
            picture_data,
            picture.content_type,
            picture.filename or "profile-picture.png",
        )
    except UserValidationError as error:
        if "protected" in str(error).lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=str(error),
            ) from error
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    except UserServiceError as error:
        raise _service_http_error(error) from error

    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return result

# delete a user by ID
@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete an application user")
def delete_user(user_id: int, _: AdminUser, db: Session = Depends(get_db)):
    try:
        deleted = UserService(db).delete_user(user_id)
    except UserValidationError as error:
        if "protected" in str(error).lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=str(error),
            ) from error
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    except UserServiceError as error:
        raise _service_http_error(error) from error
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

# get user profile picture (redirects to active signed URL)
@router.get("/{user_id}/picture", summary="Get user profile picture")
def get_user_picture(user_id: int, _: CurrentUser, db: Session = Depends(get_db)):
    user = UserService(db).get_user(user_id)
    if not user or not user.photo_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile picture not found")
    path = UserService(db)._extract_storage_path(user.photo_url)
    if not path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile picture path invalid")
    signed_url = UserService(db)._sign_url(path)
    if not signed_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Could not generate picture URL")
    return RedirectResponse(url=signed_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)



# return a 500 Internal Server Error for service errors
def _service_http_error(error: UserServiceError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=str(error),
    )
