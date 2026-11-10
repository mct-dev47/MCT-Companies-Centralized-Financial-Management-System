"""A bank account can have several owner companies; entries are tagged with the owner they belong to."""
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (register all tables)
from app.db.session import Base
from app.schemas.bank import BankAccountCreate, BankAccountUpdate, BankDepositWithdrawRequest
from app.services.bank_service import BankService


@pytest.fixture()
def svc():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    yield BankService(db)
    db.close()


def _make(svc, names):
    return svc.create_account(
        BankAccountCreate(
            bank_name="BDO", account_name="Ops", company_name=names[0], company_names=names,
            starting_balance=Decimal("1000"),
        )
    )


def test_single_owner_is_not_shared(svc):
    acc = _make(svc, ["Alpha"])
    assert acc.company_names == ["Alpha"]


def test_multiple_owners_listed_for_each_company(svc):
    acc = _make(svc, ["Alpha", "Beta"])
    assert acc.company_names == ["Alpha", "Beta"]
    assert [a.id for a in svc.list_accounts(company_name="Beta")] == [acc.id]
    assert svc.find_account_for_company("Beta").id == acc.id


def test_entries_are_tagged_with_company(svc):
    acc = _make(svc, ["Alpha", "Beta"])
    _, tx_b = svc.deposit(acc.id, BankDepositWithdrawRequest(amount=Decimal("50"), company_name="Beta"))
    _, tx_default = svc.withdraw(acc.id, BankDepositWithdrawRequest(amount=Decimal("10")))
    assert tx_b.company_name == "Beta"
    assert tx_default.company_name == "Alpha"  # falls back to the primary owner


def test_cannot_remove_owner_that_has_entries(svc):
    acc = _make(svc, ["Alpha", "Beta"])
    svc.deposit(acc.id, BankDepositWithdrawRequest(amount=Decimal("50"), company_name="Beta"))
    with pytest.raises(ValueError):
        svc.update_account(acc.id, BankAccountUpdate(company_names=["Alpha"]))
    updated = svc.update_account(acc.id, BankAccountUpdate(company_names=["Alpha", "Beta", "Gamma"]))
    assert updated.company_names == ["Alpha", "Beta", "Gamma"]


def test_purge_linked_entries_removes_rows_and_fixes_balance(svc):
    from app.models.bank import BankTransaction

    acc = _make(svc, ["Alpha"])
    svc.deposit(acc.id, BankDepositWithdrawRequest(amount=Decimal("300")), source_sale_id=87)
    svc.deposit(acc.id, BankDepositWithdrawRequest(amount=Decimal("40")))  # unrelated entry must stay
    assert svc.get_account(acc.id).current_balance == Decimal("1340")
    assert svc.purge_linked_entries(link_attr="source_sale_id", link_id=87) == 1
    assert svc.get_account(acc.id).current_balance == Decimal("1040")
    assert svc.db.query(BankTransaction).filter(BankTransaction.source_sale_id == 87).count() == 0
    assert svc.db.query(BankTransaction).count() == 1


def test_check_any_owner_access_enforces_boundaries(svc):
    from fastapi import HTTPException
    from app.api.v1.endpoints.bank_accounts import _check_any_owner_access
    from app.models.company import Company

    # Seed companies Alpha (id=10) and Beta (id=20)
    c1 = Company(company_id=10, company_name="Alpha", starting_balance=Decimal("0.00"))
    c2 = Company(company_id=20, company_name="Beta", starting_balance=Decimal("0.00"))
    svc.db.add_all([c1, c2])
    svc.db.commit()

    shared_acc = _make(svc, ["Alpha", "Beta"])

    # User with access only to Alpha (id=10)
    user_alpha = {"role": "supervisor", "company_id": 10, "company_ids": [10]}
    # Should succeed since user has access to Alpha, one of the owners
    _check_any_owner_access(svc.db, user_alpha, shared_acc)

    # User with access only to Gamma (id=30)
    user_gamma = {"role": "supervisor", "company_id": 30, "company_ids": [30]}
    with pytest.raises(HTTPException) as exc_info:
        _check_any_owner_access(svc.db, user_gamma, shared_acc)
    assert exc_info.value.status_code == 403

    # Account with empty company names should be denied
    class EmptyAccount:
        company_names = []
        company_name = None

    with pytest.raises(HTTPException) as exc_info_empty:
        _check_any_owner_access(svc.db, user_alpha, EmptyAccount())
    assert exc_info_empty.value.status_code == 403



def test_transaction_ids_are_unique_and_time_ordered(svc):
    ids = [svc._generate_transaction_id() for _ in range(2000)]
    assert len(set(ids)) == len(ids)
    assert ids[0][:16] <= ids[-1][:16]  # epoch-ms prefix never goes backwards


def test_concurrent_balance_updates_are_not_lost():
    """Two sessions that both loaded the account must each add their amount (no lost update)."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    acc = _make(BankService(Session()), ["Alpha"])  # starting balance 1000

    s1, s2 = BankService(Session()), BankService(Session())
    a1, a2 = s1.get_account(acc.id), s2.get_account(acc.id)
    assert a1.current_balance == a2.current_balance == Decimal("1000")
    s1._adjust_balance(a1, Decimal("300"))
    s1.db.commit()
    s2._adjust_balance(a2, Decimal("40"))  # a2 still holds the stale 1000 in memory
    s2.db.commit()
    assert BankService(Session()).get_account(acc.id).current_balance == Decimal("1340")
