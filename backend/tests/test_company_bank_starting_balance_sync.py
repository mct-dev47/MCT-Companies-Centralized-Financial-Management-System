from decimal import Decimal
import pytest
from sqlalchemy.orm import Session

from app.db.session import Base, SessionLocal, engine
from app.models.bank import BankAccount
from app.schemas.bank import BankAccountCreate
from app.schemas.company import CompanyCreate
from app.services.bank_service import BankService
from app.services.company_service import CompanyService


@pytest.fixture()
def db():
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.query(BankAccount).delete()
        session.commit()
        session.close()


def test_create_company_does_not_auto_create_bank_account(db: Session):
    service = CompanyService(db)
    comp_in = CompanyCreate(
        name="No Auto Bank Co",
        location="Makati",
        petty_cash=Decimal("5000.00"),
    )
    result = service.create_company(comp_in)
    assert result.id is not None

    acc = db.query(BankAccount).filter(BankAccount.company_id == result.id).first()
    assert acc is None


def test_bank_account_links_company_id_and_allows_unassigned(db: Session):
    comp = CompanyService(db).create_company(
        CompanyCreate(name="Linked Co", location="BGC")
    )
    bank_service = BankService(db)

    linked = bank_service.create_account(
        BankAccountCreate(
            bank_name="BDO",
            account_name="Linked Operating",
            company_name="Linked Co",
            company_id=comp.id,
            starting_balance=Decimal("100000.00"),
        )
    )
    assert linked.company_id == comp.id
    assert Decimal(str(linked.starting_balance)) == Decimal("100000.00")
    assert Decimal(str(linked.current_balance)) == Decimal("100000.00")

    unassigned = bank_service.create_account(
        BankAccountCreate(
            bank_name="BPI",
            account_name="General Treasury",
            company_name="General Treasury / Unassigned",
            company_id=None,
            starting_balance=Decimal("50000.00"),
        )
    )
    assert unassigned.company_id is None
    assert Decimal(str(unassigned.current_balance)) == Decimal("50000.00")
