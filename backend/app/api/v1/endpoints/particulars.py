from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.company_resolver import resolve_company
from app.core.dependencies import (
    AuthenticatedUser,
    require_business_reader,
    require_business_writer,
)
from app.db.session import get_db
from app.db.supabase import get_supabase_admin_client
from app.models.particular import CompanyParticular
from app.schemas.particular import CompanyParticularCreate, CompanyParticularOut

router = APIRouter()


@router.get("", response_model=List[CompanyParticularOut], summary="List saved particulars for a company")
def get_company_particulars(
    company_name: Optional[str] = Query(None, description="Company name"),
    company_id: Optional[int] = Query(None, description="Company ID"),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    target_company_id: Optional[int] = None
    target_company_name: Optional[str] = None

    if company_name or company_id:
        try:
            comp = resolve_company(db, company_id=company_id, company_name=company_name)
            target_company_id = comp.company_id
            target_company_name = comp.company_name
        except Exception:
            target_company_name = company_name

    # Try Supabase first if available
    client = get_supabase_admin_client()
    if client:
        try:
            query = client.table("company_particulars").select("*")
            if target_company_id:
                query = query.or_(f"company_id.eq.{target_company_id},company_name.ilike.{target_company_name or ''}")
            elif target_company_name:
                query = query.ilike("company_name", target_company_name)
            res = query.order("name").execute()
            if res.data is not None:
                # Sync into local SQLite
                existing_names = {
                    p.name.strip().lower()
                    for p in db.query(CompanyParticular).all()
                    if (target_company_id and p.company_id == target_company_id)
                    or (target_company_name and (p.company_name or "").lower() == target_company_name.lower())
                }
                for row in res.data:
                    pname = (row.get("name") or "").strip()
                    if pname and pname.lower() not in existing_names:
                        db.add(
                            CompanyParticular(
                                id=row.get("id"),
                                company_id=row.get("company_id") or target_company_id,
                                company_name=row.get("company_name") or target_company_name,
                                name=pname,
                            )
                        )
                        existing_names.add(pname.lower())
                try:
                    db.commit()
                except Exception:
                    db.rollback()

                return [
                    CompanyParticularOut(
                        id=row["id"],
                        name=row["name"],
                        company_id=row.get("company_id"),
                        company_name=row.get("company_name"),
                        created_at=row.get("created_at"),
                    )
                    for row in res.data
                ]
        except Exception:
            # Table might not exist yet in Supabase or network issue; fall through to SQLAlchemy
            pass

    query = db.query(CompanyParticular)
    if target_company_id and target_company_name:
        query = query.filter(
            (CompanyParticular.company_id == target_company_id)
            | (func.lower(CompanyParticular.company_name) == func.lower(target_company_name))
        )
    elif target_company_id:
        query = query.filter(CompanyParticular.company_id == target_company_id)
    elif target_company_name:
        query = query.filter(func.lower(CompanyParticular.company_name) == func.lower(target_company_name))

    return query.order_by(func.lower(CompanyParticular.name).asc()).all()


@router.post("", response_model=CompanyParticularOut, status_code=status.HTTP_201_CREATED, summary="Save a particular to company's list")
def create_company_particular(
    particular_in: CompanyParticularCreate,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    cleaned_name = particular_in.name.strip()
    if not cleaned_name:
        raise HTTPException(status_code=400, detail="Particular name cannot be empty.")

    target_company_id: Optional[int] = particular_in.company_id
    target_company_name: Optional[str] = particular_in.company_name

    try:
        comp = resolve_company(db, company_id=target_company_id, company_name=target_company_name)
        target_company_id = comp.company_id
        target_company_name = comp.company_name
    except Exception:
        pass

    # Check for existing duplicate in SQLite / PostgreSQL via SQLAlchemy
    existing = (
        db.query(CompanyParticular)
        .filter(
            (
                (CompanyParticular.company_id == target_company_id)
                | (func.lower(CompanyParticular.company_name) == func.lower(target_company_name or ""))
            )
            if target_company_id or target_company_name
            else True,
            func.lower(CompanyParticular.name) == cleaned_name.lower(),
        )
        .first()
    )
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
            existing_sb = sb_check.execute()
            if existing_sb.data and len(existing_sb.data) > 0:
                row = existing_sb.data[0]
                return CompanyParticularOut(
                    id=row["id"],
                    name=row["name"],
                    company_id=row.get("company_id"),
                    company_name=row.get("company_name"),
                    created_at=row.get("created_at"),
                )

            ins = client.table("company_particulars").insert({
                "company_id": target_company_id,
                "company_name": target_company_name,
                "name": cleaned_name,
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
    # Try Supabase delete
    client = get_supabase_admin_client()
    if client:
        try:
            client.table("company_particulars").delete().eq("id", particular_id).execute()
        except Exception:
            pass

    item = db.query(CompanyParticular).filter(CompanyParticular.id == particular_id).first()
    if item:
        db.delete(item)
        db.commit()

    return {"status": "success", "id": particular_id}

