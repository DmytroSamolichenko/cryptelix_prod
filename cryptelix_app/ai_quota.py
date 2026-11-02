"""Per-user daily caps for paid AI calls.

Counters live in Redis when REDIS_URL is set (shared across Railway instances)
and in process memory otherwise. The key is the UTC date, so the cap resets
at midnight UTC. A Redis error fails open: AI stays available, matching the
other rate limits.

One count is one user action (one analysis, or one chat message), taken
before the OpenAI call. Tool rounds inside a single chat message are not
counted again.
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("cryptelix")

ANALYZE_BUCKET = "analyze"
CHAT_BUCKET = "chat"

_KEY_TTL_SEC = 36 * 60 * 60
_memory: dict[str, int] = {}
_memory_lock = threading.Lock()
_redis_client: Any = None
_redis_failed = False


class AiQuotaExceeded(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def _limit(env_name: str, default: int) -> int:
    raw = (os.getenv(env_name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def analyze_daily_limit() -> int:
    return _limit("AI_ANALYZE_DAILY_LIMIT", 10)


def chat_daily_limit() -> int:
    return _limit("AI_CHAT_DAILY_LIMIT", 30)


def _redis() -> Any:
    """Shared client, or None when Redis is unset or unreachable."""
    global _redis_client, _redis_failed
    if _redis_failed:
        return None
    if _redis_client is not None:
        return _redis_client
    url = (os.getenv("REDIS_URL") or "").strip()
    if not url:
        return None
    try:
        import redis as redis_lib

        client = redis_lib.from_url(url, decode_responses=True)
        client.ping()
        _redis_client = client
        return client
    except Exception:
        logger.warning("AI quota Redis unavailable; failing open")
        _redis_failed = True
        return None


def _day_key(user_id: int, bucket: str) -> str:
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"ai_quota:{bucket}:{user_id}:{day}"


def _incr(key: str) -> int | None:
    """Return the new count, or None to fail open."""
    client = _redis()
    if client is not None:
        try:
            count = int(client.incr(key))
            if count == 1 or int(client.ttl(key)) < 0:
                client.expire(key, _KEY_TTL_SEC)
            return count
        except Exception:
            logger.warning("AI quota increment failed; failing open")
            return None
    with _memory_lock:
        count = _memory.get(key, 0) + 1
        _memory[key] = count
        return count


def reserve(user_id: int, bucket: str, limit: int, detail: str) -> None:
    count = _incr(_day_key(user_id, bucket))
    if count is None:
        return
    if count > limit:
        raise AiQuotaExceeded(detail)


def reserve_analyze(user_id: int) -> None:
    limit = analyze_daily_limit()
    reserve(
        user_id,
        ANALYZE_BUCKET,
        limit,
        f"Daily analysis limit reached ({limit}). It resets tomorrow.",
    )


def reserve_chat(user_id: int) -> None:
    limit = chat_daily_limit()
    reserve(
        user_id,
        CHAT_BUCKET,
        limit,
        f"Daily chat limit reached ({limit}). It resets tomorrow.",
    )
