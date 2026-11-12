from datetime import date
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.session import Base
from app.models.bank import BankAccount, BankTransaction
from app.models.company import Company
from app.models.finance import Sale
from app.models.receivable import Receivable
from app.schemas.receivable import ReceivablePaymentCreate
from app.services.receivables_service import ReceivablesService
from app.services.sales_receivables_sync import SalesReceivablesSyncService


def _setup():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    db.add(Company(company_id=1, company_name="MCT Kitchen", location="Manila", starting_balance=Decimal("0.00")))
    db.add(BankAccount(
        id="bnk-001", bank_name="BDO", account_name="Main", account_number="1",
        company_name="MCT Kitchen", company_id=1,
        starting_balance=Decimal("1000.00"), current_balance=Decimal("1000.00"),
    ))
    db.add(Sale(
        sales_id=1, company_id=1, transaction_date=date.today(), amount=Decimal("500.00"),
        particulars="Catering [Unpaid]", payment_status="Unpaid", deposit_status="Not Deposited",
    ))
    db.add(Receivable(
        receivable_id=1, company_id=1, company_name="MCT Kitchen", customer_name="Ana",
        customer_type="External", sale_id=1, sale_line_index=0, transaction_date=date.today(),
        items_summary="Catering", total_amount=Decimal("500.00"), amount_paid=Decimal("0.00"),
        balance=Decimal("500.00"), payment_status="Unpaid",
    ))
    db.commit()
    return db


def _bank(db):
    db.expire_all()
    return db.get(BankAccount, "bnk-001").current_balance


def test_receivable_payment_follows_sale_deposit_status():
    db = _setup()
    ReceivablesService(db).record_payment(
        1, ReceivablePaymentCreate(amount=Decimal("500.00"), payment_date=date.today(), bank_account_id="bnk-001")
    )

    # A collected payment auto-marks the sale Deposited on the payment day, so the bank holds it.
    sale = db.get(Sale, 1)
    assert "[Paid]" in sale.particulars
    assert sale.deposit_status == "Deposited"
    assert sale.deposit_date == date.today()
    assert _bank(db) == Decimal("1500.00")

    # A supervisor can still mark it Not Deposited: the ledger shows no cash, so the bank holds none.
    sync = SalesReceivablesSyncService(db)
    sync.set_sale_deposit(1, "Not Deposited")
    db.commit()
    assert _bank(db) == Decimal("1000.00")

    # ...and back to Deposited: the ledger counts 500, so the bank does too.
    sync.set_sale_deposit(1, "Deposited")
    db.commit()
    assert _bank(db) == Decimal("1500.00")

    # Reconciling again, or after an edit, must not double count the receivable payment.
    SalesReceivablesSyncService(db).reconcile_sale_bank(1)
    SalesReceivablesSyncService(db).reconcile_sale_bank(1, legacy_particulars="Catering [Paid]")
    assert _bank(db) == Decimal("1500.00")

    # Deleting the sale takes the money back out, exactly once.
    SalesReceivablesSyncService(db).sync_sale_deleted_to_receivables(1, company_id=1)
    SalesReceivablesSyncService(db).reconcile_sale_bank(1, force_zero=True)
    assert _bank(db) == Decimal("1000.00")

    # The bank balance always equals the starting balance plus its transactions.
    net = sum((t.deposit or 0) - (t.withdrawal or 0) for t in db.query(BankTransaction).all())
    assert _bank(db) == Decimal("1000.00") + Decimal(str(net))
    db.close()
