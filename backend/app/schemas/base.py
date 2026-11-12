from typing import Any, Generic, List, TypeVar
from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class StrictBaseModel(BaseModel):
    """
    Base model for API request schemas that strictly forbids undeclared/unexpected fields
    and strips leading/trailing whitespace from string inputs.
    """
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
    )


class PaginatedResponse(BaseModel, Generic[T]):
    """
    Standard envelope for paginated list responses.
    """
    items: List[T]
    total: int = Field(..., ge=0, description="Total matching items across all pages")
    limit: int = Field(..., ge=1, le=100, description="Page limit applied")
    offset: int = Field(..., ge=0, description="Page offset applied")

