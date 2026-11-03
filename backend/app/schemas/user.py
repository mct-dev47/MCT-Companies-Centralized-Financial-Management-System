import re
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


NAME_REGEX = re.compile(r"^[\w\s.'\-]+$", re.UNICODE)


class UserBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    company_id: Optional[int] = None
    company_name: Optional[str] = None
    company_ids: List[int] = Field(default_factory=list)
    is_admin: bool = False
    role: str = Field(default="supervisor", description="Role of the user: admin, audit, finance, supervisor")
    photo_url: Optional[str] = None


class UserCreate(UserBase):
    name: str = Field(min_length=2, max_length=100)

    model_config = ConfigDict(extra="forbid")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        clean = v.strip()
        if len(clean) < 2:
            raise ValueError("Name must be at least 2 characters.")
        if not NAME_REGEX.match(clean):
            raise ValueError("Name contains invalid characters.")
        return clean

    @field_validator("email")
    @classmethod
    def validate_email_domain(cls, v: EmailStr) -> EmailStr:
        normalized = str(v).strip().lower()
        if not normalized.endswith("@gmail.com"):
            raise ValueError("Only @gmail.com email addresses are allowed for new user creation.")
        return v

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        cleaned = (v or "").strip().lower()
        if cleaned not in ("finance", "audit", "auditor", "supervisor"):
            raise ValueError(
                f"Invalid role '{v}'. Allowed roles: Finance, Audit, Supervisor. Note: 'Company' is an organization, not a user role."
            )
        return cleaned


class UserUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    company_id: Optional[int] = None
    company_ids: Optional[List[int]] = None
    role: Optional[str] = None
    photo_url: Optional[str] = None
    is_admin: Optional[bool] = None
    status: Optional[str] = None


class UserResponse(UserBase):
    user_id: int
    created_at: datetime
    updated_at: datetime
    status: str = "ACTIVE"
    must_change_password: bool = False

    model_config = ConfigDict(from_attributes=True)
