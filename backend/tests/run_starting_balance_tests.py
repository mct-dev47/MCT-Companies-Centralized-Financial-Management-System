"""Standalone verification for company and bank account creation without starting balance sync."""
import os
import sys
import unittest
from decimal import Decimal

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["TESTING"] = "1"

from app.db.session import Base, SessionLocal, engine
from app.models.bank import BankAccount
from app.schemas.bank import BankAccountCreate
from app.schemas.company import CompanyCreate
from app.services.bank_service import BankService
from app.services.company_service import CompanyService


class TestCompanyBankSchemaLink(unittest.TestCase):
    def setUp(self):
        Base.metadata.create_all(bind=engine)
        self.db = SessionLocal()
        self.service = CompanyService(self.db)
        self.bank_service = BankService(self.db)

    def tearDown(self):
        self.db.close()

    def test_company_creation_and_explicit_bank_creation(self):
        comp = self.service.create_company(
            CompanyCreate(name="Explicit Bank Co", location="Makati", petty_cash=Decimal("5000.00"))
        )
        self.assertIsNotNone(comp.id)
        auto_acc = self.db.query(BankAccount).filter(BankAccount.company_id == comp.id).first()
        self.assertIsNone(auto_acc)

        acc = self.bank_service.create_account(
            BankAccountCreate(
                bank_name="CHINABANK",
                account_name="Operating Account",
                company_name="Explicit Bank Co",
                company_id=comp.id,
                starting_balance=Decimal("250000.00"),
            )
        )
        self.assertEqual(acc.company_id, comp.id)
        self.assertEqual(Decimal(str(acc.starting_balance)), Decimal("250000.00"))


if __name__ == "__main__":
    unittest.main()
