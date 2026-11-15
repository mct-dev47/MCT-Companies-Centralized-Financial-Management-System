from __future__ import annotations
from typing import Optional
from sqlalchemy import event
from sqlalchemy.orm import Session
from app.core.cache import get_cached, invalidate_cached_tag, set_cached
from app.models.company import Company
from fastapi import HTTPException


EMAIL_ALIASES: dict[str, str] = {}

COMPANY_ALIASES: dict[str, list[str]] = {}

# ---------------------------------------------------------------------------
# Cached company directory
# ---------------------------------------------------------------------------
# The company table is tiny and rarely changes, but it was being re-read in
# full on almost every request (resolvers, name maps), which showed up as tens
# of thousands of calls in pg_stat_statements and counted toward DB egress.
# We cache only (company_id, company_name) pairs, ordered by company_id, and
# evict on any ORM write to Company. The short TTL bounds staleness across
# multiple worker processes and writes made outside the ORM.

COMPANY_CACHE_TAG = "companies"
_COMPANY_DIRECTORY_KEY = "company_directory:v1"
_COMPANY_DIRECTORY_TTL_SECONDS = 120


def get_company_directory(db: Session) -> list[tuple[int, str]]:
    """Return cached [(company_id, company_name), ...] ordered by company_id."""
    cached = get_cached(_COMPANY_DIRECTORY_KEY)
    if cached is not None:
        return cached
    rows = (
        db.query(Company.company_id, Company.company_name)
        .order_by(Company.company_id.asc())
        .all()
    )
    directory = [(int(cid), name or "") for cid, name in rows]
    set_cached(
        _COMPANY_DIRECTORY_KEY,
        directory,
        ttl_seconds=_COMPANY_DIRECTORY_TTL_SECONDS,
        tags=[COMPANY_CACHE_TAG],
    )
    return directory


def get_company_name_map(db: Session) -> dict[int, str]:
    """Return a cached {company_id: company_name} map."""
    return dict(get_company_directory(db))


def invalidate_company_cache() -> None:
    invalidate_cached_tag(COMPANY_CACHE_TAG)


def _on_company_change(*_args, **_kwargs) -> None:
    invalidate_company_cache()


for _evt in ("after_insert", "after_update", "after_delete"):
    event.listen(Company, _evt, _on_company_change)


@event.listens_for(Session, "after_bulk_update")
@event.listens_for(Session, "after_bulk_delete")
def _on_company_bulk_change(ctx) -> None:
    mapper = getattr(ctx, "mapper", None)
    if mapper is not None and mapper.class_ is Company:
        invalidate_company_cache()


def match_company_id(directory: list[tuple[int, str]], company_name: str) -> Optional[int]:
    """Fuzzy-match a company name against the directory (exact, containment, word)."""
    clean_lower = company_name.strip().lower()
    for cid, name in directory:
        if name.strip().lower() == clean_lower:
            return cid
    for cid, name in directory:
        c_clean = name.strip().lower()
        if clean_lower in c_clean or c_clean in clean_lower:
            return cid
    words = [w for w in clean_lower.replace("&", " ").replace(".", " ").replace("|", " ").split() if len(w) >= 4]
    for w in words:
        for cid, name in directory:
            if w in name.lower():
                return cid
    return None


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

    no_name = not company_name or not company_name.strip() or company_name.strip().lower() == "all companies"

    # Two attempts: if the cached directory points at a company that no longer
    # exists (deleted by another worker), refresh the cache once and retry.
    for _attempt in range(2):
        directory = get_company_directory(db)
        if no_name:
            # If no name provided, fall back to first company if available
            if not directory:
                raise HTTPException(status_code=400, detail="A valid company is required.")
            matched_id = directory[0][0]
        else:
            # 2-4. Exact, containment, then significant-word match (cached names)
            matched_id = match_company_id(directory, company_name)
            if matched_id is None:
                raise HTTPException(status_code=400, detail=f"Company '{company_name}' could not be resolved.")
        company = db.get(Company, matched_id)
        if company is not None:
            return company
        invalidate_company_cache()

    raise HTTPException(status_code=400, detail=f"Company '{company_name}' could not be resolved.")
