"""Disk cache for external API responses (FIRMS, Open-Meteo), shared by every user of this server.

`ttl=None` keeps an entry forever (the past doesn't change). One lock per key, so concurrent identical requests make a
single upstream call. Failures raise and are never cached. Keys hash the request parameters, never the API keys.
"""

import hashlib
import json
import threading
import time
from collections.abc import Callable
from typing import Any

from .config import CACHE_DIR

ROOT = CACHE_DIR / "api"
MINUTE, HOUR = 60, 3600

_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


def _lock(key: str) -> threading.Lock:
    with _guard:
        return _locks.setdefault(key, threading.Lock())


def cached(namespace: str, params: dict, ttl: float | None, fetch: Callable[[], Any]) -> Any:
    """`fetch()`'s JSON-serializable result for `params`, from disk when younger than `ttl` seconds."""
    key = hashlib.sha256(json.dumps(params, sort_keys=True, default=str).encode()).hexdigest()[:32]
    path = ROOT / namespace / f"{key}.json"
    with _lock(f"{namespace}/{key}"):
        if path.exists() and (ttl is None or time.time() - path.stat().st_mtime < ttl):
            return json.loads(path.read_text())
        value = fetch()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(value))
        tmp.replace(path)
        return value
