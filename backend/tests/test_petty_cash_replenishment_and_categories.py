"""
Tests for Petty Cash Replenishment, Dual-Row Ledger Logging, and Configurable Company Categories.
"""

from datetime import date
from decimal import Decimal
import os
import sys
import unittest

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.company import Company
from app.models.bank import BankAccount
from app.models.petty_cash import PettyCashCategory, PettyCashTopUp, PettyCashWallet
from app.schemas.petty_cash import PettyCashTopUpCreate, PettyCashCategoryCreate
from app.services.petty_cash_service import PettyCashService


class TestPettyCashReplenishmentAndCategories(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        Session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.db = Session()

        # Set up Company A and Company B
        self.comp_a = Company(company_id=101, company_name="Company Alpha", starting_balance=Decimal("100000.00"))
        self.comp_b = Company(company_id=102, company_name="Company Beta", starting_balance=Decimal("100000.00"))
        self.db.add_all([self.comp_a, self.comp_b])
        self.db.flush()

        # Bank accounts
        self.bank_a = BankAccount(
            id="BANK-A-01",
            company_id=101,
            company_name="Company Alpha",
            bank_name="Alpha Bank",
            account_name="Alpha Checking",
            account_number="101-0001",
            starting_balance=Decimal("50000.00"),
            current_balance=Decimal("50000.00"),
        )
        self.bank_b = BankAccount(
            id="BANK-B-01",
            company_id=102,
            company_name="Company Beta",
            bank_name="Beta Bank",
            account_name="Beta Checking",
            account_number="102-0001",
            starting_balance=Decimal("50000.00"),
            current_balance=Decimal("50000.00"),
        )
        self.db.add_all([self.bank_a, self.bank_b])
        self.db.flush()

        # Petty cash wallets
        self.wallet_a = PettyCashWallet(company_id=101, balance=Decimal("10000.00"), low_balance_threshold=Decimal("1000.00"))
        self.wallet_b = PettyCashWallet(company_id=102, balance=Decimal("10000.00"), low_balance_threshold=Decimal("1000.00"))
        self.db.add_all([self.wallet_a, self.wallet_b])
        self.db.commit()

        self.service = PettyCashService(self.db)

    def tearDown(self):
        self.db.close()

    def test_company_categories_isolation_and_uniqueness(self):
        """Categories must be scoped to a specific company and prevent duplicates."""
        # Add category to Company A
        cat_a1 = PettyCashCategory(company_id=101, name="Kitchen Supplies")
        cat_a2 = PettyCashCategory(company_id=101, name="Office Equipment")
        self.db.add_all([cat_a1, cat_a2])

        # Add category to Company B
        cat_b1 = PettyCashCategory(company_id=102, name="Fuel & Toll")
        self.db.add(cat_b1)
        self.db.commit()

        # Query categories for Company A
        cats_a = self.db.query(PettyCashCategory).filter(PettyCashCategory.company_id == 101).all()
        cats_a_names = [c.name for c in cats_a]
        self.assertEqual(len(cats_a_names), 2)
        self.assertIn("Kitchen Supplies", cats_a_names)
        self.assertIn("Office Equipment", cats_a_names)
        self.assertNotIn("Fuel & Toll", cats_a_names)

        # Query categories for Company B
        cats_b = self.db.query(PettyCashCategory).filter(PettyCashCategory.company_id == 102).all()
        cats_b_names = [c.name for c in cats_b]
        self.assertEqual(len(cats_b_names), 1)
        self.assertIn("Fuel & Toll", cats_b_names)
        self.assertNotIn("Kitchen Supplies", cats_b_names)

        # Delete category from Company A
        self.db.delete(cat_a1)
        self.db.commit()
        cats_a_after = self.db.query(PettyCashCategory).filter(PettyCashCategory.company_id == 101).all()
        self.assertEqual(len(cats_a_after), 1)
        self.assertEqual(cats_a_after[0].name, "Office Equipment")

    def test_mixed_replenishment_dual_row_logging(self):
        """A mixed replenishment claim (C > 0 and R > 0) must log two separate entries in list_ledger."""
        # Top-up wallet float with an initial approved topup
        initial_topup = PettyCashTopUp(
            company_id=101,
            amount=Decimal("15000.00"),
            topup_date=date.today(),
            status="Approved",
            request_type="topup",
            bank_account_id="BANK-A-01",
        )
        self.db.add(initial_topup)
        self.db.commit()

        # Submit mixed replenishment: Total = 8000, Petty Cash = 5000, Reimbursement = 3000
        claim_in = PettyCashTopUpCreate(
            company_id=101,
            amount=Decimal("3000.00"),
            topup_date=date.today(),
            request_type="reimbursement",
            paid_by="John Doe",
            description="Office stationery and snacks",
            category="Office Supplies",
            total_expenses=Decimal("8000.00"),
            company_funded_amount=Decimal("5000.00"),
        )
        created = self.service.create_topup(claim_in, current_user={"full_name": "Supervisor", "role": "supervisor"})
        self.assertEqual(created.status, "Pending Finance Endorsement")

        # In list_ledger, check that BOTH rows appear while pending
        ledger_pending = self.service.list_ledger(company=self.comp_a)
        # Find entries matching topup_id
        matching_entries = [e for e in ledger_pending if e.record_id == created.topup_id]
        self.assertEqual(len(matching_entries), 2, "Must produce two rows for mixed replenishment claim")

        # Verify Petty Cash Disbursement row
        pc_row = next(e for e in matching_entries if e.request_type == "replenishment_disbursement")
        self.assertEqual(pc_row.entry_id, f"topup-{created.topup_id}-pc")
        self.assertEqual(pc_row.amount_requested, Decimal("5000.00"))
        self.assertEqual(pc_row.amount_out, Decimal("0.00")) # not yet settled
        self.assertEqual(pc_row.status, "Pending Finance Endorsement")
        self.assertIn("[Petty Cash]", pc_row.description)

        # Verify Reimbursement row
        reimb_row = next(e for e in matching_entries if e.request_type == "reimbursement")
        self.assertEqual(reimb_row.entry_id, f"topup-{created.topup_id}-reimb")
        self.assertEqual(reimb_row.amount_requested, Decimal("3000.00"))
        self.assertEqual(reimb_row.amount_out, Decimal("0.00"))
        self.assertEqual(reimb_row.status, "Pending Finance Endorsement")
        self.assertIn("[Replenishment]", reimb_row.description)

        # Unified lifecycle: Finance endorses, Audit approves
        self.service.endorse_topup(created.topup_id, action="endorse", remark="Endorsed", bank_account_id="BANK-A-01")
        self.service.review_topup(created.topup_id, action="approve", remark="Audit verified")

        # Finance reimburses
        reimbursed = self.service.reimburse(created.topup_id, current_user={"full_name": "Finance Officer"})
        self.assertEqual(reimbursed.status, "Reimbursed")

        # Check list_ledger after reimbursement
        ledger_reimbursed = self.service.list_ledger(company=self.comp_a)
        matching_after = [e for e in ledger_reimbursed if e.record_id == created.topup_id]
        self.assertEqual(len(matching_after), 2)

        pc_after = next(e for e in matching_after if e.request_type == "replenishment_disbursement")
        self.assertEqual(pc_after.amount_out, Decimal("5000.00"), "Petty cash disbursement row records OUT (-) 5,000")
        self.assertEqual(pc_after.status, "Reimbursed")

        reimb_after = next(e for e in matching_after if e.request_type == "reimbursement")
        self.assertEqual(reimb_after.amount_out, Decimal("0.00"), "Reimbursement is paid from bank, float is unchanged")
        self.assertEqual(reimb_after.status, "Reimbursed")

    def test_zero_company_cash_omits_disbursement_row(self):
        """When 100% is paid out-of-pocket (C = 0), only the Replenishment row appears."""
        claim_in = PettyCashTopUpCreate(
            company_id=101,
            amount=Decimal("4000.00"),
            topup_date=date.today(),
            request_type="reimbursement",
            paid_by="Jane Smith",
            description="Emergency repair paid personally",
            category="Repairs",
            total_expenses=Decimal("4000.00"),
            company_funded_amount=Decimal("0.00"),
        )
        created = self.service.create_topup(claim_in)
        ledger = self.service.list_ledger(company=self.comp_a)
        matching = [e for e in ledger if e.record_id == created.topup_id]
        self.assertEqual(len(matching), 1, "Only 1 row must appear when company cash is 0")
        self.assertEqual(matching[0].request_type, "reimbursement")
        self.assertEqual(matching[0].amount_requested, Decimal("4000.00"))

    def test_zero_excess_omits_reimbursement_row(self):
        """When 100% was paid from petty cash (O = 0), only the Petty Cash Disbursement row appears."""
        # Top-up wallet float first
        self.db.add(PettyCashTopUp(company_id=101, amount=Decimal("10000.00"), topup_date=date.today(), status="Approved", request_type="topup", bank_account_id="BANK-A-01"))
        self.db.commit()

        claim_in = PettyCashTopUpCreate(
            company_id=101,
            amount=Decimal("0.00"),
            topup_date=date.today(),
            request_type="reimbursement",
            paid_by="Finance Officer",
            description="Office stationery from petty cash float",
            category="Office Supplies",
            total_expenses=Decimal("2500.00"),
            company_funded_amount=Decimal("2500.00"),
        )
        created = self.service.create_topup(claim_in)
        ledger = self.service.list_ledger(company=self.comp_a)
        matching = [e for e in ledger if e.record_id == created.topup_id]
        self.assertEqual(len(matching), 1, "Only 1 row must appear when employee reimbursement is 0")
        self.assertEqual(matching[0].request_type, "replenishment_disbursement")
        self.assertEqual(matching[0].amount_requested, Decimal("2500.00"))

    def test_category_api_endpoints(self):
        """Verify GET, POST, DELETE /api/v1/petty-cash/categories endpoint functions."""
        from app.api.v1.endpoints.petty_cash import list_categories, create_category, delete_category
        from app.schemas.petty_cash import PettyCashCategoryCreate

        fake_user = {"user_id": 1, "role": "admin", "full_name": "Admin User", "company_ids": [101, 102]}

        # 1. Initially empty for Company Alpha
        cats = list_categories(company_name="Company Alpha", current_user=fake_user, db=self.db)
        self.assertEqual(cats, [])

        # 2. Add category via create_category
        created_cat = create_category(
            payload=PettyCashCategoryCreate(company_name="Company Alpha", name="Travel & Meals"),
            current_user=fake_user,
            db=self.db,
        )
        self.assertEqual(created_cat.name, "Travel & Meals")
        self.assertEqual(created_cat.company_id, 101)

        # 3. Prevent duplicate category for same company (400)
        with self.assertRaises(HTTPException) as cm:
            create_category(
                payload=PettyCashCategoryCreate(company_name="Company Alpha", name="travel & meals"),
                current_user=fake_user,
                db=self.db,
            )
        self.assertEqual(cm.exception.status_code, 400)

        # 4. List now returns the category
        cats_list = list_categories(company_name="Company Alpha", current_user=fake_user, db=self.db)
        self.assertEqual(len(cats_list), 1)
        self.assertEqual(cats_list[0].name, "Travel & Meals")

        # 5. Delete category
        del_resp = delete_category(category_id=created_cat.category_id, current_user=fake_user, db=self.db)
        self.assertEqual(del_resp.status_code, 204)

        # 6. List is empty again
        cats_after = list_categories(company_name="Company Alpha", current_user=fake_user, db=self.db)
        self.assertEqual(cats_after, [])


if __name__ == "__main__":
    unittest.main()
