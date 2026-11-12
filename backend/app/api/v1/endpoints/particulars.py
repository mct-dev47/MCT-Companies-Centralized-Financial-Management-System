import re
from typing import Dict, List, Optional, Set
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.company_resolver import resolve_company
from app.core.dependencies import (
    AuthenticatedUser,
    check_company_access,
    require_business_reader,
    require_business_writer,
)
from app.db.session import get_db
from app.db.supabase import get_supabase_admin_client
from app.models.finance import Expense, Sale
from app.models.particular import CompanyParticular
from app.schemas.particular import CompanyParticularCreate, CompanyParticularOut

router = APIRouter()


def extract_particular_names(raw_text: Optional[str]) -> List[str]:
    """
    Extracts clean, reusable itemized particular names from raw particulars strings.
    Removes systemic prefixes, pricing formulas, quantity indicators, and status tags.
    """
    if not raw_text or not str(raw_text).strip():
        return []
    results: List[str] = []
    lines = [ln.strip() for ln in str(raw_text).strip().splitlines() if ln.strip()]
    for line in lines:
        cleaned = line.strip()
        for prefix in (
            "sales collection:",
            "expense disbursement:",
            "adjustment reversal on receivable -",
            "rental payment -",
            "petty cash reimbursement for",
            "petty cash reimbursement",
            "petty cash top up funded for",
            "petty cash top up from",
        ):
            if cleaned.lower().startswith(prefix):
                cleaned = cleaned[len(prefix):].strip()

        # Remove trailing status tags like [Paid], [Unpaid], [Pending], [On hold], [Verified]
        cleaned = re.sub(
            r"\s*\[(Paid|Unpaid|Pending|On hold|Verified|Overdue)\]\s*$",
            "",
            cleaned,
            flags=re.IGNORECASE,
        ).strip()

        # Remove trailing pricing/qty pattern: e.g. (2x @ ₱500.00 = ₱1,000.00) or (2x) or (₱2,500.00)
        cleaned = re.sub(r"\s*\(\s*\d+\s*x.*?\)\s*$", "", cleaned, flags=re.IGNORECASE).strip()
        cleaned = re.sub(r"\s*\(\s*₱?[\d,]+(\.\d+)?\s*\)\s*$", "", cleaned).strip()

        # Remove leading numbering like 1. or #1
        cleaned = re.sub(r"^(\d+[\.\)]|\#\d+)\s*", "", cleaned).strip()

        # Strip trailing colon or dashes
        cleaned = cleaned.strip(":- ")
        if (
            cleaned
            and len(cleaned) >= 2
            and not cleaned.lower().startswith("ref-")
            and not cleaned.lower().startswith("chq-")
        ):
            results.append(cleaned)
    return results


def save_company_particular_if_not_exists(
    db: Session,
    company_id: Optional[int],
    company_name: Optional[str],
    name: str,
    transaction_type: str = "Sales",
) -> Optional[CompanyParticular]:
    """
    Persists a particular to company_particulars if not already present.
    Synchronizes across local SQLite and Supabase.
    """
    cleaned_name = (name or "").strip()
    if not cleaned_name or len(cleaned_name) < 2:
        return None

    tx_type = "Expense" if (transaction_type or "").strip().lower() == "expense" else "Sales"
    target_id = company_id
    target_name = company_name

    if not target_id and target_name:
        try:
            comp = resolve_company(db, company_name=target_name)
            target_id = comp.company_id
            target_name = comp.company_name
        except Exception:
            pass
    elif target_id and not target_name:
        try:
            comp = resolve_company(db, company_id=target_id)
            target_name = comp.company_name
        except Exception:
            pass

    # Check local duplicate
    duplicate_filters = [
        func.lower(CompanyParticular.name) == cleaned_name.lower(),
    ]
    if target_id and target_name:
        duplicate_filters.append(
            (CompanyParticular.company_id == target_id)
            | (func.lower(CompanyParticular.company_name) == func.lower(target_name))
        )
    elif target_id:
        duplicate_filters.append(CompanyParticular.company_id == target_id)
    elif target_name:
        duplicate_filters.append(func.lower(CompanyParticular.company_name) == func.lower(target_name))

    if tx_type == "Sales":
        duplicate_filters.append(
            (func.lower(CompanyParticular.transaction_type) == "sales")
            | (CompanyParticular.transaction_type.is_(None))
        )
    else:
        duplicate_filters.append(func.lower(CompanyParticular.transaction_type) == "expense")

    existing = db.query(CompanyParticular).filter(*duplicate_filters).first()
    if existing:
        return existing

    created_id = None
    client = get_supabase_admin_client()
    if client:
        try:
            sb_check = client.table("company_particulars").select("*").ilike("name", cleaned_name)
            if target_id:
                sb_check = sb_check.eq("company_id", target_id)
            elif target_name:
                sb_check = sb_check.ilike("company_name", target_name)
            if tx_type == "Sales":
                sb_check = sb_check.or_("transaction_type.eq.Sales,transaction_type.is.null")
            else:
                sb_check = sb_check.ilike("transaction_type", "expense")
            res = sb_check.execute()
            if res.data and len(res.data) > 0:
                created_id = res.data[0].get("id")
            else:
                ins = client.table("company_particulars").insert({
                    "company_id": target_id,
                    "company_name": target_name,
                    "name": cleaned_name,
                    "transaction_type": tx_type,
                }).execute()
                if ins.data and len(ins.data) > 0:
                    created_id = ins.data[0].get("id")
        except Exception:
            pass

    new_p = CompanyParticular(
        id=created_id,
        company_id=target_id,
        company_name=target_name,
        name=cleaned_name,
        transaction_type=tx_type,
    )
    try:
        db.add(new_p)
        db.commit()
        db.refresh(new_p)
        return new_p
    except Exception:
        db.rollback()
        return None


@router.get("", response_model=List[CompanyParticularOut], summary="List saved particulars for a company")
def get_company_particulars(
    company_name: Optional[str] = Query(None, description="Company name"),
    company_id: Optional[int] = Query(None, description="Company ID"),
    transaction_type: Optional[str] = Query(None, description="Transaction type filter: Sales or Expense"),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    target_company_id: Optional[int] = None
    target_company_name: Optional[str] = None
    tx_type: Optional[str] = transaction_type.strip() if transaction_type else None

    if company_id:
        target_company_id = company_id
    if company_name:
        target_company_name = company_name

    if company_name or company_id:
        try:
            comp = resolve_company(db, company_id=company_id, company_name=company_name)
            if not company_id or comp.company_id == company_id:
                target_company_id = comp.company_id
                target_company_name = comp.company_name
        except Exception:
            pass

    if target_company_id:
        check_company_access(current_user, target_company_id)
    else:
        is_privileged = (current_user.get("role") or "").lower() in ("admin", "finance", "audit", "auditor", "owner") or current_user.get("is_admin")
        user_company_ids = current_user.get("company_ids") or []
        if not is_privileged and not user_company_ids and current_user.get("company_id"):
            user_company_ids = [current_user["company_id"]]
        if not is_privileged and user_company_ids:
            target_company_id = user_company_ids[0]

    # Map of lowercase name -> CompanyParticularOut
    results_map: Dict[str, CompanyParticularOut] = {}
    client = get_supabase_admin_client()

    # 1. Fetch from Supabase company_particulars table
    if client:
        try:
            query = client.table("company_particulars").select("*")
            if target_company_id:
                query = query.or_(f"company_id.eq.{target_company_id},company_name.ilike.{target_company_name or ''}")
            elif target_company_name:
                query = query.ilike("company_name", target_company_name)

            if tx_type:
                if tx_type.lower() == "sales":
                    query = query.or_("transaction_type.eq.Sales,transaction_type.is.null")
                else:
                    query = query.ilike("transaction_type", tx_type)

            res = query.order("name").execute()
            if res.data:
                for row in res.data:
                    pname = (row.get("name") or "").strip()
                    if pname and pname.lower() not in results_map:
                        results_map[pname.lower()] = CompanyParticularOut(
                            id=row["id"],
                            name=pname,
                            company_id=row.get("company_id") or target_company_id,
                            company_name=row.get("company_name") or target_company_name,
                            transaction_type=row.get("transaction_type") or (tx_type or "Sales"),
                            created_at=row.get("created_at"),
                        )
        except Exception:
            pass

    # 2. Fetch from local SQLite CompanyParticular table
    local_query = db.query(CompanyParticular)
    if target_company_id and target_company_name:
        local_query = local_query.filter(
            (CompanyParticular.company_id == target_company_id)
            | (func.lower(CompanyParticular.company_name) == func.lower(target_company_name))
        )
    elif target_company_id:
        local_query = local_query.filter(CompanyParticular.company_id == target_company_id)
    elif target_company_name:
        local_query = local_query.filter(func.lower(CompanyParticular.company_name) == func.lower(target_company_name))

    if tx_type:
        if tx_type.lower() == "sales":
            local_query = local_query.filter(
                (func.lower(CompanyParticular.transaction_type) == "sales")
                | (CompanyParticular.transaction_type.is_(None))
            )
        else:
            local_query = local_query.filter(func.lower(CompanyParticular.transaction_type) == tx_type.lower())

    for row in local_query.all():
        pname = (row.name or "").strip()
        if pname and pname.lower() not in results_map:
            results_map[pname.lower()] = CompanyParticularOut(
                id=row.id,
                name=pname,
                company_id=row.company_id or target_company_id,
                company_name=row.company_name or target_company_name,
                transaction_type=row.transaction_type or (tx_type or "Sales"),
                created_at=row.created_at,
            )

    # 3. Automatically harvest from actual historical transactions
    # This guarantees that previous particulars entered in sales or expenses are immediately available
    harvested_sales_raw: List[str] = []
    harvested_expense_raw: List[str] = []

    if not tx_type or tx_type.lower() == "sales":
        # Check SQLite sales
        sq = db.query(Sale.particulars).filter(Sale.particulars.isnot(None), Sale.particulars != "")
        if target_company_id:
            sq = sq.filter(Sale.company_id == target_company_id)
        harvested_sales_raw.extend([r[0] for r in sq.order_by(Sale.sales_id.desc()).limit(200).all() if r[0]])

        # Check Supabase sales
        if client:
            try:
                sb_sq = client.table("sales").select("particulars")
                if target_company_id:
                    sb_sq = sb_sq.eq("company_id", target_company_id)
                sb_res = sb_sq.order("sales_id", desc=True).limit(150).execute()
                if sb_res.data:
                    harvested_sales_raw.extend([r.get("particulars") for r in sb_res.data if r.get("particulars")])
            except Exception:
                pass

        for raw_item in harvested_sales_raw:
            for p_name in extract_particular_names(raw_item):
                low = p_name.lower()
                if low not in results_map:
                    saved = save_company_particular_if_not_exists(
                        db, target_company_id, target_company_name, p_name, "Sales"
                    )
                    results_map[low] = CompanyParticularOut(
                        id=saved.id if saved else len(results_map) + 1,
                        name=p_name,
                        company_id=target_company_id,
                        company_name=target_company_name,
                        transaction_type="Sales",
                    )

    if not tx_type or tx_type.lower() == "expense":
        # Check SQLite expenses
        eq = db.query(Expense.description).filter(Expense.description.isnot(None), Expense.description != "")
        if target_company_id:
            eq = eq.filter(Expense.company_id == target_company_id)
        harvested_expense_raw.extend([r[0] for r in eq.order_by(Expense.expense_id.desc()).limit(200).all() if r[0]])

        # Check Supabase expenses
        if client:
            try:
                sb_eq = client.table("expenses").select("description")
                if target_company_id:
                    sb_eq = sb_eq.eq("company_id", target_company_id)
                sb_res = sb_eq.order("expense_id", desc=True).limit(150).execute()
                if sb_res.data:
                    harvested_expense_raw.extend([r.get("description") for r in sb_res.data if r.get("description")])
            except Exception:
                pass

        for raw_item in harvested_expense_raw:
            for p_name in extract_particular_names(raw_item):
                low = p_name.lower()
                if low not in results_map:
                    saved = save_company_particular_if_not_exists(
                        db, target_company_id, target_company_name, p_name, "Expense"
                    )
                    results_map[low] = CompanyParticularOut(
                        id=saved.id if saved else len(results_map) + 1,
                        name=p_name,
                        company_id=target_company_id,
                        company_name=target_company_name,
                        transaction_type="Expense",
                    )

    # Return sorted alphabetically by name
    return sorted(results_map.values(), key=lambda x: (x.name or "").lower())


@router.post("", response_model=CompanyParticularOut, status_code=status.HTTP_201_CREATED, summary="Save a particular to company's list")
def create_company_particular(
    particular_in: CompanyParticularCreate,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    cleaned_name = particular_in.name.strip()
    if not cleaned_name:
        raise HTTPException(status_code=400, detail="Particular name cannot be empty.")

    raw_tx = (particular_in.transaction_type or "Sales").strip()
    tx_type = "Expense" if raw_tx.lower() == "expense" else "Sales"

    target_company_id: Optional[int] = particular_in.company_id
    target_company_name: Optional[str] = particular_in.company_name

    try:
        comp = resolve_company(db, company_id=target_company_id, company_name=target_company_name)
        if not target_company_id or comp.company_id == target_company_id:
            target_company_id = comp.company_id
            target_company_name = comp.company_name
    except Exception:
        pass

    if target_company_id:
        check_company_access(current_user, target_company_id)
    else:
        user_company_ids = current_user.get("company_ids") or []
        if user_company_ids:
            target_company_id = user_company_ids[0]
            check_company_access(current_user, target_company_id)

    # Check for existing duplicate in SQLite / PostgreSQL via SQLAlchemy
    duplicate_filters = [
        (
            (CompanyParticular.company_id == target_company_id)
            | (func.lower(CompanyParticular.company_name) == func.lower(target_company_name or ""))
        )
        if (target_company_id or target_company_name)
        else True,
        func.lower(CompanyParticular.name) == cleaned_name.lower(),
    ]
    if tx_type == "Sales":
        duplicate_filters.append(
            (func.lower(CompanyParticular.transaction_type) == "sales")
            | (CompanyParticular.transaction_type.is_(None))
        )
    else:
        duplicate_filters.append(func.lower(CompanyParticular.transaction_type) == "expense")

    existing = db.query(CompanyParticular).filter(*duplicate_filters).first()
    if existing:
        return existing

    # Try Supabase insert
    client = get_supabase_admin_client()
    created_id = None
    created_at = None
    if client:
        try:
            # Check duplicate in Supabase
            sb_check = (
                client.table("company_particulars")
                .select("*")
                .ilike("name", cleaned_name)
            )
            if target_company_id:
                sb_check = sb_check.eq("company_id", target_company_id)
            elif target_company_name:
                sb_check = sb_check.ilike("company_name", target_company_name)

            if tx_type == "Sales":
                sb_check = sb_check.or_("transaction_type.eq.Sales,transaction_type.is.null")
            else:
                sb_check = sb_check.ilike("transaction_type", "expense")

            existing_sb = sb_check.execute()
            if existing_sb.data and len(existing_sb.data) > 0:
                row = existing_sb.data[0]
                return CompanyParticularOut(
                    id=row["id"],
                    name=row["name"],
                    company_id=row.get("company_id"),
                    company_name=row.get("company_name"),
                    transaction_type=row.get("transaction_type") or tx_type,
                    created_at=row.get("created_at"),
                )

            ins = client.table("company_particulars").insert({
                "company_id": target_company_id,
                "company_name": target_company_name,
                "name": cleaned_name,
                "transaction_type": tx_type,
            }).execute()
            if ins.data and len(ins.data) > 0:
                row = ins.data[0]
                created_id = row.get("id")
                created_at = row.get("created_at")
        except Exception:
            # If Supabase table isn't created yet or error, proceed to local DB
            pass

    # Save to SQLAlchemy DB
    new_particular = CompanyParticular(
        id=created_id,
        company_id=target_company_id,
        company_name=target_company_name,
        name=cleaned_name,
        transaction_type=tx_type,
    )
    db.add(new_particular)
    db.commit()
    db.refresh(new_particular)
    return new_particular


@router.delete("/{particular_id}", summary="Delete a particular from company's list")
def delete_company_particular(
    particular_id: int,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    item = db.query(CompanyParticular).filter(CompanyParticular.id == particular_id).first()
    client = get_supabase_admin_client()

    # Verify authorization on the company before deleting
    if item and item.company_id:
        check_company_access(current_user, item.company_id)
    elif client and not item:
        try:
            sb_check = client.table("company_particulars").select("company_id").eq("id", particular_id).execute()
            if sb_check.data and sb_check.data[0].get("company_id"):
                check_company_access(current_user, sb_check.data[0]["company_id"])
        except Exception:
            pass

    # Try Supabase delete
    if client:
        try:
            client.table("company_particulars").delete().eq("id", particular_id).execute()
        except Exception:
            pass

    if item:
        db.delete(item)
        db.commit()

    return {"status": "success", "id": particular_id}

