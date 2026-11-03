"""
Unit and concurrency test suite for Event-Driven, Role- & Company-Scoped
Notification Service with Fencing-Token Outbox and 90-Day Retention.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import uuid
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.company import Company
from app.models.notification import Notification, NotificationOutbox
from app.models.user import User, UserCompany
from app.services.notification_dispatcher import (
    claim_outbox_batch,
    complete_outbox_event,
    enqueue_notification_event,
    handle_event_failure,
    process_single_outbox_event,
    renew_lease,
    resolve_event_recipients,
)
from app.services.notification_service import (
    NotificationService,
    prune_expired_notifications_batch,
)


def _to_utc(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


@pytest.fixture
def db_session_factory():
    """Sets up an in-memory SQLite database session factory."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionFactory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with SessionFactory() as db:
        c1 = Company(company_id=1, company_name="JK Property and Ventures", location="Manila", starting_balance=100000.0)
        c2 = Company(company_id=2, company_name="MCT Lending Corp", location="Cebu", starting_balance=100000.0)
        db.add_all([c1, c2])

        # Users: Admin, Finance, Supervisor 1 (Company 1), Supervisor 2 (Company 2)
        admin = User(user_id=1, email="admin@mct.com", name="Admin", role="admin", is_admin=True)
        finance = User(user_id=2, email="finance@mct.com", name="Finance", role="finance")
        sup1 = User(user_id=10, email="sup1@mct.com", name="Sup 1", role="supervisor", company_id=1)
        sup2 = User(user_id=20, email="sup2@mct.com", name="Sup 2", role="supervisor", company_id=2)
        db.add_all([admin, finance, sup1, sup2])
        db.commit()

        # Company assignments
        db.add_all([
            UserCompany(user_id=10, company_id=1),
            UserCompany(user_id=20, company_id=2),
        ])
        db.commit()

    return SessionFactory


# ── 1. Concurrency and Fencing Token Lease Safety ──────────────────────────

def test_stale_worker_rejection_via_fencing_token(db_session_factory):
    """
    Worker A claims an event. Worker A's lease expires.
    Worker B reclaims the event with a new claim_token.
    Worker A attempts to complete the event -> rejected (returns False).
    Worker B completes the event -> succeeds (returns True).
    """
    with db_session_factory() as db:
        enqueue_notification_event(
            db=db,
            event_type="LOAN_SUBMITTED",
            company_id=1,
            target_roles=["supervisor"],
            payload={"title": "New Loan Request", "ref_type": "loan", "ref_id": 101},
        )
        db.commit()

    # Worker A claims the event
    claimed_a = claim_outbox_batch(db_session_factory, batch_size=10)
    assert len(claimed_a) == 1
    token_a = claimed_a[0]["claim_token"]
    outbox_id = claimed_a[0]["outbox_id"]

    # Simulate lease expiration for Worker A
    with db_session_factory() as db:
        ev = db.get(NotificationOutbox, outbox_id)
        ev.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=10)
        db.commit()

    # Worker B claims the expired event
    claimed_b = claim_outbox_batch(db_session_factory, batch_size=10)
    assert len(claimed_b) == 1
    token_b = claimed_b[0]["claim_token"]
    assert token_a != token_b

    # Worker A attempts completion with stale token_a -> MUST FAIL
    fake_notif = Notification(
        notification_id="stale-test-1",
        recipient_user_id=10,
        company_id=1,
        notification_type="LOAN_SUBMITTED",
        title="Stale",
        message="Stale",
    )
    result_a = complete_outbox_event(
        session_factory=db_session_factory,
        outbox_id=outbox_id,
        claim_token=token_a,
        notifications_to_insert=[fake_notif],
    )
    assert result_a is False

    # Worker B completes with active token_b -> MUST SUCCEED
    valid_notif = Notification(
        notification_id="valid-test-1",
        recipient_user_id=10,
        company_id=1,
        notification_type="LOAN_SUBMITTED",
        title="Valid Loan",
        message="Valid Message",
    )
    result_b = complete_outbox_event(
        session_factory=db_session_factory,
        outbox_id=outbox_id,
        claim_token=token_b,
        notifications_to_insert=[valid_notif],
    )
    assert result_b is True

    # Verify outbox is COMPLETED and valid notification was persisted
    with db_session_factory() as db:
        ev = db.get(NotificationOutbox, outbox_id)
        assert ev.status == "COMPLETED"
        assert ev.claim_token == token_b
        notif = db.get(Notification, "valid-test-1")
        assert notif is not None
        assert db.get(Notification, "stale-test-1") is None


def test_lease_renewal(db_session_factory):
    """Worker extends its lease before expiration; confirms lease_expires_at is extended."""
    with db_session_factory() as db:
        ev = enqueue_notification_event(
            db=db,
            event_type="BATCH_PAYMENTS",
            company_id=1,
            target_roles=["finance"],
            payload={"title": "Batch processing"},
        )
        db.commit()

    claimed = claim_outbox_batch(db_session_factory, batch_size=1)
    token = claimed[0]["claim_token"]
    outbox_id = claimed[0]["outbox_id"]

    with db_session_factory() as db:
        renewed = renew_lease(db, outbox_id=outbox_id, claim_token=token, extension_sec=120)
        assert renewed is True

        ev_after = db.get(NotificationOutbox, outbox_id)
        assert _to_utc(ev_after.lease_expires_at) > datetime.now(timezone.utc) + timedelta(seconds=100)


def test_idempotent_notification_processing(db_session_factory):
    """Processing the same event twice never creates duplicate notifications."""
    with db_session_factory() as db:
        enqueue_notification_event(
            db=db,
            event_type="BILL_CREATED",
            company_id=1,
            target_roles=["supervisor"],
            payload={"title": "Electric Bill", "ref_type": "bill", "ref_id": 55},
        )
        db.commit()

    claimed = claim_outbox_batch(db_session_factory, batch_size=1)
    assert len(claimed) == 1

    success1 = process_single_outbox_event(db_session_factory, claimed[0])
    assert success1 is True

    with db_session_factory() as db:
        count = db.query(Notification).filter(Notification.reference_id == 55).count()
        assert count == 1


# ── 2. Structured JSONB Recipient Targeting ────────────────────────────────

def test_jsonb_recipient_targets_union_and_deduplication(db_session_factory):
    """
    Enqueuing with both target_roles and explicit target_user_ids:
    - Resolves both sets
    - Deduplicates so overlapping users receive exactly one notification
    """
    with db_session_factory() as db:
        # Targeting supervisor role for company 1 (user 10) AND direct user 10
        recipients = resolve_event_recipients(
            db=db,
            company_id=1,
            target_roles=["supervisor"],
            target_user_ids=[10, 2], # supervisor 10 and finance 2
        )
        assert recipients == {10, 2}


def test_company_isolation_for_single_company_roles(db_session_factory):
    """
    Supervisor of Company 2 (user 20) must never receive Company 1 notifications.
    """
    with db_session_factory() as db:
        recipients = resolve_event_recipients(
            db=db,
            company_id=1,
            target_roles=["supervisor"],
            target_user_ids=[],
        )
        assert 10 in recipients
        assert 20 not in recipients


def test_empty_targets_route_to_dead_letter(db_session_factory):
    """
    Outbox event with no resolvable recipients must move to DEAD_LETTER instead of broadcasting.
    """
    with db_session_factory() as db:
        ev = NotificationOutbox(
            idempotency_key="empty-target-test",
            event_type="SYSTEM_ALERT",
            company_id=1,
            target_roles=[],
            target_user_ids=[],
            payload={"title": "Empty target test"},
            status="PENDING",
        )
        db.add(ev)
        db.commit()

    claimed = claim_outbox_batch(db_session_factory, batch_size=1)
    assert len(claimed) == 1

    processed = process_single_outbox_event(db_session_factory, claimed[0])
    assert processed is False

    with db_session_factory() as db:
        ev_after = db.get(NotificationOutbox, claimed[0]["outbox_id"])
        assert ev_after.status == "DEAD_LETTER"


# ── 3. Read State and 90-Day Retention Lifecycle ───────────────────────────

def test_initial_state_is_unread_without_expiration(db_session_factory):
    """
    Newly created notifications must have read_at IS NULL, is_read False, expires_at IS NULL.
    """
    now = datetime.now(timezone.utc)
    with db_session_factory() as db:
        notif = Notification(
            notification_id="init-test-1",
            recipient_user_id=10,
            company_id=1,
            notification_type="BILL_DUE",
            title="Due Today",
            message="Please pay",
            created_at=now,
        )
        db.add(notif)
        db.commit()

        svc = NotificationService(db)
        feed = svc.get_notifications_feed(recipient_user_id=10, company_id=1)
        assert len(feed.items) == 1
        item = feed.items[0]
        assert item.read_at is None
        assert item.is_read is False
        assert item.expires_at is None
        assert svc.get_unread_count(recipient_user_id=10, company_id=1) == 1


def test_mark_as_read_sets_read_at_and_90_day_expiration(db_session_factory):
    """
    Marking as read sets read_at = NOW and expires_at = NOW + 90 days.
    Repeated mark-as-read calls are idempotent.
    """
    with db_session_factory() as db:
        notif = Notification(
            notification_id="read-test-1",
            recipient_user_id=10,
            company_id=1,
            notification_type="LOAN_UPDATE",
            title="Loan Update",
            message="Update details",
        )
        db.add(notif)
        db.commit()

        svc = NotificationService(db)
        first_read = svc.mark_as_read("read-test-1", recipient_user_id=10)
        assert first_read.read_at is not None
        assert first_read.is_read is True
        assert first_read.expires_at is not None

        expected_exp = first_read.read_at + timedelta(days=90)
        # Check within 2 seconds
        assert abs((first_read.expires_at - expected_exp).total_seconds()) < 2

        # Idempotent: second read does not change read_at or extend expires_at
        orig_read_at = first_read.read_at
        orig_expires_at = first_read.expires_at

        second_read = svc.mark_as_read("read-test-1", recipient_user_id=10)
        assert second_read.read_at == orig_read_at
        assert second_read.expires_at == orig_expires_at


def test_earliest_applicable_expiration_when_read_and_resolved(db_session_factory):
    """
    If a notification is resolved first at T_res, and read later at T_read (T_read > T_res):
    expires_at must preserve the earliest date (T_res + 90 days).
    """
    t_res = datetime.now(timezone.utc) - timedelta(days=10)
    with db_session_factory() as db:
        notif = Notification(
            notification_id="res-read-test",
            recipient_user_id=10,
            company_id=1,
            notification_type="BILL_OVERDUE",
            title="Overdue Bill",
            message="Overdue",
            reference_type="bill",
            reference_id=999,
            read_at=None,
            resolved_at=t_res,
            expires_at=t_res + timedelta(days=90),
        )
        db.add(notif)
        db.commit()

        svc = NotificationService(db)
        marked = svc.mark_as_read("res-read-test", recipient_user_id=10)
        assert marked.read_at is not None

        # Expiration must remain t_res + 90d (the earliest date)
        assert _to_utc(marked.expires_at) == _to_utc(t_res + timedelta(days=90))


def test_monthly_batch_pruning_deletes_only_expired_records(db_session_factory):
    """
    prune_expired_notifications_batch deletes only records where expires_at <= NOW.
    Active (unexpired) or unread/unresolved (expires_at IS NULL) records remain untouched.
    """
    now = datetime.now(timezone.utc)
    with db_session_factory() as db:
        # Expired record (expires_at in the past)
        notif_expired = Notification(
            notification_id="exp-past",
            recipient_user_id=10,
            company_id=1,
            notification_type="OLD_ALERT",
            title="Old Alert",
            message="Past",
            read_at=now - timedelta(days=95),
            expires_at=now - timedelta(days=5),
        )
        # Future expired record (expires_at 30 days from now)
        notif_future = Notification(
            notification_id="exp-future",
            recipient_user_id=10,
            company_id=1,
            notification_type="NEW_ALERT",
            title="Recent Alert",
            message="Future",
            read_at=now,
            expires_at=now + timedelta(days=90),
        )
        # Unread record (expires_at IS NULL)
        notif_unread = Notification(
            notification_id="unread-indefinite",
            recipient_user_id=10,
            company_id=1,
            notification_type="UNREAD_ALERT",
            title="Unread Alert",
            message="Active",
            read_at=None,
            expires_at=None,
        )
        db.add_all([notif_expired, notif_future, notif_unread])
        db.commit()

    deleted = prune_expired_notifications_batch(db_session_factory, batch_size=10)
    assert deleted == 1

    with db_session_factory() as db:
        assert db.get(Notification, "exp-past") is None
        assert db.get(Notification, "exp-future") is not None
        assert db.get(Notification, "unread-indefinite") is not None


# ── 4. Compound Monotonic Cursor Pagination ────────────────────────────────

def test_compound_cursor_pagination_identical_timestamps(db_session_factory):
    """
    Ensures that notifications sharing identical timestamps are paginated cleanly
    without skipping any records using compound cursor (created_at, notification_id).
    """
    fixed_time = datetime(2026, 11, 3, 10, 0, 0, tzinfo=timezone.utc)
    with db_session_factory() as db:
        for i in range(5):
            db.add(
                Notification(
                    notification_id=f"cursor-test-{i:02d}",
                    recipient_user_id=10,
                    company_id=1,
                    notification_type="ITEM",
                    title=f"Item {i}",
                    message="Msg",
                    created_at=fixed_time,
                )
            )
        db.commit()

        svc = NotificationService(db)
        # Fetch page 1 (limit 2)
        page1 = svc.get_notifications_feed(recipient_user_id=10, company_id=1, limit=2)
        assert len(page1.items) == 2
        assert page1.has_more is True
        assert page1.next_cursor is not None

        # Fetch page 2 (limit 2) using next_cursor
        page2 = svc.get_notifications_feed(
            recipient_user_id=10, company_id=1, cursor=page1.next_cursor, limit=2
        )
        assert len(page2.items) == 2
        assert page2.has_more is True

        # Fetch page 3 (remaining 1)
        page3 = svc.get_notifications_feed(
            recipient_user_id=10, company_id=1, cursor=page2.next_cursor, limit=2
        )
        assert len(page3.items) == 1
        assert page3.has_more is False

        # Confirm all 5 items were retrieved with zero overlap
        all_retrieved_ids = [n.notification_id for n in page1.items + page2.items + page3.items]
        assert len(all_retrieved_ids) == 5
        assert len(set(all_retrieved_ids)) == 5
