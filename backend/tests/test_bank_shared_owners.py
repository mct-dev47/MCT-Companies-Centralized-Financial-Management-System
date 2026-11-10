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


def test_concurrent_saves_on_one_bank_never_lose_an_amount():
    """Two sessions that both loaded the account must each count their entry (no lost update)."""
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
    s1.deposit(a1.id, BankDepositWithdrawRequest(amount=Decimal("300")))
    s2.deposit(a2.id, BankDepositWithdrawRequest(amount=Decimal("40")))  # a2 still held the stale 1000
    final = BankService(Session())
    assert final.get_account(acc.id).current_balance == Decimal("1340")
    assert final.balance_discrepancy(acc.id) == Decimal("0.00")


def test_balance_always_equals_starting_plus_entries(svc):
    from app.models.bank import BankTransaction

    acc = _make(svc, ["Alpha", "Beta"])  # starting 1000
    svc.deposit(acc.id, BankDepositWithdrawRequest(amount=Decimal("300")), source_sale_id=7)
    svc.withdraw(acc.id, BankDepositWithdrawRequest(amount=Decimal("120")))
    svc.sync_sale_deposit(sale_id=8, target_amount=Decimal("55.50"), account_id=acc.id, company_name="Beta")
    svc.sync_sale_deposit(sale_id=8, target_amount=Decimal("20"), account_id=acc.id, company_name="Beta")  # edit down
    svc.sync_expense_disbursement(expense_id=3, target_amount=Decimal("45"), account_id=acc.id, company_name="Alpha")
    assert svc.balance_discrepancy(acc.id) == Decimal("0.00")
    assert svc.get_account(acc.id).current_balance == Decimal("1000") + 300 - 120 + 20 - 45

    svc.purge_linked_entries(link_attr="source_sale_id", link_id=7)  # deleting the sale removes its entries
    assert svc.balance_discrepancy(acc.id) == Decimal("0.00")
    assert svc.get_account(acc.id).current_balance == Decimal("1000") - 120 + 20 - 45
    assert svc.db.query(BankTransaction).filter(BankTransaction.source_sale_id == 7).count() == 0


def test_recompute_all_balances_repairs_drift(svc):
    acc = _make(svc, ["Alpha"])
    svc.deposit(acc.id, BankDepositWithdrawRequest(amount=Decimal("100")))
    acc = svc.get_account(acc.id)
    acc.current_balance = Decimal("9999.99")  # simulate drift from an outside edit
    svc.db.commit()
    assert svc.balance_discrepancy(acc.id) != Decimal("0.00")
    assert svc.recompute_all_balances() == 1
    assert svc.balance_discrepancy(acc.id) == Decimal("0.00")
    assert svc.get_account(acc.id).current_balance == Decimal("1100")


def test_only_bank_management_entries_are_marked_manual(svc):
    acc = _make(svc, ["Alpha"])
    _, manual = svc.deposit(acc.id, BankDepositWithdrawRequest(amount=Decimal("50")), entry_source="manual")
    _, manual_out = svc.withdraw(acc.id, BankDepositWithdrawRequest(amount=Decimal("20")), entry_source="manual")
    _, loan_like = svc.deposit(acc.id, BankDepositWithdrawRequest(amount=Decimal("70")))  # loans / petty cash path
    sale_tx = svc.sync_sale_deposit(sale_id=11, target_amount=Decimal("30"), account_id=acc.id)
    assert svc.balance_discrepancy(acc.id) == Decimal("0.00")
    acc_id, m_in, m_out, other, sale_id = acc.id, manual.id, manual_out.id, loan_like.id, sale_tx.id

    # A fresh read (what the API serves) carries the marker on exactly the manual entries
    svc.db.expunge_all()
    sources = {t.id: t.entry_source_safe for t in svc.list_accounts()[0].transactions}
    assert sources[m_in] == "manual" and sources[m_out] == "manual"
    assert sources[other] is None and sources[sale_id] is None
    single = {t.id: t.entry_source_safe for t in svc.get_account(acc_id, with_entries=True).transactions}
    assert single == sources


def test_bank_reads_and_writes_work_before_migration_0051(svc, monkeypatch):
    """On a database without the entry_source column, banks still load and entries still save."""
    from app.services import bank_service

    monkeypatch.setattr(bank_service, "entry_source_supported", lambda db: False)
    acc = _make(svc, ["Alpha"])
    _, tx = svc.deposit(acc.id, BankDepositWithdrawRequest(amount=Decimal("50")), entry_source="manual")
    svc.db.expunge_all()
    loaded = svc.list_accounts()
    assert [a.id for a in loaded] == [acc.id]
    assert loaded[0].transactions[0].entry_source_safe is None  # marker simply unknown until the column exists
    assert loaded[0].current_balance == Decimal("1050")


def test_bank_management_endpoints_mark_entries_manual():
    import inspect
    from app.api.v1.endpoints import bank_accounts

    src = inspect.getsource(bank_accounts)
    assert 'service.deposit(account_id, req, entry_source="manual")' in src
    assert 'service.withdraw(account_id, req, entry_source="manual")' in src


def test_default_bank_is_the_one_the_company_owns_alone(svc):
    shared = _make(svc, ["Alpha", "Beta"])  # created first, so it would win a plain "first match"
    beta_own = svc.create_account(
        BankAccountCreate(bank_name="BPI", account_name="Beta Own", company_name="Beta", starting_balance=Decimal("0"))
    )
    assert svc.find_account_for_company("Beta").id == beta_own.id
    # Alpha has no bank of its own, so the shared bank is its default
    assert svc.find_account_for_company("Alpha").id == shared.id
