"""Spec 0045: tenant rent payments and borrower repayments become Sales on a chosen bank; a loan release
becomes an Expense on the borrower's bank. Edits and removals follow the payment until an Auditor
Verifies the linked sale/expense, after which the payment is locked."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.company_features import FILCAP_COMPANY_ID
from app.db.session import Base
from app.models.bank import BankAccount
from app.models.company import Company
from app.models.finance import Expense, Sale
from app.models.lending import Borrower, LendingTransaction
from app.models.tenant import TenantLeasePayment
from app.schemas.tenant import LeaseCreate, LeaseUpdate, PaymentIn
from app.services import tenant_service
from app.services.lending_service import LendingService
from app.services.tenant_service import TenantService

JK = 1
USER = {"auth_user_id": "a", "user_id": 1, "email": "admin@mct.com", "company_id": None,
        "company_ids": [], "is_admin": True, "role": "admin"}
TODAY = date.today()


@pytest.fixture()
def db(monkeypatch):
    monkeypatch.setattr(tenant_service, "_supabase_client", lambda: None)
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    session.add_all([
        Company(company_id=JK, company_name="JK Property and Ventures", starting_balance=0),
        Company(company_id=FILCAP_COMPANY_ID, company_name="FILCAP Prime Holdings Corp.", starting_balance=0),
        BankAccount(id="bnk-jk", bank_name="BDO", account_name="JK Main", account_number="1",
                    company_name="JK Property and Ventures", company_id=JK,
                    starting_balance=Decimal("1000.00"), current_balance=Decimal("1000.00")),
        BankAccount(id="bnk-fc", bank_name="BPI", account_name="FilCap Main", account_number="2",
                    company_name="FILCAP Prime Holdings Corp.", company_id=FILCAP_COMPANY_ID,
                    starting_balance=Decimal("10000.00"), current_balance=Decimal("10000.00")),
    ])
    session.commit()
    yield session
    session.close()


def _balance(db, acc):
    db.expire_all()
    return Decimal(str(db.get(BankAccount, acc).current_balance))


# ── Tenants ─────────────────────────────────────────────────────────────────

def _lease(db, bank="bnk-jk"):
    svc = TenantService(db, use_supabase=False)
    lease = svc.create_lease(LeaseCreate(
        company_id=JK, tenant_name="Juan", unit_name="Unit 1", rent_amount=500,
        contract_date=TODAY, due_date=TODAY, total_amount_payable=2000, bank_account_id=bank,
    ), USER)
    return svc, lease


def test_tenant_payment_becomes_a_deposited_sale_on_the_lease_bank(db):
    svc, lease = _lease(db)
    assert lease["bank_account_id"] == "bnk-jk"
    out = svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, amount=500, method="Cash"), USER)
    sale_id = out["payments"][0]["sale_id"]
    sale = db.get(Sale, sale_id)
    assert sale.company_id == JK and sale.bank_account_id == "bnk-jk"
    assert Decimal(str(sale.amount)) == Decimal("500.00")
    assert sale.deposit_status == "Deposited" and sale.deposit_date == TODAY
    assert "Rent: Juan" in sale.particulars
    assert _balance(db, "bnk-jk") == Decimal("1500.00")


def test_editing_a_tenant_payment_updates_its_sale_and_the_bank(db):
    svc, lease = _lease(db)
    out = svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, amount=500), USER)
    pid, sale_id = out["payments"][0]["payment_id"], out["payments"][0]["sale_id"]
    svc.update_payment(lease["lease_id"], pid, PaymentIn(payment_date=TODAY, amount=300), USER)
    db.expire_all()
    assert Decimal(str(db.get(Sale, sale_id).amount)) == Decimal("300.00")
    assert _balance(db, "bnk-jk") == Decimal("1300.00")


def test_removing_a_tenant_payment_removes_its_sale_and_money(db):
    svc, lease = _lease(db)
    out = svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, amount=500), USER)
    pid, sale_id = out["payments"][0]["payment_id"], out["payments"][0]["sale_id"]
    svc.delete_payment(lease["lease_id"], pid, USER)
    db.expire_all()
    assert db.get(Sale, sale_id) is None
    assert _balance(db, "bnk-jk") == Decimal("1000.00")


def test_verified_tenant_sale_locks_the_payment(db):
    svc, lease = _lease(db)
    out = svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, amount=500), USER)
    pid, sale_id = out["payments"][0]["payment_id"], out["payments"][0]["sale_id"]
    db.get(Sale, sale_id).audit_status = "Verified"
    db.commit()
    with pytest.raises(HTTPException) as e:
        svc.update_payment(lease["lease_id"], pid, PaymentIn(payment_date=TODAY, amount=300), USER)
    assert e.value.status_code == 409
    with pytest.raises(HTTPException):
        svc.delete_payment(lease["lease_id"], pid, USER)
    with pytest.raises(HTTPException):
        svc.delete_lease(lease["lease_id"], USER)
    db.expire_all()
    assert db.get(TenantLeasePayment, pid) is not None
    assert _balance(db, "bnk-jk") == Decimal("1500.00")


def test_missed_mark_makes_no_sale(db):
    svc, lease = _lease(db)
    out = svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, status="Missed"), USER)
    assert out["payments"][0]["sale_id"] is None
    assert db.query(Sale).count() == 0


def test_lease_without_bank_makes_no_sale(db):
    svc, lease = _lease(db, bank=None)
    svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, amount=500), USER)
    assert db.query(Sale).count() == 0


def test_lease_bank_must_belong_to_the_company(db):
    with pytest.raises(HTTPException) as e:
        _lease(db, bank="bnk-fc")
    assert e.value.status_code == 400


def _second_jk_bank(db):
    db.add(BankAccount(id="bnk-jk2", bank_name="MBTC", account_name="JK 2", account_number="3",
                       company_name="JK Property and Ventures", company_id=JK,
                       starting_balance=Decimal("0"), current_balance=Decimal("0")))
    db.commit()


def test_changing_lease_bank_moves_recorded_payments_and_their_money(db):
    svc, lease = _lease(db)
    out = svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, amount=500), USER)
    first_sale = out["payments"][0]["sale_id"]
    _second_jk_bank(db)
    svc.update_lease(lease["lease_id"], LeaseUpdate(bank_account_id="bnk-jk2"), USER)
    svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, amount=200), USER)
    db.expire_all()
    assert db.get(Sale, first_sale).bank_account_id == "bnk-jk2"
    assert _balance(db, "bnk-jk") == Decimal("1000.00")
    assert _balance(db, "bnk-jk2") == Decimal("700.00")
    assert db.query(Sale).count() == 2


def test_renaming_the_tenant_patches_the_sale_text(db):
    svc, lease = _lease(db)
    out = svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, amount=500), USER)
    sale_id = out["payments"][0]["sale_id"]
    svc.update_lease(lease["lease_id"], LeaseUpdate(tenant_name="Pedro", unit_name="Unit 9"), USER)
    db.expire_all()
    sale = db.get(Sale, sale_id)
    assert "Rent: Pedro - Unit 9" in sale.particulars
    assert Decimal(str(sale.amount)) == Decimal("500.00")
    assert _balance(db, "bnk-jk") == Decimal("1500.00")


def test_removing_the_lease_bank_takes_recorded_payments_out_of_the_bank(db):
    svc, lease = _lease(db)
    out = svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, amount=500), USER)
    sale_id = out["payments"][0]["sale_id"]
    after = svc.update_lease(lease["lease_id"], LeaseUpdate(bank_account_id=""), USER)
    db.expire_all()
    assert db.get(Sale, sale_id) is None
    assert after["payments"][0]["sale_id"] is None
    assert _balance(db, "bnk-jk") == Decimal("1000.00")


def test_adding_a_bank_to_a_lease_puts_recorded_payments_in_it(db):
    svc, lease = _lease(db, bank=None)
    svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, amount=500), USER)
    after = svc.update_lease(lease["lease_id"], LeaseUpdate(bank_account_id="bnk-jk"), USER)
    assert after["payments"][0]["sale_id"] is not None
    assert _balance(db, "bnk-jk") == Decimal("1500.00")


def test_verified_payment_blocks_moving_the_lease_bank(db):
    svc, lease = _lease(db)
    out = svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, amount=500), USER)
    sale_id = out["payments"][0]["sale_id"]
    db.get(Sale, sale_id).audit_status = "Verified"
    db.commit()
    _second_jk_bank(db)
    with pytest.raises(HTTPException) as e:
        svc.update_lease(lease["lease_id"], LeaseUpdate(bank_account_id="bnk-jk2"), USER)
    assert e.value.status_code == 409
    db.expire_all()
    assert db.get(Sale, sale_id).bank_account_id == "bnk-jk"
    assert svc.get_lease(lease["lease_id"], USER)["bank_account_id"] == "bnk-jk"
    assert _balance(db, "bnk-jk") == Decimal("1500.00")
    # Notes don't touch the sale, so they can still be edited
    svc.update_lease(lease["lease_id"], LeaseUpdate(notes="ok"), USER)


# ── Lending ─────────────────────────────────────────────────────────────────

def _borrower(db, amount=1000, bank="bnk-fc"):
    return LendingService.create_borrower(
        db=db, borrower_name="Maria", principal_amount=Decimal(str(amount)), interest_rate=Decimal("20"),
        frequency="Daily", date_borrowed_val=TODAY.isoformat(), term_days_val=40, bank_account_id=bank,
    )


def test_loan_release_is_an_expense_from_the_borrower_bank(db):
    b = _borrower(db)
    assert b["bankAccountId"] == "bnk-fc"
    exp = db.get(Expense, b["releaseExpenseId"])
    assert exp.company_id == FILCAP_COMPANY_ID and exp.bank_account_id == "bnk-fc"
    assert Decimal(str(exp.amount)) == Decimal("1000.00")
    assert _balance(db, "bnk-fc") == Decimal("9000.00")


def test_cannot_release_more_than_the_bank_holds(db):
    with pytest.raises(HTTPException) as e:
        _borrower(db, amount=20000)
    assert e.value.status_code == 400
    assert db.query(Borrower).count() == 0


def test_repayment_becomes_a_sale_including_penalty(db):
    b = _borrower(db)
    tx = LendingService.record_payment(
        db=db, borrower_id=b["borrower_id"], payment_date_val=TODAY.isoformat(),
        amount_val=Decimal("30"), penalty_amount_val=Decimal("5"), method="Cash",
    )
    row = db.get(LendingTransaction, tx["transaction_id"])
    sale = db.get(Sale, row.sale_id)
    assert sale.bank_account_id == "bnk-fc" and sale.company_id == FILCAP_COMPANY_ID
    assert Decimal(str(sale.amount)) == Decimal("35.00")
    assert _balance(db, "bnk-fc") == Decimal("9035.00")


def test_repayment_edit_and_delete_follow_the_sale(db):
    b = _borrower(db)
    tx = LendingService.record_payment(
        db=db, borrower_id=b["borrower_id"], payment_date_val=TODAY.isoformat(), amount_val=Decimal("30"),
    )
    sale_id = db.get(LendingTransaction, tx["transaction_id"]).sale_id
    LendingService.update_payment(db=db, transaction_id=tx["transaction_id"], payload={"amount": Decimal("50")})
    db.expire_all()
    assert Decimal(str(db.get(Sale, sale_id).amount)) == Decimal("50.00")
    assert _balance(db, "bnk-fc") == Decimal("9050.00")

    LendingService.delete_payment(db=db, transaction_id=tx["transaction_id"])
    db.expire_all()
    assert db.get(Sale, sale_id) is None
    assert _balance(db, "bnk-fc") == Decimal("9000.00")


def test_verified_repayment_sale_locks_the_repayment(db):
    b = _borrower(db)
    tx = LendingService.record_payment(
        db=db, borrower_id=b["borrower_id"], payment_date_val=TODAY.isoformat(), amount_val=Decimal("30"),
    )
    sale_id = db.get(LendingTransaction, tx["transaction_id"]).sale_id
    db.get(Sale, sale_id).audit_status = "Verified"
    db.commit()
    with pytest.raises(HTTPException) as e:
        LendingService.update_payment(db=db, transaction_id=tx["transaction_id"], payload={"amount": Decimal("50")})
    assert e.value.status_code == 409
    with pytest.raises(HTTPException):
        LendingService.delete_payment(db=db, transaction_id=tx["transaction_id"])
    with pytest.raises(HTTPException):
        LendingService.delete_borrower(db, b["borrower_id"])


def test_deleting_a_borrower_returns_the_release_and_removes_repayments(db):
    b = _borrower(db)
    LendingService.record_payment(
        db=db, borrower_id=b["borrower_id"], payment_date_val=TODAY.isoformat(), amount_val=Decimal("30"),
    )
    LendingService.delete_borrower(db, b["borrower_id"])
    db.expire_all()
    assert db.query(Sale).count() == 0
    assert db.query(Expense).count() == 0
    assert _balance(db, "bnk-fc") == Decimal("10000.00")


def test_verified_release_blocks_loan_changes(db):
    b = _borrower(db)
    db.get(Expense, b["releaseExpenseId"]).audit_status = "Verified"
    db.commit()
    with pytest.raises(HTTPException) as e:
        LendingService.update_borrower(db, b["borrower_id"], {"loan_amount": Decimal("500")})
    assert e.value.status_code == 409
    # Changes that don't touch the release are still fine
    LendingService.update_borrower(db, b["borrower_id"], {"notes": "ok"})


def test_editing_the_principal_updates_the_release(db):
    b = _borrower(db)
    LendingService.update_borrower(db, b["borrower_id"], {"loan_amount": Decimal("600")})
    db.expire_all()
    assert Decimal(str(db.get(Expense, b["releaseExpenseId"]).amount)) == Decimal("600.00")
    assert _balance(db, "bnk-fc") == Decimal("9400.00")


def _second_filcap_bank(db):
    db.add(BankAccount(id="bnk-fc2", bank_name="UB", account_name="FilCap 2", account_number="4",
                       company_name="FILCAP Prime Holdings Corp.", company_id=FILCAP_COMPANY_ID,
                       starting_balance=Decimal("5000.00"), current_balance=Decimal("5000.00")))
    db.commit()


def test_changing_borrower_bank_moves_release_and_repayments(db):
    b = _borrower(db)
    tx = LendingService.record_payment(
        db=db, borrower_id=b["borrower_id"], payment_date_val=TODAY.isoformat(), amount_val=Decimal("30"),
    )
    sale_id = db.get(LendingTransaction, tx["transaction_id"]).sale_id
    _second_filcap_bank(db)
    LendingService.update_borrower(db, b["borrower_id"], {"bank_account_id": "bnk-fc2"})
    db.expire_all()
    assert db.get(Sale, sale_id).bank_account_id == "bnk-fc2"
    assert db.get(Expense, b["releaseExpenseId"]).bank_account_id == "bnk-fc2"
    assert _balance(db, "bnk-fc") == Decimal("10000.00")
    assert _balance(db, "bnk-fc2") == Decimal("4030.00")


def test_renaming_borrower_patches_repayment_sale_text(db):
    b = _borrower(db)
    tx = LendingService.record_payment(
        db=db, borrower_id=b["borrower_id"], payment_date_val=TODAY.isoformat(), amount_val=Decimal("30"),
    )
    sale_id = db.get(LendingTransaction, tx["transaction_id"]).sale_id
    LendingService.update_borrower(db, b["borrower_id"], {"borrower_name": "Rosa"})
    db.expire_all()
    assert "Loan Repayment: Rosa" in db.get(Sale, sale_id).particulars
    assert "Loan Release: Rosa" in db.get(Expense, b["releaseExpenseId"]).description
    assert _balance(db, "bnk-fc") == Decimal("9030.00")


def test_verified_repayment_blocks_moving_the_borrower_bank(db):
    b = _borrower(db)
    tx = LendingService.record_payment(
        db=db, borrower_id=b["borrower_id"], payment_date_val=TODAY.isoformat(), amount_val=Decimal("30"),
    )
    sale_id = db.get(LendingTransaction, tx["transaction_id"]).sale_id
    db.get(Sale, sale_id).audit_status = "Verified"
    db.commit()
    _second_filcap_bank(db)
    with pytest.raises(HTTPException) as e:
        LendingService.update_borrower(db, b["borrower_id"], {"bank_account_id": "bnk-fc2"})
    assert e.value.status_code == 409
    db.expire_all()
    assert db.get(Borrower, b["borrower_id"]).bank_account_id == "bnk-fc"
    assert _balance(db, "bnk-fc") == Decimal("9030.00")
    assert _balance(db, "bnk-fc2") == Decimal("5000.00")


# ── Records made by Tenants / Lending are read-only in Sales and Expenses ───

def test_tenant_and_lending_records_are_tagged_and_locked(db):
    from app.services import income_bank_links as links

    svc, lease = _lease(db)
    rent_sale = svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, amount=500), USER)["payments"][0]["sale_id"]
    b = _borrower(db)
    tx = LendingService.record_payment(
        db=db, borrower_id=b["borrower_id"], payment_date_val=TODAY.isoformat(), amount_val=Decimal("30"),
    )
    repay_sale = db.get(LendingTransaction, tx["transaction_id"]).sale_id
    plain = Sale(company_id=JK, amount=Decimal("10"), transaction_date=TODAY, particulars="walk-in")
    db.add(plain)
    db.commit()

    assert links.sale_sources(db, [rent_sale, repay_sale, plain.sales_id]) == {
        rent_sale: "Tenants", repay_sale: "Lending",
    }
    assert links.expense_sources(db, [b["releaseExpenseId"]]) == {b["releaseExpenseId"]: "Lending"}

    with pytest.raises(HTTPException) as e:
        links.assert_not_linked_sale(db, rent_sale)
    assert e.value.status_code == 409 and "Tenants" in e.value.detail
    with pytest.raises(HTTPException):
        links.assert_not_linked_sale(db, repay_sale)
    with pytest.raises(HTTPException):
        links.assert_not_linked_expense(db, b["releaseExpenseId"])
    links.assert_not_linked_sale(db, plain.sales_id)  # an ordinary sale stays editable


# ── Edits patch the one bank entry (no reversal lines) ──────────────────────

def _entries(db, **link):
    from app.models.bank import BankTransaction
    db.expire_all()
    q = db.query(BankTransaction)
    for k, v in link.items():
        q = q.filter(getattr(BankTransaction, k) == v)
    return q.all()


def test_editing_a_tenant_payment_patches_the_one_bank_deposit(db):
    svc, lease = _lease(db)
    out = svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, amount=1500), USER)
    pid, sale_id = out["payments"][0]["payment_id"], out["payments"][0]["sale_id"]
    first = _entries(db, source_sale_id=sale_id)
    assert len(first) == 1
    svc.update_payment(lease["lease_id"], pid, PaymentIn(payment_date=TODAY, amount=1000), USER)
    rows = _entries(db, source_sale_id=sale_id)
    assert len(rows) == 1 and rows[0].id == first[0].id
    assert Decimal(str(rows[0].deposit)) == Decimal("1000.00")
    assert Decimal(str(rows[0].withdrawal or 0)) == Decimal("0.00")
    assert not rows[0].particulars.startswith("Reversal")
    assert _balance(db, "bnk-jk") == Decimal("2000.00")


def test_moving_lease_bank_moves_the_one_entry(db):
    svc, lease = _lease(db)
    out = svc.add_payment(lease["lease_id"], PaymentIn(payment_date=TODAY, amount=500), USER)
    sale_id = out["payments"][0]["sale_id"]
    _second_jk_bank(db)
    svc.update_lease(lease["lease_id"], LeaseUpdate(bank_account_id="bnk-jk2"), USER)
    rows = _entries(db, source_sale_id=sale_id)
    assert len(rows) == 1 and rows[0].bank_account_id == "bnk-jk2"
    assert _balance(db, "bnk-jk") == Decimal("1000.00")
    assert _balance(db, "bnk-jk2") == Decimal("500.00")


def test_editing_a_repayment_and_principal_patch_their_one_entries(db):
    b = _borrower(db)
    # The principal can only change before any repayment
    LendingService.update_borrower(db, b["borrower_id"], {"loan_amount": Decimal("600")})
    rel = _entries(db, source_expense_id=b["releaseExpenseId"])
    assert len(rel) == 1 and Decimal(str(rel[0].withdrawal)) == Decimal("600.00")

    tx = LendingService.record_payment(
        db=db, borrower_id=b["borrower_id"], payment_date_val=TODAY.isoformat(), amount_val=Decimal("30"),
    )
    sale_id = db.get(LendingTransaction, tx["transaction_id"]).sale_id
    LendingService.update_payment(db=db, transaction_id=tx["transaction_id"], payload={"amount": Decimal("20")})
    rows = _entries(db, source_sale_id=sale_id)
    assert len(rows) == 1 and Decimal(str(rows[0].deposit)) == Decimal("20.00")
    assert _balance(db, "bnk-fc") == Decimal("9420.00")
