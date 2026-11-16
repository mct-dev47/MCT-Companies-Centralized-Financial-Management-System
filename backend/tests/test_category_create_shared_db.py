"""Creating a sales category when Supabase and the local engine are the SAME database.

Production points DATABASE_URL at the Supabase Postgres, so the Supabase insert already writes the
row the local session then tried to insert again. That second insert hit the unique constraint and
the user saw "'<name>' already exists" for a brand new category (which had in fact been saved).
"""
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import categories as categories_endpoints
from app.core.dependencies import get_current_user
from app.db.session import Base, get_db
from app.models.company import Company
from app.models.finance import CompanyCategory

FINANCE_USER = {"user_id": 10, "email": "finance@mct.test", "role": "finance", "is_admin": False,
                "company_id": 1, "company_ids": [1]}


class _SharedDbTable:
    """Fake Supabase table that reads and writes the same database the app session uses."""

    def __init__(self, session_factory):
        self._sf = session_factory
        self._filters = {}
        self._ilike = None
        self._insert = None

    def select(self, *_):
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def ilike(self, col, val):
        self._ilike = (col, val)
        return self

    def insert(self, payload):
        self._insert = payload
        return self

    def execute(self):
        s = self._sf()
        try:
            if self._insert is not None:
                row = CompanyCategory(**self._insert)
                s.add(row)
                s.commit()
                s.refresh(row)
                data = [{"category_id": row.category_id, "created_at": None, "updated_at": None}]
            else:
                q = s.query(CompanyCategory).filter_by(**self._filters)
                if self._ilike:
                    q = q.filter(CompanyCategory.name.ilike(self._ilike[1]))
                data = [{"category_id": r.category_id} for r in q.all()]
            return type("Res", (), {"data": data})()
        finally:
            s.close()


class _SharedDbClient:
    def __init__(self, session_factory):
        self._sf = session_factory

    def table(self, _name):
        return _SharedDbTable(self._sf)


@pytest.fixture()
def client(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    s = SessionLocal()
    s.add(Company(company_id=1, company_name="Company Alpha", starting_balance=Decimal("0")))
    s.commit()
    s.close()

    monkeypatch.setattr(categories_endpoints, "get_supabase_admin_client", lambda: _SharedDbClient(SessionLocal))

    app = FastAPI()
    app.include_router(categories_endpoints.router, prefix="/api/v1/categories")

    def override_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: FINANCE_USER
    yield TestClient(app), SessionLocal


def _create(client, name):
    return client.post("/api/v1/categories", json={"name": name, "company_id": 1, "category_type": "sales"})


def test_new_category_is_created_not_reported_as_existing(client):
    c, SessionLocal = client
    res = _create(c, "Gcash")
    assert res.status_code == 201, res.text
    assert res.json()["name"] == "Gcash"
    s = SessionLocal()
    assert s.query(CompanyCategory).filter_by(company_id=1, category_type="sales", name="Gcash").count() == 1
    s.close()


def test_real_duplicate_is_still_rejected(client):
    c, _ = client
    assert _create(c, "Hotel").status_code == 201
    dup = _create(c, "hotel")
    assert dup.status_code == 409
    assert "already exists" in dup.json()["detail"]
