import unittest
import os
import sys

# Set up test environment
os.environ["TESTING"] = "1"
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from decimal import Decimal
from app.db.session import SessionLocal, init_db
from app.models.company import Company
from app.models.bank import BankAccount, BankTransaction
from app.schemas.company import CompanyCreate, CompanyUpdate
from app.services.company_service import CompanyService


class TestCompanyBankStartingBalanceSync(unittest.TestCase):
    def setUp(self):
        init_db()
        self.db = SessionLocal()
        self.service = CompanyService(self.db)

    def tearDown(self):
        self.db.close()

    def test_create_company_auto_creates_primary_bank_with_starting_balance(self):
        comp_in = CompanyCreate(
            name="Auto Bank Co",
            location="Makati",
            starting_balance=Decimal("250000.00"),
            petty_cash=Decimal("5000.00"),
        )
        result = self.service.create_company(comp_in)
        self.assertIsNotNone(result.id)
        self.assertEqual(result.starting_balance, 250000.00)

        # Verify BankAccount was auto-created
        acc = self.db.query(BankAccount).filter(BankAccount.company_id == result.id).first()
        self.assertIsNotNone(acc)
        self.assertEqual(acc.company_name, "Auto Bank Co")
        self.assertEqual(acc.bank_name, "CHINABANK")
        self.assertEqual(Decimal(str(acc.starting_balance)), Decimal("250000.00"))
        self.assertEqual(Decimal(str(acc.current_balance)), Decimal("250000.00"))

    def test_update_company_starting_balance_syncs_existing_bank_and_recalculates(self):
        comp_in = CompanyCreate(
            name="Sync Existing Bank Co",
            location="BGC",
            starting_balance=Decimal("100000.00"),
        )
        result = self.service.create_company(comp_in)
        acc = self.db.query(BankAccount).filter(BankAccount.company_id == result.id).first()
        self.assertIsNotNone(acc)
        self.assertEqual(Decimal(str(acc.starting_balance)), Decimal("100000.00"))

        # Add transactions to this bank account
        self.db.add(BankTransaction(
            id="tx-test-01",
            bank_account_id=acc.id,
            transaction_date="2026-11-16",
            particulars="Customer Deposit",
            deposit=Decimal("20000.00"),
            withdrawal=Decimal("0.00"),
            net_amount=Decimal("20000.00"),
            category="Sales Deposit",
        ))
        self.db.add(BankTransaction(
            id="tx-test-02",
            bank_account_id=acc.id,
            transaction_date="2026-11-16",
            particulars="Office Supplies",
            deposit=Decimal("0.00"),
            withdrawal=Decimal("5000.00"),
            net_amount=Decimal("-5000.00"),
            category="Operating Expense",
        ))
        acc.current_balance = Decimal("115000.00")
        self.db.commit()

        # Now Admin updates company starting balance to 300000.00
        updated = self.service.update_company(result.id, CompanyUpdate(starting_balance=Decimal("300000.00")))
        self.assertIsNotNone(updated)
        self.assertEqual(updated.starting_balance, 300000.00)

        self.db.refresh(acc)
        # Starting balance is updated
        self.assertEqual(Decimal(str(acc.starting_balance)), Decimal("300000.00"))
        # Current balance is re-derived: 300000 + 20000 - 5000 = 315000
        self.assertEqual(Decimal(str(acc.current_balance)), Decimal("315000.00"))

    def test_reconcile_existing_company_starting_balances(self):
        # Create a company without a bank account
        company = Company(
            company_name="Orphan Balance Corp",
            location="Ortigas",
            starting_balance=Decimal("500000.00"),
        )
        self.db.add(company)
        self.db.commit()
        self.db.refresh(company)

        # Reconcile
        reconciled = self.service.reconcile_existing_company_starting_balances()
        self.assertGreaterEqual(reconciled, 1)

        acc = self.db.query(BankAccount).filter(BankAccount.company_id == company.company_id).first()
        self.assertIsNotNone(acc)
        self.assertEqual(Decimal(str(acc.starting_balance)), Decimal("500000.00"))
        self.assertEqual(Decimal(str(acc.current_balance)), Decimal("500000.00"))


if __name__ == "__main__":
    unittest.main()
