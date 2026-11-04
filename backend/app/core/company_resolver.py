from __future__ import annotations
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.company import Company
from fastapi import HTTPException


# Known email aliases for seeded accounts
EMAIL_ALIASES: dict[str, str] = {
    "temporaryemployee@gmail.com": "temporary.employee@mct.com",
    "auditor@mct.com": "audit@mct.com",
    "finance.manager@mct.com": "finance@mct.com",
}

# Known company aliases across trade names and registered corporate names
COMPANY_ALIASES: dict[str, list[str]] = {
    "mct kitchen": ["mycity kitchen", "mycity.kitchen", "mycity.kitchen corporation", "kitchen"],
    "mycity.kitchen corporation": ["mct kitchen", "mycity kitchen", "mycity.kitchen", "kitchen"],
    "kitchen": ["mycity.kitchen", "mycity kitchen", "mct kitchen"],
    "mct hotel": [
        "mctolentino",
        "mctolentino hospitality",
        "mctolentino hospitality business corporation",
        "hotel",
        "hospitality",
    ],
    "mctolentino hospitality business corporation": [
        "mct hotel",
        "mctolentino",
        "mctolentino hospitality",
        "hotel",
        "hospitality",
    ],
    "speedbox": ["speedfire construction", "speedfire", "speedfire construction & trading corporation"],
    "speedfire": ["speedfire construction", "speedfire", "speedbox", "speedfire construction & trading corporation"],
    "speedfire construction & trading corporation": ["speedfire", "speedbox", "speedfire construction"],
    "jk printing": ["jk global printing", "jk global headways", "printing", "jk global printing service"],
    "jk global printing service": ["jk printing", "printing", "jk global headways"],
    "jk property": ["jk property and ventures", "property ventures", "jk property & ventures", "jk property and ventures corporation"],
    "jk property and ventures": [
        "jk property and ventures corporation",
        "jk property",
        "property ventures",
        "jk property & ventures",
    ],
    "jk property and ventures corporation": [
        "jk property and ventures",
        "jk property",
        "property ventures",
    ],
    "golden sunburst": ["golden jupiter property ventures", "golden jupiter", "golden sunburst", "golden jupiter property ventures corporation"],
    "golden sunburst ventures": ["golden jupiter property ventures", "golden jupiter", "golden sunburst", "golden jupiter property ventures corporation"],
    "golden jupiter property ventures corporation": ["golden sunburst", "golden sunburst ventures", "golden jupiter"],
    "filcap": ["filcap prime", "filcap prime holdings", "filcap prime holdings corp.", "filcam"],
    "filcap prime holdings corp.": ["filcap", "filcap prime", "filcam"],
    "far east asia": ["far east asia trading corporation", "far east asia"],
    "far east asia trading corporation": ["far east asia"],
    "mc tolentino": ["m.c tolentino", "tolentino college", "college foundation", "m.c tolentino college foundation, incorporation"],
    "m.c tolentino college foundation, incorporation": ["mc tolentino", "tolentino college", "college foundation"],
    "bagong bansa": ["bagong bansa may pag asa", "bagong bansa", "bagong bansa may pag asa movement, incorporation"],
    "bagong bansa may pag asa movement, incorporation": ["bagong bansa", "bagong bansa may pag asa"],
    "bookworld": ["bookworld systems solutions", "bookworld", "bookworld systems solutions & technologies corporation"],
    "bookworld systems solutions & technologies corporation": ["bookworld", "bookworld systems solutions"],
    "medsys": ["medsys uni horizon", "medsys uni horizon pharma corporation"],
}


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
    """Normalize and resolve email aliases to primary account emails."""
    if not email:
        return email
    clean = email.strip().lower()
    if "@" not in clean:
        clean = f"{clean}@mct.com"
    return EMAIL_ALIASES.get(clean, clean)


def resolve_company(
    db: Session,
    company_id: Optional[int] = None,
    company_name: Optional[str] = None,
) -> Company:
    """
    Resolve a company reliably using ID (with legacy ID normalization)
    or company name (using exact match, alias dictionaries, and fuzzy containment).
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

    # 3. Known aliases lookup
    for alias_key, search_terms in COMPANY_ALIASES.items():
        if alias_key in clean_lower or clean_lower in alias_key:
            for term in search_terms:
                for c in all_companies:
                    if term in c.company_name.strip().lower():
                        return c

    # 4. Containment match (target in db name or db name in target)
    for c in all_companies:
        c_clean = c.company_name.strip().lower()
        if clean_lower in c_clean or c_clean in clean_lower:
            return c

    # 5. Significant word match
    words = [w for w in clean_lower.replace("&", " ").replace(".", " ").replace("|", " ").split() if len(w) >= 4]
    for w in words:
        for c in all_companies:
            if w in c.company_name.lower():
                return c

    raise HTTPException(status_code=400, detail=f"Company '{company_name}' could not be resolved.")
