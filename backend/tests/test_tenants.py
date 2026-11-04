"""Tenant leases and payments (spec 0017). Runs on an in memory SQLite database, no Supabase needed."""
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (registers every table)
from app.api.v1.endpoints import tenants as tenants_endpoints
from app.core.dependencies import get_current_user
from app.core.errors import validation_exception_handler
from app.db.session import Base, get_db
from app.models.company import Company
from app.services import tenant_service
from app.services.tenant_service import add_period_clamped, count_periods

ADMIN = {"auth_user_id": "a", "user_id": 1, "email": "admin@mct.com", "company_id": None,
         "company_ids": [], "is_admin": True, "role": "admin"}
FINANCE = {"auth_user_id": "f", "user_id": 2, "email": "finance@mct.com", "company_id": None,
           "company_ids": [1, 2], "is_admin": False, "role": "finance"}
AUDIT = {"auth_user_id": "u", "user_id": 3, "email": "audit@mct.com", "company_id": None,
         "company_ids": [], "is_admin": False, "role": "audit"}


def company_user(company_id: int):
    return {"auth_user_id": f"c{company_id}", "user_id": 10 + company_id, "email": f"c{company_id}@mct.com",
            "company_id": company_id, "company_ids": [company_id], "is_admin": False, "role": "company"}


@pytest.fixture()
def env(monkeypatch):
    # The SQL store only: Supabase is switched off for these tests.
    monkeypatch.setattr(tenant_service, "_supabase_client", lambda: None)
    monkeypatch.setattr("app.api.v1.endpoints.tenants.require_company_feature_access", lambda *args, **kwargs: None)

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr("app.services.activity_log_service.SessionLocal", Session)
    monkeypatch.setattr("app.db.session.SessionLocal", Session)
    from app.core import events as app_events
    real_dispatch = app_events.dispatch_activity_event
    monkeypatch.setattr("app.core.events.dispatch_activity_event", lambda *a, **kw: real_dispatch(*a, **{**kw, "sync": True}))

    with Session() as seed:
        seed.add_all([
            Company(company_id=1, company_name="JK Property and Ventures", location="Manila", starting_balance=0),
            Company(company_id=2, company_name="Other Company", location="Cebu", starting_balance=0),
        ])
        seed.commit()

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    holder = {"user": FINANCE}
    app = FastAPI()
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.include_router(tenants_endpoints.router, prefix="/tenants")
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: holder["user"]
    client = TestClient(app)
    return client, holder


def lease_body(**over):
    body = {
        "company_id": 1, "tenant_name": "Maria Santos", "unit_name": "Stall 12",
        "rent_amount": 30000, "contract_date": "2026-10-01", "due_date": "2026-11-15",
        "lease_end_date": "2027-10-15", "repeat_mode": "Monthly",
    }
    body.update(over)
    return body


def pay_body(**over):
    body = {"payment_date": "2026-11-10", "amount": 30000, "method": "Cash", "period_index": 1}
    body.update(over)
    return body


# ---- period maths -------------------------------------------------------

def test_period_maths_clamps_to_month_end():
    assert add_period_clamped(date(2026, 1, 31), "Monthly", 1) == date(2026, 2, 28)
    assert add_period_clamped(date(2026, 1, 31), "Monthly", 2) == date(2026, 3, 31)
    assert add_period_clamped(date(2028, 2, 29), "Annually", 1) == date(2029, 2, 28)
    assert count_periods(date(2026, 11, 15), date(2027, 10, 15), "Monthly") == 12
    assert count_periods(date(2026, 11, 15), date(2027, 10, 14), "Monthly") == 11
    assert count_periods(date(2026, 11, 15), date(2026, 11, 14), "Monthly") == 0


# ---- create and totals ---------------------------------------------------

def test_create_monthly_lease_sets_total_and_reference(env):
    client, _ = env
    r = client.post("/tenants/leases", json=lease_body())
    assert r.status_code == 201, r.text
    lease = r.json()
    assert lease["total_amount_payable"] == 360000  # AC-4: rent x 12 periods
    assert lease["tenant_ref"].startswith("TNT-JK-") and lease["tenant_ref"].endswith("-001")
    assert lease["amount_paid"] == 0 and lease["remaining_balance"] == 360000
    assert lease["company_name"] == "JK Property and Ventures"
    second = client.post("/tenants/leases", json=lease_body(tenant_name="Rolando")).json()
    assert second["tenant_ref"].endswith("-002")  # AC-7


def test_create_validation(env):
    client, _ = env
    assert client.post("/tenants/leases", json=lease_body(rent_amount=0)).status_code == 400
    assert client.post("/tenants/leases", json=lease_body(lease_end_date="2026-11-01")).status_code == 400
    assert client.post("/tenants/leases", json=lease_body(due_date="2026-09-01")).status_code == 400
    assert client.post("/tenants/leases", json=lease_body(lease_end_date=None)).status_code == 400
    assert client.post("/tenants/leases", json=lease_body(penalty_rate=101)).status_code == 400
    assert client.post("/tenants/leases", json=lease_body(
        repeat_mode="Daily", due_date="2026-01-01", contract_date="2026-01-01", lease_end_date="2030-01-01")).status_code == 400
    assert client.post("/tenants/leases", json=lease_body(repeat_mode="Weekly")).status_code == 422


def test_non_repeating_lease_keeps_typed_total(env):
    client, _ = env
    r = client.post("/tenants/leases", json=lease_body(
        repeat_mode="None", lease_end_date=None, total_amount_payable=35000))
    assert r.status_code == 201
    assert r.json()["total_amount_payable"] == 35000
    assert r.json()["lease_end_date"] is None


# ---- payments ------------------------------------------------------------

def test_payment_rules(env):
    client, _ = env
    lease = client.post("/tenants/leases", json=lease_body()).json()
    url = f"/tenants/leases/{lease['lease_id']}/payments"

    ok = client.post(url, json=pay_body())
    assert ok.status_code == 201, ok.text
    assert ok.json()["amount_paid"] == 30000
    assert ok.json()["remaining_balance"] == 330000

    # AC-5: bad period, missed mark on a monthly lease, nothing paid, more than the lease can owe
    assert client.post(url, json=pay_body(period_index=13)).status_code == 400
    assert client.post(url, json=pay_body(period_index=None)).status_code == 400
    assert client.post(url, json=pay_body(status="Missed", amount=0)).status_code == 400
    assert client.post(url, json=pay_body(amount=0)).status_code == 400
    assert client.post(url, json=pay_body(amount=330000.01)).status_code == 400
    assert client.post(url, json=pay_body(amount=330000, period_index=2)).status_code == 201


def test_daily_lease_allows_missed_marks_and_non_repeating_ignores_period(env):
    client, _ = env
    daily = client.post("/tenants/leases", json=lease_body(
        repeat_mode="Daily", due_date="2026-11-01", contract_date="2026-11-01", lease_end_date="2026-11-10", rent_amount=1000)).json()
    r = client.post(f"/tenants/leases/{daily['lease_id']}/payments",
                    json={"payment_date": "2026-11-02", "status": "Missed", "missed_reason": "Closed", "period_index": 2})
    assert r.status_code == 201
    assert r.json()["amount_paid"] == 0
    assert r.json()["payments"][0]["status"] == "Missed"

    plain = client.post("/tenants/leases", json=lease_body(
        repeat_mode="None", lease_end_date=None, total_amount_payable=5000)).json()
    r = client.post(f"/tenants/leases/{plain['lease_id']}/payments", json=pay_body(amount=5000, period_index=7))
    assert r.status_code == 201
    assert r.json()["payments"][0]["period_index"] is None
    assert client.post(f"/tenants/leases/{plain['lease_id']}/payments", json=pay_body(amount=1)).status_code == 400


def test_edit_and_delete_payment_recalculate(env):
    client, _ = env
    lease = client.post("/tenants/leases", json=lease_body()).json()
    lid = lease["lease_id"]
    created = client.post(f"/tenants/leases/{lid}/payments", json=pay_body()).json()
    pid = created["payments"][0]["payment_id"]

    edited = client.patch(f"/tenants/leases/{lid}/payments/{pid}", json=pay_body(amount=10000))
    assert edited.status_code == 200
    assert edited.json()["amount_paid"] == 10000

    removed = client.delete(f"/tenants/leases/{lid}/payments/{pid}")
    assert removed.status_code == 200
    assert removed.json()["amount_paid"] == 0 and removed.json()["payments"] == []
    assert client.delete(f"/tenants/leases/{lid}/payments/{pid}").status_code == 404


# ---- edit locks (AC-6) ---------------------------------------------------

def test_edit_locks_after_a_payment(env):
    client, _ = env
    lease = client.post("/tenants/leases", json=lease_body()).json()
    lid = lease["lease_id"]
    client.post(f"/tenants/leases/{lid}/payments", json=pay_body(period_index=3, amount=30000))

    assert client.patch(f"/tenants/leases/{lid}", json={"repeat_mode": "Quarterly"}).status_code == 409
    assert client.patch(f"/tenants/leases/{lid}", json={"due_date": "2026-11-16"}).status_code == 409
    # Period 3 has a payment, so the end date cannot cut the schedule to 2 periods (Nov and Dec)
    assert client.patch(f"/tenants/leases/{lid}", json={"lease_end_date": "2026-12-15"}).status_code == 409
    # Three periods (Nov, Dec, Jan) still holds period 3
    assert client.patch(f"/tenants/leases/{lid}", json={"lease_end_date": "2027-01-15"}).status_code == 200
    # Moving the end date later is fine and the total follows
    r = client.patch(f"/tenants/leases/{lid}", json={"lease_end_date": "2027-12-15"})
    assert r.status_code == 200
    assert r.json()["total_amount_payable"] == 420000
    # Rent cannot drop below what is already paid
    assert client.patch(f"/tenants/leases/{lid}", json={"rent_amount": 1, "lease_end_date": "2026-12-15"}).status_code == 409


def test_penalty_can_be_cleared(env):
    client, _ = env
    lease = client.post("/tenants/leases", json=lease_body(penalty_rate=5)).json()
    assert lease["penalty_rate"] == 5
    cleared = client.patch(f"/tenants/leases/{lease['lease_id']}", json={"clear_penalty_rate": True})
    assert cleared.status_code == 200 and cleared.json()["penalty_rate"] is None


# ---- access (AC-3) and audit (AC-8) --------------------------------------

def test_audit_role_reads_and_reviews_but_cannot_write(env):
    client, holder = env
    lease = client.post("/tenants/leases", json=lease_body()).json()
    lid = lease["lease_id"]

    holder["user"] = AUDIT
    assert client.get("/tenants/leases").status_code == 200
    assert client.post("/tenants/leases", json=lease_body()).status_code == 403
    assert client.patch(f"/tenants/leases/{lid}", json={"notes": "x"}).status_code == 403
    assert client.post(f"/tenants/leases/{lid}/payments", json=pay_body()).status_code == 403
    assert client.delete(f"/tenants/leases/{lid}").status_code == 403

    review = client.patch(f"/tenants/leases/{lid}/audit", json={"audit_status": "Verified", "remarks": "checked"})
    assert review.status_code == 200, review.text
    body = review.json()
    assert body["audit_status"] == "Verified" and body["audit_remarks"] == "checked"
    assert body["audited_by"] and body["audited_at"]


def test_company_user_cannot_review_audit_or_see_other_companies(env):
    client, holder = env
    mine = client.post("/tenants/leases", json=lease_body(company_id=1)).json()
    other = client.post("/tenants/leases", json=lease_body(company_id=2, tenant_name="Other tenant")).json()

    holder["user"] = company_user(1)
    listed = client.get("/tenants/leases").json()
    assert [l["lease_id"] for l in listed] == [mine["lease_id"]]
    assert client.get(f"/tenants/leases/{other['lease_id']}").status_code == 403
    assert client.post("/tenants/leases", json=lease_body(company_id=2)).status_code == 403
    assert client.patch(f"/tenants/leases/{mine['lease_id']}/audit", json={"audit_status": "Verified"}).status_code == 403
    assert client.get("/tenants/leases?company_id=2").status_code == 403


def test_payment_change_clears_the_audit_mark(env):
    client, holder = env
    lease = client.post("/tenants/leases", json=lease_body()).json()
    lid = lease["lease_id"]
    holder["user"] = AUDIT
    client.patch(f"/tenants/leases/{lid}/audit", json={"audit_status": "Flagged", "remarks": "look again"})
    holder["user"] = FINANCE

    r = client.post(f"/tenants/leases/{lid}/payments", json=pay_body())
    assert r.status_code == 201
    assert r.json()["audit_status"] == "Pending Audit"
    assert r.json()["audited_by"] is None and r.json()["audit_remarks"] is None


def test_delete_lease_removes_its_payments(env):
    client, _ = env
    lease = client.post("/tenants/leases", json=lease_body()).json()
    lid = lease["lease_id"]
    client.post(f"/tenants/leases/{lid}/payments", json=pay_body())
    assert client.delete(f"/tenants/leases/{lid}").status_code == 204
    assert client.get(f"/tenants/leases/{lid}").status_code == 404
    assert client.get("/tenants/leases").json() == []


def test_requires_login():
    app = FastAPI()
    app.include_router(tenants_endpoints.router, prefix="/tenants")
    r = TestClient(app).get("/tenants/leases")
    assert r.status_code in (401, 403)


# ---- activity log (spec 0018) ---------------------------------------------

def test_tenant_actions_show_up_in_the_activity_log(env, monkeypatch):
    from app.api.v1.endpoints import audit_logs as audit_log_endpoints

    client, holder = env
    # Read the log from the local database, not from the real Supabase project
    def no_supabase():
        raise RuntimeError("Supabase is off in tests")
    monkeypatch.setattr("app.services.activity_log_service.get_supabase_admin_client", no_supabase)

    app = client.app
    app.include_router(audit_log_endpoints.router, prefix="/api")

    holder["user"] = ADMIN
    initial_ids = {r["audit_log_id"] for r in client.get("/api/audit-logs").json()}

    holder["user"] = FINANCE
    lease_res = client.post("/tenants/leases", json=lease_body())
    lease = lease_res.json()
    pay_res = client.post(f"/tenants/leases/{lease['lease_id']}/payments", json=pay_body())
    holder["user"] = ADMIN
    rows = client.get("/api/audit-logs").json()
    tenant_rows = [r for r in rows if r["module"] == "Tenant" and r["audit_log_id"] not in initial_ids]
    assert len(tenant_rows) == 2, rows
    created = next(r for r in tenant_rows if r["action"] == "TENANT_LEASE_CREATED")
    assert created["description"] == "Tenant lease created"
    assert created["target"] == lease["tenant_ref"]
    assert created["company_name"] in ("JK Property and Ventures", "MCTolentino Hospitality Business Corporation")
    assert created["action_category"] == "TENANT"

    # The Audit role is not an administrator: it cannot read the log
    holder["user"] = company_user(1)
    assert client.get("/api/audit-logs").status_code == 403


# ---- security audit regressions (2026-10-30) --------------------------------

def test_a_company_is_required_so_a_lease_never_lands_in_the_first_company(env):
    client, _ = env
    body = lease_body()
    body.pop("company_id")
    assert client.post("/tenants/leases", json=body).status_code == 400
    assert client.post("/tenants/leases", json={**body, "company_name": "All Companies"}).status_code == 400
    assert client.post("/tenants/leases", json={**body, "company_name": "JK Property and Ventures"}).status_code == 201


def test_money_fields_must_be_finite_and_fit_the_column(env):
    client, _ = env
    for bad in (1e12, 1e300):
        assert client.post("/tenants/leases", json=lease_body(rent_amount=bad)).status_code == 422
    # NaN and Infinity are not valid JSON, but Python's JSON parser accepts them, so send them as raw text
    raw = '{"company_id":1,"tenant_name":"N","unit_name":"U","rent_amount":NaN,"contract_date":"2026-10-01","due_date":"2026-11-15","repeat_mode":"None"}'
    r = client.post("/tenants/leases", content=raw, headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    assert "input" not in r.text  # the submitted value is never echoed back
    lease = client.post("/tenants/leases", json=lease_body()).json()
    url = f"/tenants/leases/{lease['lease_id']}/payments"
    assert client.post(url, json=pay_body(amount=1e12)).status_code == 422
    assert client.post(url, json=pay_body(amount=-5)).status_code == 422
    assert client.post(url, json=pay_body(period_index=10**9)).status_code == 422


def test_dates_outside_a_sane_range_are_refused_not_a_server_error(env):
    client, _ = env
    r = client.post("/tenants/leases", json=lease_body(
        contract_date="9999-01-01", due_date="9999-01-01", lease_end_date="9999-12-31"))
    assert r.status_code == 400
    r = client.post("/tenants/leases", json=lease_body(contract_date="1500-01-01", due_date="1500-02-01"))
    assert r.status_code == 400


def test_a_payment_id_from_another_lease_is_not_reachable(env):
    client, _ = env
    a = client.post("/tenants/leases", json=lease_body()).json()
    b = client.post("/tenants/leases", json=lease_body(tenant_name="Other tenant")).json()
    pid = client.post(f"/tenants/leases/{a['lease_id']}/payments", json=pay_body()).json()["payments"][0]["payment_id"]
    # Lease B's URL with lease A's payment id must not edit or delete it
    assert client.patch(f"/tenants/leases/{b['lease_id']}/payments/{pid}", json=pay_body(amount=1)).status_code == 404
    assert client.delete(f"/tenants/leases/{b['lease_id']}/payments/{pid}").status_code == 404
    assert client.get(f"/tenants/leases/{a['lease_id']}").json()["amount_paid"] == 30000


def test_company_user_cannot_touch_another_companys_payments_or_audit(env):
    client, holder = env
    other = client.post("/tenants/leases", json=lease_body(company_id=2)).json()
    pid = client.post(f"/tenants/leases/{other['lease_id']}/payments", json=pay_body()).json()["payments"][0]["payment_id"]
    holder["user"] = company_user(1)
    base = f"/tenants/leases/{other['lease_id']}"
    assert client.post(f"{base}/payments", json=pay_body()).status_code == 403
    assert client.patch(f"{base}/payments/{pid}", json=pay_body(amount=1)).status_code == 403
    assert client.delete(f"{base}/payments/{pid}").status_code == 403
    assert client.patch(base, json={"notes": "x"}).status_code == 403
    assert client.delete(base).status_code == 403


def test_a_failed_save_does_not_leak_database_text(env, monkeypatch):
    client, _ = env
    from app.services.tenant_service import SqlStore

    def boom(self, data):
        raise RuntimeError('relation "tenant_leases" violates secret_constraint on host db.internal')
    monkeypatch.setattr(SqlStore, "insert_lease", boom)
    r = client.post("/tenants/leases", json=lease_body())
    assert r.status_code == 500
    assert "secret_constraint" not in r.text and "db.internal" not in r.text and "tenant_leases" not in r.text


def test_delete_lease_is_idempotent_on_repeated_requests(env):
    client, holder = env
    holder["user"] = FINANCE
    created = client.post("/tenants/leases", json=lease_body()).json()
    lease_id = created["lease_id"]

    # First delete returns 204
    r1 = client.delete(f"/tenants/leases/{lease_id}")
    assert r1.status_code == 204

    # Second concurrent or duplicate delete on same lease_id also returns 204 (idempotent)
    r2 = client.delete(f"/tenants/leases/{lease_id}")
    assert r2.status_code == 204
