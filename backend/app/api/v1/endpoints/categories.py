from typing import Any, List, Optional, Union
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.session import get_db
from app.db.supabase import get_supabase_admin_client
from app.core.company_resolver import resolve_company
from app.core.dependencies import (
    AuthenticatedUser,
    check_company_access,
    require_business_reader,
    require_business_writer,
)
from app.models.finance import Category, CompanyCategory
from app.schemas.category import (
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    CompanyCategoryCreate,
    CompanyCategoryOut,
    CompanyCategoryUpdate,
)

router = APIRouter()


@router.get("", response_model=Union[List[CompanyCategoryOut], List[CategoryOut]], summary="List categories")
def get_categories(
    company_name: Optional[str] = Query(None, description="Company name to scope categories"),
    company_id: Optional[int] = Query(None, description="Company ID to scope categories"),
    category_type: Optional[str] = Query(None, description="Category type ('sales' or 'expense')"),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    target_company_id: Optional[int] = None
    target_company_name: Optional[str] = None

    if company_name or company_id:
        comp = resolve_company(db, company_id=company_id, company_name=company_name)
        target_company_id = comp.company_id
        target_company_name = comp.company_name
        check_company_access(current_user, target_company_id)

    # If company-scoped request
    if target_company_id:
        norm_type = (category_type or "").strip().lower()

        # Try Supabase if available
        client = get_supabase_admin_client()
        if client:
            try:
                sb_query = client.table("company_categories").select("*").eq("company_id", target_company_id)
                if norm_type:
                    sb_query = sb_query.eq("category_type", norm_type)

                res = sb_query.order("name").execute()
                if res.data is not None:
                    # Sync to local DB
                    existing_by_id = {
                        c.category_id: c
                        for c in db.query(CompanyCategory).filter(
                            CompanyCategory.company_id == target_company_id
                        ).all()
                    }
                    existing_by_name = {
                        (c.name.strip().lower(), c.category_type.lower()): c
                        for c in existing_by_id.values()
                    }
                    for row in res.data:
                        cid = row.get("category_id")
                        cname = (row.get("name") or "").strip()
                        ctype = (row.get("category_type") or "sales").strip().lower()
                        if not cname:
                            continue
                        if cid and cid in existing_by_id:
                            loc = existing_by_id[cid]
                            loc.name = cname
                            loc.category_type = ctype
                            loc.description = row.get("description")
                            loc.company_name = row.get("company_name") or target_company_name
                        elif (cname.lower(), ctype) in existing_by_name:
                            loc = existing_by_name[(cname.lower(), ctype)]
                            loc.description = row.get("description")
                            loc.company_name = row.get("company_name") or target_company_name
                        else:
                            new_cat = CompanyCategory(
                                category_id=cid,
                                company_id=row.get("company_id") or target_company_id,
                                company_name=row.get("company_name") or target_company_name,
                                category_type=ctype,
                                name=cname,
                                description=row.get("description"),
                            )
                            db.add(new_cat)
                            if cid:
                                existing_by_id[cid] = new_cat
                            existing_by_name[(cname.lower(), ctype)] = new_cat
                    try:
                        db.commit()
                    except Exception:
                        db.rollback()

                    return [
                        CompanyCategoryOut(
                            category_id=row["category_id"],
                            company_id=row["company_id"],
                            company_name=row.get("company_name"),
                            category_type=row.get("category_type") or "sales",
                            name=row["name"],
                            description=row.get("description"),
                            created_at=row.get("created_at"),
                            updated_at=row.get("updated_at"),
                        )
                        for row in res.data
                    ]
            except Exception:
                pass

        # Local DB query
        query = db.query(CompanyCategory).filter(CompanyCategory.company_id == target_company_id)
        if norm_type:
            query = query.filter(func.lower(CompanyCategory.category_type) == norm_type)

        rows = query.order_by(CompanyCategory.name).all()
        return rows

    # Fallback to legacy global categories if no company specified
    client = get_supabase_admin_client()
    if client:
        try:
            res = client.table("category").select("*").order("name").execute()
            if res.data:
                existing_local_names = {c.name.strip().lower() for c in db.query(Category).all()}
                for row in res.data:
                    cname = (row.get("name") or "").strip()
                    if cname and cname.lower() not in existing_local_names:
                        db.add(Category(category_id=row.get("category_id"), name=cname, description=row.get("description")))
                        existing_local_names.add(cname.lower())
                db.commit()
                return [
                    CategoryOut(
                        category_id=row["category_id"],
                        name=row["name"],
                        description=row.get("description"),
                        created_at=row.get("created_at"),
                        updated_at=row.get("updated_at"),
                    )
                    for row in res.data
                ]
        except Exception:
            pass

    return db.query(Category).order_by(Category.name).all()


@router.post("", response_model=Union[CompanyCategoryOut, CategoryOut], status_code=status.HTTP_201_CREATED, summary="Create a new category")
def create_category(
    category_in: Union[CompanyCategoryCreate, CategoryCreate],
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    cleaned_name = category_in.name.strip()
    if not cleaned_name:
        raise HTTPException(status_code=400, detail="Category name cannot be empty.")

    target_company_id = getattr(category_in, "company_id", None)
    target_company_name = getattr(category_in, "company_name", None)
    category_type = getattr(category_in, "category_type", None)

    # If company-scoped creation
    if target_company_id or target_company_name or category_type:
        if not target_company_id and not target_company_name:
            raise HTTPException(status_code=400, detail="A valid company is required for company categories.")

        comp = resolve_company(db, company_id=target_company_id, company_name=target_company_name)
        target_company_id = comp.company_id
        target_company_name = comp.company_name

        check_company_access(current_user, target_company_id)
        norm_type = (category_type or "sales").strip().lower()
        if norm_type not in ("sales", "expense"):
            raise HTTPException(status_code=400, detail="Category type must be either 'sales' or 'expense'.")

        # Check existing in local
        existing = (
            db.query(CompanyCategory)
            .filter(
                CompanyCategory.company_id == target_company_id,
                func.lower(CompanyCategory.category_type) == norm_type,
                func.lower(CompanyCategory.name) == cleaned_name.lower(),
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Category '{cleaned_name}' already exists for {target_company_name}."
            )

        created_id = None
        created_at = None
        updated_at = None

        client = get_supabase_admin_client()
        if client:
            try:
                sb_check = (
                    client.table("company_categories")
                    .select("*")
                    .eq("company_id", target_company_id)
                    .eq("category_type", norm_type)
                    .ilike("name", cleaned_name)
                    .execute()
                )
                if sb_check.data and len(sb_check.data) > 0:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Category '{cleaned_name}' already exists for {target_company_name}."
                    )

                ins = client.table("company_categories").insert({
                    "company_id": target_company_id,
                    "company_name": target_company_name,
                    "category_type": norm_type,
                    "name": cleaned_name,
                    "description": category_in.description,
                }).execute()
                if ins.data and len(ins.data) > 0:
                    row = ins.data[0]
                    created_id = row.get("category_id")
                    created_at = row.get("created_at")
                    updated_at = row.get("updated_at")
            except HTTPException:
                raise
            except Exception as e:
                print(f"Supabase create company_category failed, falling back to local: {e}")

        new_cat = CompanyCategory(
            category_id=created_id,
            company_id=target_company_id,
            company_name=target_company_name,
            category_type=norm_type,
            name=cleaned_name,
            description=category_in.description,
        )
        try:
            db.add(new_cat)
            db.commit()
            db.refresh(new_cat)
        except Exception:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Category '{cleaned_name}' already exists for {target_company_name}."
            )
        return new_cat

    # Legacy global category creation
    client = get_supabase_admin_client()
    if client:
        try:
            existing_sb = client.table("category").select("*").ilike("name", cleaned_name).execute()
            if existing_sb.data:
                row = existing_sb.data[0]
                return CategoryOut(
                    category_id=row["category_id"],
                    name=row["name"],
                    description=row.get("description"),
                    created_at=row.get("created_at"),
                    updated_at=row.get("updated_at"),
                )

            ins = client.table("category").insert({
                "name": cleaned_name,
                "description": category_in.description,
            }).execute()
            if ins.data:
                row = ins.data[0]
                loc = db.query(Category).filter(func.lower(Category.name) == cleaned_name.lower()).first()
                if not loc:
                    db.add(Category(category_id=row["category_id"], name=cleaned_name, description=category_in.description))
                    db.commit()
                return CategoryOut(
                    category_id=row["category_id"],
                    name=row["name"],
                    description=row.get("description"),
                    created_at=row.get("created_at"),
                    updated_at=row.get("updated_at"),
                )
        except Exception as e:
            print(f"Supabase create_category failed, falling back to local: {e}")

    existing_local = db.query(Category).filter(func.lower(Category.name) == cleaned_name.lower()).first()
    if existing_local:
        return existing_local

    new_cat = Category(name=cleaned_name, description=category_in.description)
    db.add(new_cat)
    db.commit()
    db.refresh(new_cat)
    return new_cat


@router.put("/{category_id}", response_model=Union[CompanyCategoryOut, CategoryOut], summary="Update / rename category")
def update_category(
    category_id: int,
    category_in: Union[CompanyCategoryUpdate, CategoryUpdate],
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    cleaned_name = category_in.name.strip() if category_in.name else None
    if cleaned_name is not None and not cleaned_name:
        raise HTTPException(status_code=400, detail="Category name cannot be empty.")

    # Check CompanyCategory first
    comp_cat = db.query(CompanyCategory).filter(CompanyCategory.category_id == category_id).first()
    if comp_cat:
        check_company_access(current_user, comp_cat.company_id)

        # Check for duplicate within the same company and category_type
        if cleaned_name:
            dup = (
                db.query(CompanyCategory)
                .filter(
                    CompanyCategory.category_id != category_id,
                    CompanyCategory.company_id == comp_cat.company_id,
                    CompanyCategory.category_type == comp_cat.category_type,
                    func.lower(CompanyCategory.name) == cleaned_name.lower(),
                )
                .first()
            )
            if dup:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Category '{cleaned_name}' already exists for this company."
                )
            comp_cat.name = cleaned_name

        if category_in.description is not None:
            comp_cat.description = category_in.description

        client = get_supabase_admin_client()
        if client:
            try:
                update_data = {}
                if cleaned_name:
                    update_data["name"] = cleaned_name
                if category_in.description is not None:
                    update_data["description"] = category_in.description
                if update_data:
                    client.table("company_categories").update(update_data).eq("category_id", category_id).execute()
            except Exception:
                pass

        db.commit()
        db.refresh(comp_cat)
        return comp_cat

    # Fallback to legacy global category
    cat = db.query(Category).filter(Category.category_id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found.")

    if cleaned_name:
        cat.name = cleaned_name
    if category_in.description is not None:
        cat.description = category_in.description

    client = get_supabase_admin_client()
    if client:
        try:
            update_data = {}
            if cleaned_name:
                update_data["name"] = cleaned_name
            if category_in.description is not None:
                update_data["description"] = category_in.description
            if update_data:
                client.table("category").update(update_data).eq("category_id", category_id).execute()
        except Exception:
            pass

    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{category_id}", summary="Delete category")
def delete_category(
    category_id: int,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    # Check CompanyCategory first
    comp_cat = db.query(CompanyCategory).filter(CompanyCategory.category_id == category_id).first()
    if comp_cat:
        check_company_access(current_user, comp_cat.company_id)
        client = get_supabase_admin_client()
        if client:
            try:
                client.table("company_categories").delete().eq("category_id", category_id).execute()
            except Exception:
                pass

        db.delete(comp_cat)
        db.commit()
        return {"status": "success", "id": category_id}

    # Fallback to legacy global category
    cat = db.query(Category).filter(Category.category_id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found.")

    client = get_supabase_admin_client()
    if client:
        try:
            client.table("category").delete().eq("category_id", category_id).execute()
        except Exception:
            pass

    db.delete(cat)
    db.commit()
    return {"status": "success", "id": category_id}


@router.get("/{category_id}", response_model=Union[CompanyCategoryOut, CategoryOut], summary="Get category by ID")
def get_category(
    category_id: int,
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    comp_cat = db.query(CompanyCategory).filter(CompanyCategory.category_id == category_id).first()
    if comp_cat:
        check_company_access(current_user, comp_cat.company_id)
        return comp_cat

    cat = db.query(Category).filter(Category.category_id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    return cat
