"""Audit review fields shared by sales and expenses (spec 0014)."""
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

AuditStatusValue = Literal["Pending Audit", "Verified", "Flagged"]

PENDING_AUDIT = "Pending Audit"
VALID_AUDIT_STATUSES = ("Pending Audit", "Verified", "Flagged")


class AuditReviewIn(BaseModel):
    audit_status: AuditStatusValue
    remarks: Optional[str] = Field(None, max_length=2000)


def audit_fields(source: Any) -> dict:
    """
    Read the four audit values from a Supabase row (dict) or a model object, so every place
    that builds a SaleOut or ExpenseOut can do `**audit_fields(row)`.
    A missing or unknown status reads as Pending Audit.
    """
    get = source.get if isinstance(source, dict) else (lambda k, d=None: getattr(source, k, d))
    status = get("audit_status", None)
    if status not in VALID_AUDIT_STATUSES:
        status = PENDING_AUDIT
    return {
        "audit_status": status,
        "audited_by": get("audited_by", None),
        "audited_at": get("audited_at", None),
        "audit_remarks": get("audit_remarks", None),
    }
