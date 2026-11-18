from typing import Optional
from fastapi import Query


class PaginationParams:
    """
    Standard query parameter dependency for paginating collection endpoints.
    Enforces a default limit of 50 and maximum limit of 100 to prevent server resource exhaustion.
    """
    def __init__(
        self,
        limit: int = Query(default=50, ge=1, le=100, description="Items per page (1-100, default: 50)"),
        offset: int = Query(default=0, ge=0, description="Number of items to skip (offset)"),
        page: Optional[int] = Query(default=None, ge=1, description="1-based page number (overrides offset when provided)"),
    ):
        self.limit = limit if isinstance(limit, int) else 50
        raw_page = page if isinstance(page, int) else None
        if raw_page is not None:
            self.page = raw_page
            self.offset = (raw_page - 1) * self.limit
        else:
            self.offset = offset if isinstance(offset, int) else 0
            self.page = (self.offset // self.limit) + 1 if self.limit > 0 else 1

