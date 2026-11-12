from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import StaticPool
from app.core.config import settings
from typing import Generator
from urllib.parse import urlsplit, urlunsplit
import logging
import os

logger = logging.getLogger(__name__)

Base = declarative_base()


def create_db_engine(
    raw_db_url: str | None = None,
    environment: str | None = None,
    is_testing: bool | None = None,
):
    """
    Create and validate the SQLAlchemy database engine.
    - In TESTING mode (`TESTING=1`), uses an isolated disk-backed temporary SQLite file (`mct_test_<pid>.db`).
    - In PRODUCTION (`ENVIRONMENT=production`), requires PostgreSQL and fails fast if unreachable
      (never silently falling back to ephemeral local SQLite).
    - In DEVELOPMENT, falls back to local `mct_financial.db` if PostgreSQL is unconfigured/unreachable.
    """
    testing = is_testing if is_testing is not None else (os.environ.get("TESTING") == "1")
    if testing:
        import atexit
        import tempfile

        test_db_path = os.path.join(tempfile.gettempdir(), f"mct_test_{os.getpid()}.db")
        if os.path.exists(test_db_path):
            try:
                os.remove(test_db_path)
            except OSError:
                pass

        def _cleanup_test_db():
            for suffix in ("", "-wal", "-shm"):
                p = f"{test_db_path}{suffix}"
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except OSError:
                        pass

        atexit.register(_cleanup_test_db)
        return create_engine(
            f"sqlite:///{test_db_path}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )

    env_name = (environment if environment is not None else getattr(settings, "ENVIRONMENT", "development") or "development").strip().lower()
    is_prod = env_name == "production"
    db_url = (raw_db_url if raw_db_url is not None else settings.DATABASE_URL or "").strip()

    if is_prod and (not db_url or db_url.startswith("sqlite")):
        raise RuntimeError(
            "CRITICAL: Production environment requires a valid PostgreSQL DATABASE_URL. "
            "SQLite fallback is disabled in production to prevent split-brain data loss."
        )

    eng = None
    if db_url and not db_url.startswith("sqlite"):
        try:
            if db_url.startswith("postgres://"):
                db_url = db_url.replace("postgres://", "postgresql+psycopg2://", 1)
            elif db_url.startswith("postgresql://") and not db_url.startswith("postgresql+psycopg2://"):
                db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)
            parsed = urlsplit(db_url)
            if (
                parsed.hostname
                and (parsed.hostname == "pooler.supabase.com" or parsed.hostname.endswith(".pooler.supabase.com"))
                and parsed.port == 5432
            ):
                netloc = (
                    parsed.netloc[:-5] + ":6543"
                    if parsed.netloc.endswith(":5432")
                    else parsed.netloc.replace(":5432", ":6543")
                )
                db_url = urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))

            eng = create_engine(
                db_url,
                pool_pre_ping=True,
                pool_size=5,
                max_overflow=10,
                pool_recycle=1800,
                pool_timeout=30,
                connect_args={"connect_timeout": 30},
            )
            with eng.connect() as _probe:
                pass
        except Exception as e:
            eng = None
            if is_prod:
                logger.critical("CRITICAL: Failed to initialize PostgreSQL database engine in production: %s", e)
                raise RuntimeError(
                    "CRITICAL: Failed to connect to production PostgreSQL database. "
                    "Refusing to fall back to local SQLite in production."
                ) from e
            logger.warning(f"Failed to initialize database engine with {db_url}: {e}. Falling back to SQLite.")

    if eng is None:
        db_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "mct_financial.db")
        eng = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})

    return eng


engine = create_db_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def backfill_sale_statuses(conn) -> None:
    """
    Fill in sales whose payment / deposit status is missing (AC-7). Runs on every startup, so it must
    only touch blank values: it never changes a status someone chose. Overwriting 'Not Deposited' with
    'Deposited' (or the reverse) in raw SQL bypasses the bank sync, so the bank and the Transactions
    ledger stop matching.
    """
    from sqlalchemy import text

    conn.execute(text("UPDATE sales SET payment_status = 'Paid' WHERE payment_status IS NULL OR payment_status = ''"))
    conn.execute(text(
        "UPDATE sales SET "
        "deposit_status = CASE WHEN payment_status = 'Paid' THEN 'Deposited' ELSE 'Not Deposited' END, "
        "deposit_date = CASE WHEN payment_status = 'Paid' THEN COALESCE(deposit_date, transaction_date) ELSE NULL END "
        "WHERE deposit_status IS NULL OR deposit_status = ''"
    ))


def init_db():
    import app.models.company
    import app.models.finance
    import app.models.user
    import app.models.audit_log
    import app.models.loan
    import app.models.staff_credit
    import app.models.bills
    import app.models.petty_cash
    import app.models.intercompany_transfer
    import app.models.bank
    import app.models.lending
    import app.models.security
    import app.models.notification
    import app.models.receivable
    import app.models.invitation
    import app.models.particular
    import app.models.payment_method
    from app.db.migrations import run_migrations
    from app.models.company import Company


    from sqlalchemy.exc import ProgrammingError, OperationalError

    try:
        try:
            run_migrations(engine)
        except Exception as me:
            logger.warning(f"Migration runner encountered an issue: {me}. Falling back to metadata inspection.")
        Base.metadata.create_all(bind=engine)
    except (ProgrammingError, OperationalError) as e:
        if "already exists" not in str(e).lower():
            raise

        from sqlalchemy import inspect as sa_inspect

        existing = set(sa_inspect(engine).get_table_names())
        missing = [t for t in Base.metadata.sorted_tables if t.name not in existing]
        if missing:
            logger.warning(
                "Schema partially exists; creating %d missing table(s): %s",
                len(missing),
                ", ".join(t.name for t in missing),
            )
            for table in missing:
                try:
                    table.create(bind=engine, checkfirst=True)
                except (ProgrammingError, OperationalError) as te:
                    if "already exists" not in str(te).lower():
                        raise
                    logger.warning("Skipping existing object for table %s: %s", table.name, te)
        else:
            logger.warning(
                "All tables already exist (likely provisioned out-of-band); "
                "skipping create and continuing startup."
            )

    
    try:
        from sqlalchemy import inspect as sqla_inspect, text
        inspector = sqla_inspect(engine)
        table_names = set(inspector.get_table_names())
        if "sales" in table_names:
            sales_cols = {col["name"] for col in inspector.get_columns("sales")}
            with engine.begin() as conn:
                if "payment_method" not in sales_cols:
                    conn.execute(text("ALTER TABLE sales ADD COLUMN payment_method VARCHAR(100) NULL"))
                if "payment_status" not in sales_cols:
                    conn.execute(text("ALTER TABLE sales ADD COLUMN payment_status VARCHAR(50) DEFAULT 'Paid'"))
                if "deposit_status" not in sales_cols:
                    conn.execute(text("ALTER TABLE sales ADD COLUMN deposit_status VARCHAR(50) DEFAULT 'Not Deposited'"))
                if "deposit_date" not in sales_cols:
                    conn.execute(text("ALTER TABLE sales ADD COLUMN deposit_date DATE NULL"))
                    conn.execute(text("UPDATE sales SET deposit_date = transaction_date WHERE deposit_status = 'Deposited' AND deposit_date IS NULL"))
                if "remarks" not in sales_cols:
                    conn.execute(text("ALTER TABLE sales ADD COLUMN remarks TEXT NULL"))
                if "bank_account_id" not in sales_cols:
                    conn.execute(text("ALTER TABLE sales ADD COLUMN bank_account_id VARCHAR(100) NULL"))
            # Safe backfill (AC-7)
            with engine.begin() as conn:
                backfill_sale_statuses(conn)

        if "bank_transactions" in table_names:
            bank_tx_cols = {col["name"] for col in inspector.get_columns("bank_transactions")}
            if "source_sale_id" not in bank_tx_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE bank_transactions ADD COLUMN source_sale_id INTEGER"))
            if "source_expense_id" not in bank_tx_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE bank_transactions ADD COLUMN source_expense_id INTEGER"))

        if "petty_cash_wallets" in table_names:
            existing_cols = {col["name"] for col in inspector.get_columns("petty_cash_wallets")}
            if "balance" not in existing_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE petty_cash_wallets ADD COLUMN balance NUMERIC(15, 2) DEFAULT 0.00"))

        if "receivables" in table_names:
            rec_cols = {col["name"] for col in inspector.get_columns("receivables")}
            if "sale_line_index" not in rec_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE receivables ADD COLUMN sale_line_index INTEGER"))
            for obsolete_col in ("customer_phone", "customer_role"):
                if obsolete_col in rec_cols:
                    try:
                        with engine.begin() as conn:
                            conn.execute(text(f"ALTER TABLE receivables DROP COLUMN {obsolete_col}"))
                    except Exception as drop_err:
                        logger.warning("Could not drop obsolete column receivables.%s: %s", obsolete_col, drop_err)

        if "lending_transactions" in table_names:
            lt_cols = {col["name"] for col in inspector.get_columns("lending_transactions")}
            if "recorded_by" not in lt_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE lending_transactions ADD COLUMN recorded_by VARCHAR(255)"))

        if "borrowers" in table_names:
            b_cols = {col["name"] for col in inspector.get_columns("borrowers")}
            if "audit_status" not in b_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE borrowers ADD COLUMN audit_status VARCHAR(20) DEFAULT 'Pending Audit'"))
            if "audited_by" not in b_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE borrowers ADD COLUMN audited_by VARCHAR(100)"))
            if "audited_at" not in b_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE borrowers ADD COLUMN audited_at TIMESTAMP WITH TIME ZONE"))
            if "audit_remarks" not in b_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE borrowers ADD COLUMN audit_remarks TEXT"))

        if "company_particulars" in table_names:
            cp_cols = {col["name"] for col in inspector.get_columns("company_particulars")}
            if "transaction_type" not in cp_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE company_particulars ADD COLUMN transaction_type VARCHAR(20) DEFAULT 'Sales'"))

        if "tenant_leases" in table_names:
            tl_cols = {col["name"] for col in inspector.get_columns("tenant_leases")}
            if "audit_status" not in tl_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE tenant_leases ADD COLUMN audit_status VARCHAR(20) DEFAULT 'Pending Audit'"))
            if "audited_by" not in tl_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE tenant_leases ADD COLUMN audited_by VARCHAR(100)"))
            if "audited_at" not in tl_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE tenant_leases ADD COLUMN audited_at TIMESTAMP WITH TIME ZONE"))
            if "audit_remarks" not in tl_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE tenant_leases ADD COLUMN audit_remarks TEXT"))

        if "tenant_lease_payments" in table_names:
            try:
                with engine.begin() as conn:
                    if engine.dialect.name == "postgresql":
                        conn.execute(text("ALTER TABLE tenant_lease_payments ALTER COLUMN status TYPE VARCHAR(20)"))
            except Exception:
                pass

        if "company" in table_names:
            c_cols = {col["name"] for col in inspector.get_columns("company")}
            if "petty_cash" not in c_cols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE company ADD COLUMN petty_cash NUMERIC(15, 2) DEFAULT 0.00"))

        if "petty_cash_topups" in table_names:
            pct_cols = {col["name"] for col in inspector.get_columns("petty_cash_topups")}
            with engine.begin() as conn:
                if "total_expenses" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN total_expenses NUMERIC(15, 2)"))
                if "company_funded_amount" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN company_funded_amount NUMERIC(15, 2) DEFAULT 0.00"))
                if "employee_out_of_pocket" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN employee_out_of_pocket NUMERIC(15, 2) DEFAULT 0.00"))
                if "reserved_amount" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN reserved_amount NUMERIC(15, 2) DEFAULT 0.00"))
                if "amount_reimbursed" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN amount_reimbursed NUMERIC(15, 2) DEFAULT 0.00"))
                if "existing_expense_id" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN existing_expense_id INTEGER"))
                if "petty_cash_expense_id" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN petty_cash_expense_id INTEGER"))
                if "reimbursement_expense_id" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN reimbursement_expense_id INTEGER"))
                if "payment_method_option" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN payment_method_option VARCHAR(50)"))
                if "destination_bank_id" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN destination_bank_id VARCHAR(100)"))
                if "intercompany_transfer_id" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN intercompany_transfer_id INTEGER"))
                if "reimbursed_at" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN reimbursed_at TIMESTAMP WITH TIME ZONE"))
                if "reimbursed_by" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN reimbursed_by VARCHAR(150)"))
                if "transfer_received_at" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN transfer_received_at TIMESTAMP WITH TIME ZONE"))
                if "transfer_received_by" not in pct_cols:
                    conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN transfer_received_by VARCHAR(150)"))
                try:
                    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_topups_existing_expense_id ON petty_cash_topups(existing_expense_id) WHERE existing_expense_id IS NOT NULL"))
                except Exception:
                    pass

        if "expenses" in table_names:
            exp_cols = {col["name"] for col in inspector.get_columns("expenses")}
            with engine.begin() as conn:
                if "payment_method" not in exp_cols:
                    conn.execute(text("ALTER TABLE expenses ADD COLUMN payment_method VARCHAR(100) NULL"))
                if "remarks" not in exp_cols:
                    conn.execute(text("ALTER TABLE expenses ADD COLUMN remarks TEXT NULL"))
                if "bank_account_id" not in exp_cols:
                    conn.execute(text("ALTER TABLE expenses ADD COLUMN bank_account_id VARCHAR(100) NULL"))
                if "linked_topup_id" not in exp_cols:
                    conn.execute(text("ALTER TABLE expenses ADD COLUMN linked_topup_id INTEGER"))
                try:
                    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_reference_no ON expenses(reference_no) WHERE reference_no IS NOT NULL"))
                except Exception:
                    pass
                try:
                    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_expenses_linked_topup ON expenses(linked_topup_id)"))
                except Exception:
                    pass
    except Exception:
        pass

    # Bank integrity on every start: drop entries whose sale/expense was deleted while nothing was watching,
    # and re-derive every balance from its entries. Both are safe no matter what any record's status is.
    try:
        from app.services.bank_reconcile import repair_bank_integrity

        _repair_db = SessionLocal()
        try:
            repair_bank_integrity(_repair_db)
        finally:
            _repair_db.close()
    except Exception as e:
        logger.warning(f"Bank integrity repair skipped on init: {e}")

    import threading

    def _sync_companies_from_supabase():
        import time
        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                from decimal import Decimal
                from app.db.supabase import get_supabase_admin_client
                client = get_supabase_admin_client()
                if not client:
                    return
                res = client.table("company").select("*").execute()
                supa_companies = res.data if res else None
                if supa_companies:
                    db = SessionLocal()
                    try:
                        for sc in supa_companies:
                            cid = sc.get("company_id")
                            if not cid:
                                continue
                            existing = db.query(Company).filter(Company.company_id == cid).first()
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
                                db.add(Company(
                                    company_id=cid,
                                    company_name=sc.get("company_name"),
                                    location=sc.get("location"),
                                    contact_number=sc.get("contact_number"),
                                    phone=sc.get("phone"),
                                    starting_balance=s_bal,
                                    petty_cash=p_cash,
                                    logo_url=sc.get("logo_url"),
                                ))
                        db.commit()
                    finally:
                        db.close()
                return
            except Exception as e:
                if attempt < max_retries:
                    time.sleep(2 * attempt)
                    continue
                logger.warning(f"Could not sync companies on init: {e}")

    sync_thread = threading.Thread(
        target=_sync_companies_from_supabase,
        name="supabase-company-sync",
        daemon=True,
    )
    sync_thread.start()

# Dependency to get a database session for FastAPI endpoints
def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
