import logging
from datetime import date
from decimal import Decimal
from pathlib import PurePosixPath
from typing import List, Optional
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.cache import system_cache
from app.db.supabase import get_supabase_admin_client
from app.models.company import Company, CompanyNotificationSettings
from app.models.petty_cash import PettyCashTopUp, PettyCashWallet
from app.schemas.company import CompanyCreate, CompanyOut, CompanyUpdate
from app.schemas.notification import CompanyNotificationSettingsOut, CompanyNotificationSettingsUpdate
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

    def _sync_company_to_supabase(self, company: Company) -> None:
        try:
            client = get_supabase_admin_client()
            payload = {
                "company_id": company.company_id,
                "company_name": company.company_name,
                "location": company.location,
                "contact_number": company.contact_number,
                "phone": company.phone,
                "starting_balance": float(company.starting_balance or 0.0),
                "petty_cash": float(company.petty_cash or 0.0),
                "logo_url": company.logo_url,
            }
            client.table("company").upsert(payload).execute()
        except Exception as exc:
            logger.warning("Failed to sync company %s to Supabase: %s", company.company_id, exc)

    def _sync_from_supabase_if_fallback(self) -> None:
        try:
            if self.db.bind and self.db.bind.dialect.name == "sqlite":
                client = get_supabase_admin_client()
                supa_companies = client.table("company").select("*").execute().data
                if supa_companies:
                    for sc in supa_companies:
                        cid = sc.get("company_id")
                        if not cid:
                            continue
                        existing = self.db.query(Company).filter(Company.company_id == cid).first()
                        p_cash = Decimal(str(sc.get("petty_cash") or 0.0))
                        s_bal = Decimal(str(sc.get("starting_balance") or 0.0))
                        if existing:
                            existing.company_name = sc.get("company_name") or existing.company_name
                            existing.location = sc.get("location") or existing.location
                            existing.contact_number = sc.get("contact_number")
                            existing.phone = sc.get("phone")
                            existing.starting_balance = s_bal
                            existing.petty_cash = p_cash
                            existing.logo_url = sc.get("logo_url")
                        else:
                            self.db.add(Company(
                                company_id=cid,
                                company_name=sc.get("company_name"),
                                location=sc.get("location"),
                                contact_number=sc.get("contact_number"),
                                phone=sc.get("phone"),
                                starting_balance=s_bal,
                                petty_cash=p_cash,
                                logo_url=sc.get("logo_url"),
                            ))
                    self.db.commit()
        except Exception as exc:
            logger.debug("Supabase company sync skipped: %s", exc)

    #list_companies retrieves all companies from the database, orders them by company_id in ascending order, and returns a list of CompanyOut objects.
    def list_companies(self) -> List[CompanyOut]:
        try:
            self._sync_from_supabase_if_fallback()
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
            self._sync_from_supabase_if_fallback()
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
            comp = (
                self.db.query(Company)
                .filter(Company.company_id == company_id)
                .first()
            )
            if not comp:
                self._sync_from_supabase_if_fallback()
                comp = (
                    self.db.query(Company)
                    .filter(Company.company_id == company_id)
                    .first()
                )
            return comp
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

            # Sync company row directly to Supabase table
            self._sync_company_to_supabase(company)

            if company.petty_cash and company.petty_cash > 0:
                try:
                    topup = PettyCashTopUp(
                        company_id=company.company_id,
                        amount=company.petty_cash,
                        topup_date=date.today(),
                        reference_no="INITIAL-PC",
                        description="Initial Petty Cash Deposit",
                        status="Approved",
                    )
                    self.db.add(topup)

                    wallet = (
                        self.db.query(PettyCashWallet)
                        .filter(PettyCashWallet.company_id == company.company_id)
                        .first()
                    )
                    if wallet:
                        wallet.balance = company.petty_cash
                    else:
                        wallet = PettyCashWallet(
                            company_id=company.company_id,
                            balance=company.petty_cash,
                            low_balance_threshold=Decimal("1000.00"),
                        )
                        self.db.add(wallet)

                    self.db.commit()
                except Exception as exc:
                    logger.warning("Could not create initial petty cash topup: %s", exc)

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

            # Sync company row directly to Supabase table
            self._sync_company_to_supabase(company)

            if company.petty_cash and company.petty_cash > 0:
                try:
                    topup = PettyCashTopUp(
                        company_id=company.company_id,
                        amount=company.petty_cash,
                        topup_date=date.today(),
                        reference_no="INITIAL-PC",
                        description="Initial Petty Cash Deposit",
                        status="Approved",
                    )
                    self.db.add(topup)

                    wallet = (
                        self.db.query(PettyCashWallet)
                        .filter(PettyCashWallet.company_id == company.company_id)
                        .first()
                    )
                    if wallet:
                        wallet.balance = company.petty_cash
                    else:
                        wallet = PettyCashWallet(
                            company_id=company.company_id,
                            balance=company.petty_cash,
                            low_balance_threshold=Decimal("1000.00"),
                        )
                        self.db.add(wallet)

                    self.db.commit()
                except Exception as exc:
                    logger.warning("Could not create initial petty cash topup: %s", exc)

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

            # Re-sync logo_url to Supabase table
            self._sync_company_to_supabase(company)

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

            # Re-sync updated picture url to Supabase table
            self._sync_company_to_supabase(company)

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

            # If petty_cash was updated, sync INITIAL-PC topup and PettyCashWallet
            if "petty_cash" in company_in.model_dump(exclude_unset=True):
                new_petty = company.petty_cash or Decimal("0.00")
                try:
                    init_topup = (
                        self.db.query(PettyCashTopUp)
                        .filter(
                            PettyCashTopUp.company_id == company.company_id,
                            PettyCashTopUp.reference_no == "INITIAL-PC",
                        )
                        .first()
                    )
                    if init_topup:
                        init_topup.amount = new_petty
                        init_topup.status = "Approved"
                    elif new_petty > 0:
                        init_topup = PettyCashTopUp(
                            company_id=company.company_id,
                            amount=new_petty,
                            topup_date=date.today(),
                            reference_no="INITIAL-PC",
                            description="Initial Petty Cash Deposit",
                            status="Approved",
                        )
                        self.db.add(init_topup)

                    wallet = (
                        self.db.query(PettyCashWallet)
                        .filter(PettyCashWallet.company_id == company.company_id)
                        .first()
                    )
                    if wallet:
                        wallet.balance = new_petty
                    elif new_petty > 0:
                        wallet = PettyCashWallet(
                            company_id=company.company_id,
                            balance=new_petty,
                            low_balance_threshold=Decimal("1000.00"),
                        )
                        self.db.add(wallet)

                    self.db.commit()
                except Exception as exc:
                    logger.warning("Could not sync initial petty cash topup on update: %s", exc)

            # Sync updated company row directly to Supabase table
            self._sync_company_to_supabase(company)

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
            self.db.execute(text("DELETE FROM company_payment_methods WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM company_particulars WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("DELETE FROM company_notification_settings WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("UPDATE users SET company_id = NULL WHERE company_id = :id"), {"id": company_id})
            self.db.execute(text("UPDATE audit_logs SET company_id = NULL WHERE company_id = :id"), {"id": company_id})

            self.db.delete(company)
            self.db.commit()

            # Ensure company is removed from Supabase table if using SQLite or separate connection
            try:
                client = get_supabase_admin_client()
                client.table("company").delete().eq("company_id", company_id).execute()
            except Exception as exc:
                logger.warning("Could not delete company %s from Supabase: %s", company_id, exc)
        except SQLAlchemyError as error:
            raise self._database_error("delete company", error)

        self._cleanup_company_storage(company_id, logo_url)
        return True

    def get_notification_settings(self, company_id: int) -> Optional[CompanyNotificationSettingsOut]:
        cache_key = f"notif_settings:c:{company_id}"
        cached = system_cache.get(cache_key)
        if cached is not None and getattr(cached, "id", 0) > 0:
            return cached

        company = self.get_company(company_id)
        if not company:
            return None

        try:
            settings_row = (
                self.db.query(CompanyNotificationSettings)
                .filter(CompanyNotificationSettings.company_id == company_id)
                .first()
            )
            if not settings_row:
                try:
                    settings_row = CompanyNotificationSettings(
                        company_id=company_id,
                        transaction_alerts=True,
                        loan_reminders=True,
                        daily_summary=False,
                        audit_alerts=True,
                    )
                    self.db.add(settings_row)
                    self.db.commit()
                    self.db.refresh(settings_row)
                except IntegrityError:
                    self.db.rollback()
                    settings_row = (
                        self.db.query(CompanyNotificationSettings)
                        .filter(CompanyNotificationSettings.company_id == company_id)
                        .first()
                    )

            out = CompanyNotificationSettingsOut.model_validate(settings_row)
            system_cache.set(
                cache_key,
                out,
                ttl=300,
                tags=["notif_settings", f"notif_settings:c:{company_id}"],
            )
            return out
        except SQLAlchemyError as error:
            raise self._database_error("get company notification settings", error)

    def update_notification_settings(
        self,
        company_id: int,
        payload: CompanyNotificationSettingsUpdate,
    ) -> Optional[CompanyNotificationSettingsOut]:
        company = self.get_company(company_id)
        if not company:
            return None

        try:
            settings_row = (
                self.db.query(CompanyNotificationSettings)
                .filter(CompanyNotificationSettings.company_id == company_id)
                .first()
            )
            if not settings_row:
                settings_row = CompanyNotificationSettings(
                    company_id=company_id,
                    transaction_alerts=True,
                    loan_reminders=True,
                    daily_summary=False,
                    audit_alerts=True,
                )
                self.db.add(settings_row)

            update_data = payload.model_dump(exclude_unset=True)
            for field in ("transaction_alerts", "loan_reminders", "daily_summary", "audit_alerts"):
                if field in update_data and update_data[field] is not None:
                    setattr(settings_row, field, bool(update_data[field]))

            self.db.commit()
            self.db.refresh(settings_row)

            out = CompanyNotificationSettingsOut.model_validate(settings_row)
            cache_key = f"notif_settings:c:{company_id}"
            system_cache.invalidate_tag(f"notif_settings:c:{company_id}")
            system_cache.invalidate_tag("notifications")
            system_cache.set(
                cache_key,
                out,
                ttl=300,
                tags=["notif_settings", f"notif_settings:c:{company_id}"],
            )
            return out
        except SQLAlchemyError as error:
            raise self._database_error("update company notification settings", error)

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