from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.company import Company
from app.models.receivable import Receivable, ReceivablePayment
from app.models.tenant import TenantLease, TenantLeasePayment
from app.models.bank import BankAccount, BankTransaction
from app.models.user import User, UserCompany
from app.models.audit_log import AuditLog
from app.models.notification import Notification, NotificationOutbox
from app.services.company_service import CompanyService


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_delete_company_non_existent(db_session):
    service = CompanyService(db_session)
    assert service.delete_company(999) is False


def test_delete_company_cascades_all_child_records(db_session):
    # Setup company
    company = Company(
        company_id=10,
        company_name="Target Enterprise Inc.",
        location="Manila",
        starting_balance=Decimal("50000.00"),
        petty_cash=Decimal("5000.00"),
        logo_url="https://example.supabase.co/storage/v1/object/public/Company%20Profiles%20Pictures/company/10/logo.png",
    )
    db_session.add(company)
    db_session.commit()

    # 1. Receivables & Payments
    rec = Receivable(
        receivable_id=101,
        company_id=10,
        company_name="Target Enterprise Inc.",
        customer_name="John Doe",
        customer_type="External",
        transaction_date=date(2026, 11, 1),
        items_summary="Catering services",
        total_amount=Decimal("15000.00"),
        amount_paid=Decimal("5000.00"),
        balance=Decimal("10000.00"),
        payment_status="Partial",
    )
    db_session.add(rec)
    db_session.commit()

    rec_payment = ReceivablePayment(
        payment_id=201,
        receivable_id=101,
        payment_date=date(2026, 11, 2),
        amount=Decimal("5000.00"),
        payment_method="Cash",
    )
    db_session.add(rec_payment)
    db_session.commit()

    # 2. Tenant Leases & Payments
    lease = TenantLease(
        lease_id=301,
        tenant_ref="REF-301",
        company_id=10,
        tenant_name="Alice Smith",
        unit_name="Unit 4B",
        rent_amount=Decimal("20000.00"),
        contract_date=date(2026, 1, 1),
        due_date=date(2026, 11, 5),
        total_amount_payable=Decimal("20000.00"),
    )
    db_session.add(lease)
    db_session.commit()

    lease_payment = TenantLeasePayment(
        payment_id=401,
        lease_id=301,
        payment_date=date(2026, 11, 5),
        amount=Decimal("20000.00"),
        method="Cash",
    )
    db_session.add(lease_payment)
    db_session.commit()

    # 3. Bank Accounts & Transactions
    bank_acc = BankAccount(
        id="bank_10_acc",
        bank_name="BDO",
        account_name="Target Main",
        account_number="123456789",
        company_name="Target Enterprise Inc.",
        company_id=10,
        starting_balance=Decimal("100000.00"),
        current_balance=Decimal("100000.00"),
    )
    db_session.add(bank_acc)
    db_session.commit()

    bank_tx = BankTransaction(
        id="tx_10_01",
        bank_account_id="bank_10_acc",
        transaction_date="2026-11-01",
        particulars="Opening deposit",
        deposit=Decimal("100000.00"),
        net_amount=Decimal("100000.00"),
    )
    db_session.add(bank_tx)
    db_session.commit()

    # 4. User Company link and User primary company
    user = User(
        user_id=50,
        name="Staff Member",
        email="staff@target.com",
        role="company",
        company_id=10,
    )
    db_session.add(user)
    db_session.commit()

    user_comp = UserCompany(
        user_id=50,
        company_id=10,
    )
    db_session.add(user_comp)
    db_session.commit()

    # 5. Audit Log with company_id
    audit = AuditLog(
        audit_log_id=601,
        company_id=10,
        user_id=50,
        action="RECORD_CREATED",
        action_category="TEST",
    )
    db_session.add(audit)
    db_session.commit()

    # 6. Notifications and Outbox
    notif = Notification(
        notification_id="notif_10_01",
        recipient_user_id=50,
        company_id=10,
        notification_type="SYSTEM",
        title="Welcome",
        message="Account created",
    )
    db_session.add(notif)

    outbox = NotificationOutbox(
        outbox_id=701,
        idempotency_key="key_10_01",
        event_type="TEST_EVENT",
        company_id=10,
        payload={"msg": "hello"},
    )
    db_session.add(outbox)
    db_session.commit()

    # Mock storage client so storage call is verified
    mock_storage = MagicMock()
    mock_storage.list.return_value = [{"name": "logo.png"}]
    mock_supabase = MagicMock()
    mock_supabase.storage.from_.return_value = mock_storage

    with patch("app.services.company_service.get_supabase_admin_client", return_value=mock_supabase):
        service = CompanyService(db_session)
        result = service.delete_company(10)

    assert result is True

    # Assert company parent is deleted
    assert db_session.query(Company).filter(Company.company_id == 10).first() is None

    # Assert receivables and payments are deleted
    assert db_session.query(Receivable).filter(Receivable.company_id == 10).first() is None
    assert db_session.query(ReceivablePayment).filter(ReceivablePayment.payment_id == 201).first() is None

    # Assert tenant leases and lease payments are deleted
    assert db_session.query(TenantLease).filter(TenantLease.company_id == 10).first() is None
    assert db_session.query(TenantLeasePayment).filter(TenantLeasePayment.payment_id == 401).first() is None

    # Assert bank accounts and bank transactions are deleted
    assert db_session.query(BankAccount).filter(BankAccount.company_id == 10).first() is None
    assert db_session.query(BankTransaction).filter(BankTransaction.id == "tx_10_01").first() is None

    # Assert user companies link is deleted
    assert db_session.query(UserCompany).filter(UserCompany.company_id == 10).first() is None

    # Assert notifications are deleted
    assert db_session.query(Notification).filter(Notification.company_id == 10).first() is None
    assert db_session.query(NotificationOutbox).filter(NotificationOutbox.company_id == 10).first() is None

    # Assert user primary company_id is set to None
    updated_user = db_session.query(User).filter(User.user_id == 50).first()
    assert updated_user is not None
    assert updated_user.company_id is None

    # Assert audit log company_id is set to None (history preserved)
    updated_audit = db_session.query(AuditLog).filter(AuditLog.audit_log_id == 601).first()
    assert updated_audit is not None
    assert updated_audit.company_id is None

    # Assert storage cleanup was invoked
    mock_storage.remove.assert_called_once()


def test_delete_company_storage_failure_resilience(db_session):
    company = Company(
        company_id=20,
        company_name="Resilience Corp",
        location="Cebu",
        starting_balance=Decimal("10000.00"),
        logo_url="https://example.supabase.co/storage/v1/object/public/Company%20Profiles%20Pictures/company/20/logo.png",
    )
    db_session.add(company)
    db_session.commit()

    # Mock storage client to raise an exception
    with patch("app.services.company_service.get_supabase_admin_client", side_effect=Exception("Storage offline")):
        service = CompanyService(db_session)
        result = service.delete_company(20)

    # Deletion must still succeed despite storage failure
    assert result is True
    assert db_session.query(Company).filter(Company.company_id == 20).first() is None

