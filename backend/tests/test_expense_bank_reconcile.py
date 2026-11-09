"""Spec 0044: the bank must always equal the Transactions ledger.
Only the PAID part of an expense leaves the bank, and a record always lands on its OWN bank."""
from datetime import date
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.expenses import reconcile_expense_bank
from app.db.session import Base
from app.models.bank import BankAccount, BankTransaction
from app.models.company import Company
from app.models.finance import Expense
from app.services.bank_service import BankService


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    db.add(Company(company_id=1, company_name="Acme", starting_balance=Decimal("0.00")))
    for acc_id in ("bnk-001", "bnk-002"):
        db.add(BankAccount(
            id=acc_id, bank_name="BDO", account_name=acc_id, account_number=acc_id,
            company_name="Acme", starting_balance=Decimal("1000.00"), current_balance=Decimal("1000.00"),
        ))
    db.commit()
    return db


def _balance(db, acc="bnk-001"):
    db.expire_all()
    return db.get(BankAccount, acc).current_balance


def _ledger(db, acc):
    rows = db.query(BankTransaction).filter(BankTransaction.bank_account_id == acc).all()
    return sum((r.deposit or 0) - (r.withdrawal or 0) for r in rows)


def _expense(db, description, amount, bank="bnk-001", method="Cash"):
    e = Expense(
        company_id=1, expense_date=date.today(), amount=Decimal(amount), description=description,
        payment_method=method, bank_account_id=bank,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


def test_pending_expense_does_not_touch_the_bank():
    db = _db()
    e = _expense(db, "Maynila (1x @ ₱200.00 = ₱200.00) [Pending]", "200")
    reconcile_expense_bank(db, expense_id=e.expense_id)
    assert _balance(db) == Decimal("1000.00")
    assert db.query(BankTransaction).count() == 0


def test_paid_expense_debits_exactly_the_paid_amount():
    db = _db()
    e = _expense(db, "Meralco (1x @ ₱300.00 = ₱300.00) [Paid]", "300")
    reconcile_expense_bank(db, expense_id=e.expense_id)
    assert _balance(db) == Decimal("700.00")
    reconcile_expense_bank(db, expense_id=e.expense_id)  # running again changes nothing
    assert db.query(BankTransaction).count() == 1


def test_mixed_expense_debits_only_paid_lines_then_follows_edits_and_delete():
    db = _db()
    e = _expense(
        db,
        "Rice (1x @ ₱100.00 = ₱100.00) [Paid]\nOil (1x @ ₱50.00 = ₱50.00) [Pending]",
        "150",
    )
    reconcile_expense_bank(db, expense_id=e.expense_id)
    assert _balance(db) == Decimal("900.00")          # only the paid ₱100

    e.description = "Rice (1x @ ₱100.00 = ₱100.00) [Paid]\nOil (1x @ ₱50.00 = ₱50.00) [Paid]"
    db.commit()
    reconcile_expense_bank(db, expense_id=e.expense_id)
    assert _balance(db) == Decimal("850.00")          # the pending line was paid later

    reconcile_expense_bank(db, expense_id=e.expense_id, force_zero=True)  # deleted
    assert _balance(db) == Decimal("1000.00")
    assert _balance(db) == Decimal("1000.00") + Decimal(str(_ledger(db, "bnk-001")))


def test_changing_the_expense_bank_moves_the_money():
    db = _db()
    e = _expense(db, "Meralco (1x @ ₱300.00 = ₱300.00) [Paid]", "300", bank="bnk-001")
    reconcile_expense_bank(db, expense_id=e.expense_id)
    e.bank_account_id = "bnk-002"
    db.commit()
    reconcile_expense_bank(db, expense_id=e.expense_id)
    assert _balance(db, "bnk-001") == Decimal("1000.00")
    assert _balance(db, "bnk-002") == Decimal("700.00")
    for acc in ("bnk-001", "bnk-002"):
        assert _balance(db, acc) == Decimal("1000.00") + Decimal(str(_ledger(db, acc)))


def test_petty_cash_expense_never_touches_a_bank():
    db = _db()
    e = _expense(db, "Snacks (1x @ ₱80.00 = ₱80.00) [Paid]", "80", method="Petty Cash")
    reconcile_expense_bank(db, expense_id=e.expense_id)
    assert _balance(db) == Decimal("1000.00")


def test_sale_money_lands_on_the_sales_own_bank_and_moves_with_it():
    db = _db()
    svc = BankService(db)
    # First recorded on the wrong account (what happened when no bank was passed)
    svc.sync_sale_deposit(sale_id=5, target_amount=Decimal("250"), account_id="bnk-001",
                          particulars="Sales Collection: Room")
    assert _balance(db, "bnk-001") == Decimal("1250.00")
    # The sale's real bank is bnk-002: reconcile moves it over, nothing is lost or doubled
    svc.sync_sale_deposit(sale_id=5, target_amount=Decimal("250"), account_id="bnk-002",
                          particulars="Sales Collection: Room")
    assert _balance(db, "bnk-001") == Decimal("1000.00")
    assert _balance(db, "bnk-002") == Decimal("1250.00")
    for acc in ("bnk-001", "bnk-002"):
        assert _balance(db, acc) == Decimal("1000.00") + Decimal(str(_ledger(db, acc)))
