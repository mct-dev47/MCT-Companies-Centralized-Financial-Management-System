from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.session import get_db
from app.db.supabase import get_supabase_admin_client
from app.models.finance import Category
from app.schemas.category import CategoryCreate, CategoryOut, CategoryUpdate

router = APIRouter()

@router.get("", response_model=List[CategoryOut], summary="List all categories")
def get_categories(db: Session = Depends(get_db)):
    client = get_supabase_admin_client()
    if client:
        try:
            res = client.table("category").select("*").order("name").execute()
            if res.data:
                # Also ensure local db has these
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
        except Exception as e:
            print(f"Supabase get_categories failed, falling back to local SQLite: {e}")

    return db.query(Category).order_by(Category.name).all()

@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED, summary="Create a new category")
def create_category(category_in: CategoryCreate, db: Session = Depends(get_db)):
    cleaned_name = category_in.name.strip()
    if not cleaned_name:
        raise HTTPException(status_code=400, detail="Category name cannot be empty.")

    client = get_supabase_admin_client()
    if client:
        try:
            # Check existing in Supabase
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

            # Insert into Supabase
            ins = client.table("category").insert({
                "name": cleaned_name,
                "description": category_in.description,
            }).execute()
            if ins.data:
                row = ins.data[0]
                # Sync to SQLite
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

    # Local fallback
    existing_local = db.query(Category).filter(func.lower(Category.name) == cleaned_name.lower()).first()
    if existing_local:
        return existing_local

    new_cat = Category(name=cleaned_name, description=category_in.description)
    db.add(new_cat)
    db.commit()
    db.refresh(new_cat)
    return new_cat

@router.get("/{category_id}", response_model=CategoryOut, summary="Get category by ID")
def get_category(category_id: int, db: Session = Depends(get_db)):
    client = get_supabase_admin_client()
    if client:
        try:
            res = client.table("category").select("*").eq("category_id", category_id).execute()
            if res.data:
                row = res.data[0]
                return CategoryOut(
                    category_id=row["category_id"],
                    name=row["name"],
                    description=row.get("description"),
                    created_at=row.get("created_at"),
                    updated_at=row.get("updated_at"),
                )
        except Exception:
            pass

    cat = db.query(Category).filter(Category.category_id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    return cat
