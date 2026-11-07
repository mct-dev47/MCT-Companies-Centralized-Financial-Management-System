from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.core.config import settings
from typing import Generator
from urllib.parse import urlsplit, urlunsplit
import logging
import os

logger = logging.getLogger(__name__)

Base = declarative_base()

# Database connection setup
db_url = settings.DATABASE_URL
engine = None

if db_url and db_url.strip() and not db_url.startswith("sqlite"):
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
        # Use a real client-side connection pool instead of NullPool.
        # Opening a connection to the remote Supabase pooler costs ~1-3s
        # (TCP + TLS + auth), so NullPool (a fresh connection per operation)
        # made every request pay that cost several times over, stacking up to
        # ~20s per API call. Reusing pooled connections keeps the query itself
        # (~0.3s) as the dominant cost. psycopg2 does not use server-side
        # prepared statements by default, so it is compatible with Supabase's
        # transaction-mode pooler (port 6543). pool_pre_ping discards stale
        # connections the pooler may have dropped; pool_recycle caps lifetime.
        engine = create_engine(
            db_url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
            pool_recycle=1800,
            pool_timeout=30,
            connect_args={"connect_timeout": 5},
        )
        with engine.connect() as _probe:
            pass
    except Exception as e:
        engine = None
        logger.warning(f"Failed to initialize database engine with {db_url}: {e}. Falling back to SQLite.")

if engine is None:
    db_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "mct_financial.db")
    engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    import app.models.company
    import app.models.finance
    import app.models.user
    import app.models.audit_log
    import app.models.loan
    import app.models.staff_credit
    import app.models.bills
    import app.models.petty_cash
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
    except Exception:
        pass

    import threading

    def _sync_companies_from_supabase():
        try:
            db = SessionLocal()
            try:
                if db.query(Company).count() == 0:
                    from app.db.supabase import get_supabase_admin_client
                    client = get_supabase_admin_client()
                    supa_companies = client.table("company").select("*").execute().data
                    if supa_companies:
                        for sc in supa_companies:
                            db.add(Company(
                                company_id=sc.get("company_id"),
                                company_name=sc.get("company_name"),
                                location=sc.get("location"),
                                contact_person=sc.get("contact_person"),
                                contact_number=sc.get("contact_number"),
                                phone=sc.get("phone"),
                                email=sc.get("email"),
                                starting_balance=sc.get("starting_balance", 0.0),
                                current_balance=sc.get("current_balance", 0.0),
                                logo_url=sc.get("logo_url"),
                            ))
                        db.commit()
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"Could not sync companies on init: {e}")

    sync_thread = threading.Thread(
        target=_sync_companies_from_supabase,
        name="supabase-company-sync",
        daemon=True,
    )
    sync_thread.start()
    sync_thread.join(timeout=10)
    if sync_thread.is_alive():
        logger.warning(
            "Supabase company sync did not finish within 10s; continuing startup "
            "without it. Companies will sync on a later run or via the API."
        )

# Dependency to get a database session for FastAPI endpoints
def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
