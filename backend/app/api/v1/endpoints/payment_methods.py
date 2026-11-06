from typing import List, Optional
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
from app.models.payment_method import CompanyPaymentMethod
from app.schemas.payment_method import CompanyPaymentMethodCreate, CompanyPaymentMethodOut

router = APIRouter()


@router.get("", response_model=List[CompanyPaymentMethodOut], summary="List custom payment methods for a company")
def get_company_payment_methods(
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

    if target_company_id:
        check_company_access(current_user, target_company_id)

    # Try Supabase first if available
    client = get_supabase_admin_client()
    if client:
        try:
            query = client.table("company_payment_methods").select("*")
            if target_company_id:
                query = query.or_(f"company_id.eq.{target_company_id},company_name.ilike.{target_company_name or ''}")
            elif target_company_name:
                query = query.ilike("company_name", target_company_name)
            res = query.order("name").execute()
            if res.data is not None:
                existing_names = {
                    p.name.strip().lower()
                    for p in db.query(CompanyPaymentMethod).all()
                    if (target_company_id and p.company_id == target_company_id)
                    or (target_company_name and (p.company_name or "").lower() == target_company_name.lower())
                }
                for row in res.data:
                    pname = (row.get("name") or "").strip()
                    if pname and pname.lower() not in existing_names:
                        db.add(
                            CompanyPaymentMethod(
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
                    CompanyPaymentMethodOut(
                        id=row["id"],
                        name=row["name"],
                        company_id=row.get("company_id"),
                        company_name=row.get("company_name"),
                        created_at=row.get("created_at"),
                    )
                    for row in res.data
                ]
        except Exception:
            pass

    query = db.query(CompanyPaymentMethod)
    if target_company_id and target_company_name:
        query = query.filter(
            (CompanyPaymentMethod.company_id == target_company_id)
            | (func.lower(CompanyPaymentMethod.company_name) == func.lower(target_company_name))
        )
    elif target_company_id:
        query = query.filter(CompanyPaymentMethod.company_id == target_company_id)
    elif target_company_name:
        query = query.filter(func.lower(CompanyPaymentMethod.company_name) == func.lower(target_company_name))

    return query.order_by(func.lower(CompanyPaymentMethod.name).asc()).all()


@router.post("", response_model=CompanyPaymentMethodOut, status_code=status.HTTP_201_CREATED, summary="Add custom payment method for a company")
def create_company_payment_method(
    method_in: CompanyPaymentMethodCreate,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    cleaned_name = method_in.name.strip()
    if not cleaned_name:
        raise HTTPException(status_code=400, detail="Payment method name cannot be empty.")

    target_company_id: Optional[int] = method_in.company_id
    target_company_name: Optional[str] = method_in.company_name

    try:
        comp = resolve_company(db, company_id=target_company_id, company_name=target_company_name)
        target_company_id = comp.company_id
        target_company_name = comp.company_name
    except Exception:
        pass

    if target_company_id:
        check_company_access(current_user, target_company_id)

    # Check for existing duplicate
    existing = (
        db.query(CompanyPaymentMethod)
        .filter(
            (
                (CompanyPaymentMethod.company_id == target_company_id)
                | (func.lower(CompanyPaymentMethod.company_name) == func.lower(target_company_name or ""))
            )
            if target_company_id or target_company_name
            else True,
            func.lower(CompanyPaymentMethod.name) == cleaned_name.lower(),
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
            sb_check = (
                client.table("company_payment_methods")
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
                return CompanyPaymentMethodOut(
                    id=row["id"],
                    name=row["name"],
                    company_id=row.get("company_id"),
                    company_name=row.get("company_name"),
                    created_at=row.get("created_at"),
                )

            ins = client.table("company_payment_methods").insert({
                "company_id": target_company_id,
                "company_name": target_company_name,
                "name": cleaned_name,
            }).execute()
            if ins.data and len(ins.data) > 0:
                row = ins.data[0]
                created_id = row.get("id")
                created_at = row.get("created_at")
        except Exception:
            pass

    new_method = CompanyPaymentMethod(
        id=created_id,
        company_id=target_company_id,
        company_name=target_company_name,
        name=cleaned_name,
    )
    db.add(new_method)
    db.commit()
    db.refresh(new_method)
    return new_method


@router.delete("/{payment_method_id}", summary="Delete custom payment method for a company")
def delete_company_payment_method(
    payment_method_id: int,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    item = db.query(CompanyPaymentMethod).filter(CompanyPaymentMethod.id == payment_method_id).first()
    if item and item.company_id:
        check_company_access(current_user, item.company_id)

    client = get_supabase_admin_client()
    if client:
        try:
            client.table("company_payment_methods").delete().eq("id", payment_method_id).execute()
        except Exception:
            pass

    if item:
        db.delete(item)
        db.commit()

    return {"status": "success", "id": payment_method_id}

