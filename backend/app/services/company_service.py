import logging
from datetime import date
from decimal import Decimal
from pathlib import PurePosixPath
from typing import List, Optional
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.supabase import get_supabase_admin_client
from app.models.company import Company
from app.models.petty_cash import PettyCashTopUp
from app.schemas.company import CompanyCreate, CompanyOut, CompanyUpdate
from app.services.finance_service import FinanceService

logger = logging.getLogger(__name__)


class CompanyServiceError(Exception):
    """Safe application error for company operations."""


class CompanyService:
    _company_picture_bucket = "Company Profiles Pictures"

    _required_update_fields = {
        "name",
        "location",
        "starting_balance",
    }

    # initialize the CompanyService with a database session and a FinanceService
    def __init__(self, db: Session):
        self.db = db
        self.finance_service = FinanceService(db)

    #list_companies retrieves all companies from the database, orders them by company_id in ascending order, and returns a list of CompanyOut objects.
    def list_companies(self) -> List[CompanyOut]:
        try:
            companies = (
                self.db.query(Company)
                .order_by(Company.company_id.asc())
                .all()
            )
            # Fetch revenue/expense/net-profit for every company in two grouped

            summaries = self.finance_service.get_list_summaries_for_companies(
                [company.company_id for company in companies]
            )
            return [
                self._build_company_out(
                    company,
                    total_revenue=float(summaries[company.company_id]["total_revenue"]),
                    total_expenses=float(summaries[company.company_id]["total_expenses"]),
                    net_profit=float(summaries[company.company_id]["net_profit"]),
                )
                for company in companies
            ]
        except SQLAlchemyError as error:
            raise self._database_error("list companies", error)

    # list_companies_lookup retrieves only company_id and company_name without heavy financial aggregation
    def list_companies_lookup(self) -> List[dict]:
        try:
            companies = (
                self.db.query(Company.company_id, Company.company_name)
                .order_by(Company.company_id.asc())
                .all()
            )
            return [
                {
                    "company_id": c.company_id,
                    "company_name": c.company_name,
                    "id": c.company_id,
                    "name": c.company_name,
                }
                for c in companies
            ]
        except SQLAlchemyError as error:
            raise self._database_error("list companies lookup", error)

    #retrieves a company by its ID from the database and returns the Company object if found, or None if not found.
    def get_company(self, company_id: int) -> Optional[Company]:
        try:
            return (
                self.db.query(Company)
                .filter(Company.company_id == company_id)
                .first()
            )
        except SQLAlchemyError as error:
            raise self._database_error("get company", error)

    #retrieves a company by its ID and returns a CompanyOut object if found, or None if not found. It uses the get_company method to fetch the company and then converts it to a response format using the to_response method.
    def get_company_response(self, company_id: int) -> Optional[CompanyOut]:
        company = self.get_company(company_id)
        try:
            return self.to_response(company) if company else None
        except SQLAlchemyError as error:
            raise self._database_error("build company response", error)

    #creates a new company in the database using the provided CompanyCreate object. It initializes a new Company instance with the data from the CompanyCreate object, adds it to the database session, commits the transaction, and refreshes the instance to get the updated state. Finally, it returns a CompanyOut object representing the newly created company.
    def create_company(self, company_in: CompanyCreate) -> CompanyOut:
        company = Company(
            company_name=company_in.name,
            location=company_in.location,
            contact_number=company_in.contact_number,
            phone=company_in.phone,
            starting_balance=company_in.starting_balance if company_in.starting_balance is not None else Decimal("0.00"),
            petty_cash=company_in.petty_cash or Decimal("0.00"),
            logo_url=company_in.logo_url,
        )
        try:
            self.db.add(company)
            self.db.commit()
            self.db.refresh(company)

            if company_in.petty_cash and company_in.petty_cash > 0:
                try:
                    topup = PettyCashTopUp(
                        company_id=company.company_id,
                        amount=company_in.petty_cash,
                        topup_date=date.today(),
                        reference_no="INITIAL-PC",
                        description="Initial Petty Cash Deposit",
                    )
                    self.db.add(topup)
                    self.db.commit()
                except Exception as exc:
                    logger.warning(f"Could not create initial petty cash topup: {exc}")

            return self.to_response(company)
        except SQLAlchemyError as error:
            raise self._database_error("create company", error)

    def create_company_with_picture(
        self,
        company_in: CompanyCreate,
        picture: bytes,
        content_type: str,
        filename: str,
    ) -> CompanyOut:
        company = Company(
            company_name=company_in.name,
            location=company_in.location,
            contact_number=company_in.contact_number,
            phone=company_in.phone,
            starting_balance=company_in.starting_balance if company_in.starting_balance is not None else Decimal("0.00"),
            petty_cash=company_in.petty_cash or Decimal("0.00"),
        )
        storage_path = ""
        company_created = False
        try:
            self.db.add(company)
            self.db.commit()
            self.db.refresh(company)
            company_created = True

            if company_in.petty_cash and company_in.petty_cash > 0:
                try:
                    topup = PettyCashTopUp(
                        company_id=company.company_id,
                        amount=company_in.petty_cash,
                        topup_date=date.today(),
                        reference_no="INITIAL-PC",
                        description="Initial Petty Cash Deposit",
                    )
                    self.db.add(topup)
                    self.db.commit()
                except Exception as exc:
                    logger.warning(f"Could not create initial petty cash topup: {exc}")

            extension = PurePosixPath(filename).suffix.lower()
            storage_path = f"company/{company.company_id}/{uuid4().hex}{extension}"
            storage = get_supabase_admin_client().storage.from_(
                self._company_picture_bucket
            )
            storage.upload(
                storage_path,
                picture,
                {"content-type": content_type, "upsert": "false"},
            )
            company.logo_url = storage.get_public_url(storage_path)
            self.db.commit()
            self.db.refresh(company)
            return self.to_response(company)
        except SQLAlchemyError as error:
            self.db.rollback()
            if storage_path:
                self._remove_picture(storage_path)
            if company_created:
                self._remove_company(company)
            raise self._database_error("create company with picture", error)
        except Exception as error:
            self.db.rollback()
            if storage_path:
                self._remove_picture(storage_path)
            if company_created:
                self._remove_company(company)
            logger.exception("Company picture upload failed (%s)", type(error).__name__)
            raise CompanyServiceError(
                "The company picture could not be uploaded."
            ) from error

    def upload_company_picture(
        self,
        company_id: int,
        picture: bytes,
        content_type: str,
        filename: str,
    ) -> Optional[CompanyOut]:
        company = self.get_company(company_id)
        if not company:
            return None

        storage_path = ""
        try:
            extension = PurePosixPath(filename).suffix.lower()
            storage_path = f"company/{company.company_id}/{uuid4().hex}{extension}"
            storage = get_supabase_admin_client().storage.from_(
                self._company_picture_bucket
            )
            storage.upload(
                storage_path,
                picture,
                {"content-type": content_type, "upsert": "false"},
            )
            company.logo_url = storage.get_public_url(storage_path)
            self.db.commit()
            self.db.refresh(company)
            return self.to_response(company)
        except SQLAlchemyError as error:
            self.db.rollback()
            if storage_path:
                self._remove_picture(storage_path)
            raise self._database_error("upload company picture", error)
        except Exception as error:
            self.db.rollback()
            if storage_path:
                self._remove_picture(storage_path)
            logger.exception("Company picture upload failed (%s)", type(error).__name__)
            raise CompanyServiceError(
                "The company picture could not be uploaded."
            ) from error

    def _remove_company(self, company: Company) -> None:
        try:
            self.db.delete(company)
            self.db.commit()
        except SQLAlchemyError:
            self.db.rollback()
            logger.exception("Could not clean up company: %s", company.company_id)

    def _remove_picture(self, storage_path: str) -> None:
        try:
            get_supabase_admin_client().storage.from_(
                self._company_picture_bucket
            ).remove([storage_path])
        except Exception:
            logger.exception("Could not clean up company picture: %s", storage_path)

    def _cleanup_company_storage(self, company_id: int, logo_url: Optional[str]) -> None:
        try:
            storage = get_supabase_admin_client().storage.from_(
                self._company_picture_bucket
            )
            folder = f"company/{company_id}"
            files_to_remove: List[str] = []
            try:
                listing = storage.list(folder)
                if listing and isinstance(listing, list):
                    for item in listing:
                        name = (
                            item.get("name")
                            if isinstance(item, dict)
                            else getattr(item, "name", None)
                        )
                        if name:
                            files_to_remove.append(f"{folder}/{name}")
            except Exception:
                logger.warning("Could not list storage files in folder %s", folder)

            if logo_url:
                bucket_token = (
                    "Company%20Profiles%20Pictures/"
                    if "Company%20Profiles%20Pictures/" in logo_url
                    else "Company Profiles Pictures/"
                )
                if bucket_token in logo_url:
                    parsed_path = logo_url.split(bucket_token)[-1].split("?")[0]
                    if parsed_path and parsed_path not in files_to_remove:
                        files_to_remove.append(parsed_path)

            if files_to_remove:
                storage.remove(files_to_remove)
        except Exception:
            logger.exception("Could not clean up storage files for company: %s", company_id)

    #updates an existing company in the database. It first retrieves the company using the get_company method. If the company is found, it updates its attributes based on the provided CompanyUpdate object, ensuring that required fields are not set to None. After updating, it commits the changes to the database and returns a CompanyOut object representing the updated company. If the company is not found, it returns None.
    def update_company(
        self,
        company_id: int,
        company_in: CompanyUpdate,
    ) -> Optional[CompanyOut]:
        company = self.get_company(company_id)
        if not company:
            return None

        update_data = company_in.model_dump(exclude_unset=True)
        invalid_required_fields = [
            field
            for field in self._required_update_fields
            if field in update_data and update_data[field] is None
        ]
        if invalid_required_fields:
            raise ValueError(
                f"{', '.join(sorted(invalid_required_fields))} cannot be null"
            )

        if "name" in update_data:
            company.company_name = update_data.pop("name")
        for field, value in update_data.items():
            setattr(company, field, value)

        try:
            self.db.commit()
            self.db.refresh(company)
            return self.to_response(company)
        except SQLAlchemyError as error:
            raise self._database_error("update company", error)

    def delete_company(self, company_id: int) -> bool:
        company = self.get_company(company_id)
        if not company:
            return False

        logo_url = company.logo_url

        try:
            # Cascade deletion of all dependent child records
            self.db.execute(text("DELETE FROM receivable_payments WHERE receivable_id IN (SELECT receivable_id FROM receivables WHERE company_id = :id)"), {"id": company_id})
            self.db.execute(text("DELETE FROM receivables WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM tenant_lease_payments WHERE lease_id IN (SELECT lease_id FROM tenant_leases WHERE company_id = :id)"), {"id": company_id})
            self.db.execute(text("DELETE FROM tenant_leases WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM bank_transactions WHERE bank_account_id IN (SELECT id FROM bank_accounts WHERE company_id = :id)"), {"id": company_id})
            self.db.execute(text("DELETE FROM bank_accounts WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM user_companies WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM notifications WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM notification_outbox WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM petty_cash_topups WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM petty_cash_wallets WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM bill_payments WHERE bill_id IN (SELECT bill_id FROM bills WHERE company_id = :id)"), {"id": company_id})
            self.db.execute(text("DELETE FROM bills WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM expenses WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM sales WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM cash_inflow WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM budget WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM loans_repayments WHERE loan_id IN (SELECT loan_id FROM loan WHERE borrower = :id OR lender = :id)"), {"id": company_id})
            self.db.execute(text("DELETE FROM loan WHERE borrower = :id OR lender = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM staff_credits WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("UPDATE users SET company_id = NULL WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("UPDATE audit_logs SET company_id = NULL WHERE company_id = :id"), {"id": company_id})

            self.db.delete(company)
            self.db.commit()
        except SQLAlchemyError as error:
            raise self._database_error("delete company", error)

        self._cleanup_company_storage(company_id, logo_url)
        return True

    #converts a Company object into a CompanyOut object, including financial summary data retrieved from the FinanceService.
    def to_response(self, company: Company) -> CompanyOut:
        try:
            summary = self.finance_service.get_company_financial_summary(
                company_id=company.company_id
            )
            return self._build_company_out(
                company,
                total_revenue=float(summary.total_revenue),
                total_expenses=float(summary.total_expenses),
                net_profit=float(summary.net_profit),
            )
        except SQLAlchemyError as error:
            raise self._database_error("build company response", error)

    # Assembles a CompanyOut from a company row plus already-computed financial
    # figures. Shared by the single-company path (to_response) and the batched
    # list path (list_companies) so the two can never drift apart.
    def _build_company_out(
        self,
        company: Company,
        total_revenue: float,
        total_expenses: float,
        net_profit: float,
    ) -> CompanyOut:
        return CompanyOut(
            id=company.company_id,
            name=company.company_name,
            location=company.location,
            contact_number=company.contact_number,
            phone=company.phone,
            starting_balance=float(company.starting_balance) if company.starting_balance is not None else 0.0,
            petty_cash=float(getattr(company, "petty_cash", 0.0) or 0.0),
            logo_url=company.logo_url,
            total_revenue=total_revenue,
            total_expenses=total_expenses,
            net_profit=net_profit,
            created_at=company.created_at,
            updated_at=company.updated_at,
        )

    def _database_error(
        self,
        operation: str,
        error: SQLAlchemyError,
    ) -> CompanyServiceError:
        self.db.rollback()
        logger.exception(
            "Company database operation failed: %s (%s)",
            operation,
            type(error).__name__,
        )
        return CompanyServiceError("The company operation could not be completed.")