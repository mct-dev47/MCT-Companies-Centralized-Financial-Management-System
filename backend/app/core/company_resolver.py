from __future__ import annotations
from typing import Optional
from sqlalchemy.orm import Session
from app.models.company import Company
from fastapi import HTTPException


EMAIL_ALIASES: dict[str, str] = {}

COMPANY_ALIASES: dict[str, list[str]] = {}


def normalize_company_id(company_id: object) -> Optional[int]:
    """Validate and return positive company ID directly from the database."""
    if company_id is None or isinstance(company_id, bool):
        return None
    try:
        val = int(company_id)
        if val <= 0:
            return None
        return val
    except (ValueError, TypeError):
        return None


def normalize_email(email: Optional[str]) -> Optional[str]:
    """Normalize email string."""
    if not email:
        return email
    return email.strip().lower()


def resolve_company(
    db: Session,
    company_id: Optional[int] = None,
    company_name: Optional[str] = None,
) -> Company:
    """
    Resolve a company directly from the database using ID or company name.
    """
    # 1. Check normalized ID if provided
    norm_id = normalize_company_id(company_id)
    if norm_id:
        c = db.query(Company).filter(Company.company_id == norm_id).first()
        if c:
            return c

    all_companies = db.query(Company).all()

    # If no name provided, fall back to first company if available
    if not company_name or not company_name.strip() or company_name.strip().lower() == "all companies":
        if all_companies:
            return all_companies[0]
        raise HTTPException(status_code=400, detail="A valid company is required.")

    clean_name = company_name.strip()
    clean_lower = clean_name.lower()

    # 2. Exact case-insensitive match
    for c in all_companies:
        if c.company_name.strip().lower() == clean_lower:
            return c

    # 3. Containment match (target in db name or db name in target)
    for c in all_companies:
        c_clean = c.company_name.strip().lower()
        if clean_lower in c_clean or c_clean in clean_lower:
            return c

    # 4. Significant word match
    words = [w for w in clean_lower.replace("&", " ").replace(".", " ").replace("|", " ").split() if len(w) >= 4]
    for w in words:
        for c in all_companies:
            if w in c.company_name.lower():
                return c

    raise HTTPException(status_code=400, detail=f"Company '{company_name}' could not be resolved.")
