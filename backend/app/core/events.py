"""
events.py
---------
Lightweight, thread-safe Event Bus and domain event definitions
for asynchronous and decoupled activity logging and system notifications.
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class ActivityEvent:
    """
    Domain event representing an auditable action across the system.
    """
    action: str
    action_category: Optional[str] = None
    user_id: Optional[int] = None
    company_id: Optional[int] = None
    ip_address: Optional[str] = None
    details: Optional[Any] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "action": self.action,
            "action_category": self.action_category,
            "user_id": self.user_id,
            "company_id": self.company_id,
            "ip_address": self.ip_address,
            "details": self.details,
            "created_at": self.created_at.isoformat(),
        }


class EventBus:
    """
    Central publish-subscribe event dispatcher.
    Executes subscriber handlers in background worker threads so
    incoming HTTP requests and database transactions are never blocked.
    """
    def __init__(self, max_workers: int = 4) -> None:
        self._subscribers: List[Callable[[ActivityEvent], None]] = []
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="event-bus")
        self._lock = threading.Lock()

    def subscribe(self, handler: Callable[[ActivityEvent], None]) -> None:
        """Register an event listener."""
        with self._lock:
            if handler not in self._subscribers:
                self._subscribers.append(handler)

    def unsubscribe(self, handler: Callable[[ActivityEvent], None]) -> None:
        """Unregister an event listener."""
        with self._lock:
            if handler in self._subscribers:
                self._subscribers.remove(handler)

    def dispatch(self, event: ActivityEvent, sync: bool = False) -> None:
        """
        Dispatch an event to all registered listeners.
        By default, runs asynchronously via ThreadPoolExecutor.
        """
        with self._lock:
            handlers = list(self._subscribers)

        for handler in handlers:
            if sync:
                try:
                    handler(event)
                except Exception as exc:
                    logger.exception("Error in sync event handler %s: %s", handler, exc)
            else:
                self._executor.submit(self._safe_execute, handler, event)

    @staticmethod
    def _safe_execute(handler: Callable[[ActivityEvent], None], event: ActivityEvent) -> None:
        try:
            handler(event)
        except Exception as exc:
            logger.exception("Error in async event handler %s: %s", handler, exc)


# Singleton EventBus instance
event_bus = EventBus()


# ---------------------------------------------------------------------------
# Default Subscribers
# ---------------------------------------------------------------------------

def _activity_log_subscriber(event: ActivityEvent) -> None:
    """
    Subscriber that persists the activity event to Supabase audit_logs
    via ActivityLogService.
    """
    try:
        from app.services.activity_log_service import activity_log_service
        activity_log_service.record_activity(event)
    except Exception as exc:
        logger.warning("Failed to record activity log in subscriber: %s", exc)


def _websocket_broadcast_subscriber(event: ActivityEvent) -> None:
    """
    Subscriber that broadcasts new activity log notifications to connected
    administrators and clients over WebSockets.
    """
    try:
        from app.core.websocket import ws_manager
        ws_manager.broadcast_sync({
            "type": "ACTIVITY_LOG_CREATED",
            "data": {
                "action": event.action,
                "action_category": event.action_category,
                "user_id": event.user_id,
                "company_id": event.company_id,
                "created_at": event.created_at.isoformat(),
            }
        })
    except Exception as exc:
        logger.warning("Failed to broadcast activity log over websocket: %s", exc)


def _cache_invalidation_subscriber(event: ActivityEvent) -> None:
    """
    Subscriber that clears cached notification/audit payloads when
    relevant transactional events are received.
    """
    try:
        from app.core.cache import system_cache
        cat = (event.action_category or "").upper()
        if cat in ("TRANSACTION", "LOAN", "PETTY_CASH", "TENANT", "USER", "COMPANY"):
            system_cache.invalidate_tag("notifications")
    except Exception as exc:
        logger.warning("Failed to invalidate cache in subscriber: %s", exc)


# Register default subscribers
event_bus.subscribe(_activity_log_subscriber)
event_bus.subscribe(_websocket_broadcast_subscriber)
event_bus.subscribe(_cache_invalidation_subscriber)


def dispatch_activity_event(
    action: str,
    *,
    action_category: Optional[str] = None,
    user_id: Optional[int] = None,
    company_id: Optional[int] = None,
    ip_address: Optional[str] = None,
    details: Optional[Any] = None,
    sync: bool = False,
) -> ActivityEvent:
    """
    Convenience helper to construct and dispatch an ActivityEvent.
    """
    event = ActivityEvent(
        action=action,
        action_category=action_category,
        user_id=user_id,
        company_id=company_id,
        ip_address=ip_address,
        details=details,
    )
    event_bus.dispatch(event, sync=sync)
    return event

