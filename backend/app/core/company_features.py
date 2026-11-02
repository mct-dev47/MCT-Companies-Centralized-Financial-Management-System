from __future__ import annotations
from typing import Optional
from fastapi import HTTPException, status
from app.core.company_resolver import normalize_company_id

COMPANY_FEATURE_TENANTS = "tenants"
COMPANY_FEATURE_LENDING = "lending"

# Canonical Company IDs in Database
JK_PROPERTY_COMPANY_ID = 5
FILCAP_COMPANY_ID = 7

def is_feature_authorized_for_company(
    feature: str,
    company_id: Optional[int],
    company_name: Optional[str] = None,
) -> bool:
    """
    Check whether a business feature (Tenants or Lending) is authorized for a specific company.
    - Tenants: Exclusively JK Property and Ventures Corporation (ID 5).
    - Lending: Exclusively FILCAP Prime Holdings Corp. (ID 7).
    """
    cid = normalize_company_id(company_id)
    cname = (company_name or "").lower().replace(" ", "").replace(".", "").replace("-", "")

    if feature == COMPANY_FEATURE_TENANTS:
        if cid is not None:
            return cid == JK_PROPERTY_COMPANY_ID
        return "jkproperty" in cname or "jkventures" in cname

    if feature == COMPANY_FEATURE_LENDING:
        if cid is not None:
            return cid == FILCAP_COMPANY_ID
        return "filcap" in cname or "filcam" in cname

    return True


def require_company_feature_access(
    feature: str,
    company_id: Optional[int],
    company_name: Optional[str] = None,
) -> None:
    """
    Enforce company-specific feature gatekeeping.
    Raises HTTP 403 Forbidden if the company is not authorized for the requested feature.
    """
    if not is_feature_authorized_for_company(feature, company_id, company_name):
        feature_name = "Tenants" if feature == COMPANY_FEATURE_TENANTS else "Lending"
        target_name = (
            "JK Property and Ventures Corporation"
            if feature == COMPANY_FEATURE_TENANTS
            else "FILCAP Prime Holdings Corp."
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied: The {feature_name} module is exclusively authorized for {target_name}.",
        )

