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
    ):
        self.limit = limit
        self.offset = offset

