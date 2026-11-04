from __future__ import annotations
import time
import threading
from typing import Any, Optional

class CacheItem:
    __slots__ = ("value", "expires_at", "tags")
    def __init__(self, value: Any, expires_at: float, tags: set[str]) -> None:
        self.value = value
        self.expires_at = expires_at
        self.tags = tags

class FastMemoryCache:
    """Thread-safe in-memory cache with TTL and tag-based invalidation."""
    def __init__(self) -> None:
        self._store: dict[str, CacheItem] = {}
        self._tags: dict[str, set[str]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        now = time.time()
        with self._lock:
            item = self._store.get(key)
            if item is None:
                return None
            if item.expires_at <= now:
                self._delete_key(key)
                return None
            return item.value

    def set(self, key: str, value: Any, ttl: int = 45, tags: Optional[list[str]] = None) -> None:
        expires_at = time.time() + ttl
        tag_set = set(tags or [])
        with self._lock:
            # Clean old tags if key already existed
            if key in self._store:
                self._delete_key(key)

            self._store[key] = CacheItem(value, expires_at, tag_set)
            for tag in tag_set:
                self._tags.setdefault(tag, set()).add(key)

    def invalidate_tag(self, tag: str) -> None:
        """Evicts all keys associated with the given tag."""
        with self._lock:
            keys = self._tags.pop(tag, set())
            for key in keys:
                self._store.pop(key, None)

    def invalidate_all(self) -> None:
        with self._lock:
            self._store.clear()
            self._tags.clear()

    def clear(self) -> None:
        """Alias for invalidate_all to support test suite fixtures and cache flushes."""
        self.invalidate_all()

    def _delete_key(self, key: str) -> None:
        item = self._store.pop(key, None)
        if item:
            for tag in item.tags:
                tag_keys = self._tags.get(tag)
                if tag_keys:
                    tag_keys.discard(key)
                    if not tag_keys:
                        self._tags.pop(tag, None)


system_cache = FastMemoryCache()

def get_cached(key: str) -> Optional[Any]:
    return system_cache.get(key)

def set_cached(key: str, value: Any, ttl_seconds: int = 45, tags: Optional[list[str]] = None) -> None:
    system_cache.set(key, value, ttl=ttl_seconds, tags=tags)

def invalidate_cached_tag(tag: str) -> None:
    system_cache.invalidate_tag(tag)
