import logging
import random
import threading
import time
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


def calculate_full_jitter_backoff(
    retry_count: int,
    base: float = 2.0,
    max_backoff: float = 300.0,
    base_delay: Optional[float] = None,
    max_delay: Optional[float] = None,
) -> float:
    """
    Standard AWS Full Jitter algorithm:
    Sleep = random(0, min(max_backoff, base * 2^attempt))
    """
    b = base_delay if base_delay is not None else base
    m = max_delay if max_delay is not None else max_backoff
    attempt = max(0, retry_count)
    temp = min(m, b * (2 ** attempt))
    return random.uniform(0.0, temp)


class CircuitBreakerState(str, Enum):
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


class CircuitBreaker:
    """
    Thread-safe process-local circuit breaker.
    Trips to OPEN after consecutive failures exceed threshold.
    Remains OPEN for recovery_timeout before attempting a single HALF_OPEN probe.
    """

    def __init__(
        self,
        name: str = "ResendAPI",
        failure_threshold: int = 5,
        recovery_timeout: float = 60.0,
        recovery_timeout_seconds: Optional[float] = None,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout_seconds if recovery_timeout_seconds is not None else recovery_timeout

        self._state = CircuitBreakerState.CLOSED
        self._failure_count = 0
        self._last_state_change = time.time()
        self._lock = threading.Lock()

    @property
    def consecutive_failures(self) -> int:
        return self._failure_count

    @property
    def state(self) -> CircuitBreakerState:
        with self._lock:
            self._evaluate_state()
            return self._state

    def can_execute(self) -> bool:
        with self._lock:
            self._evaluate_state()
            return self._state in (CircuitBreakerState.CLOSED, CircuitBreakerState.HALF_OPEN)

    def record_success(self) -> None:
        with self._lock:
            if self._state == CircuitBreakerState.HALF_OPEN:
                logger.info("CircuitBreaker [%s]: Probe succeeded. Resetting to CLOSED.", self.name)
            self._state = CircuitBreakerState.CLOSED
            self._failure_count = 0
            self._last_state_change = time.time()

    def record_failure(self) -> None:
        with self._lock:
            self._failure_count += 1
            logger.warning(
                "CircuitBreaker [%s]: Failure recorded (count=%d/%d).",
                self.name,
                self._failure_count,
                self.failure_threshold,
            )
            if self._failure_count >= self.failure_threshold or self._state == CircuitBreakerState.HALF_OPEN:
                self._state = CircuitBreakerState.OPEN
                self._last_state_change = time.time()
                logger.error(
                    "CircuitBreaker [%s]: Tripped to OPEN for %.1f seconds.",
                    self.name,
                    self.recovery_timeout,
                )

    def _evaluate_state(self) -> None:
        if self._state == CircuitBreakerState.OPEN:
            elapsed = time.time() - self._last_state_change
            if elapsed >= self.recovery_timeout:
                self._state = CircuitBreakerState.HALF_OPEN
                self._last_state_change = time.time()
                logger.info(
                    "CircuitBreaker [%s]: Recovery timeout elapsed. Transitioned to HALF_OPEN probe.",
                    self.name,
                )


# Shared process-local circuit breaker for Resend API
resend_circuit_breaker = CircuitBreaker(
    name="ResendEmailDelivery",
    failure_threshold=5,
    recovery_timeout=60.0,
)
