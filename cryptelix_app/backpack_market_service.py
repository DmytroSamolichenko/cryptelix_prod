"""
Public Backpack Exchange perp market data.

REST: https://api.backpack.exchange
No user API keys for market reads.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

BACKPACK_API_BASE = "https://api.backpack.exchange"
REQUEST_TIMEOUT_SEC = 8.0
CACHE_TTL_SEC = 30.0
ORDERBOOK_CACHE_TTL_SEC = 3.0
MARKETS_CACHE_TTL_SEC = 600.0

# Hourly funding on Backpack perps (fundingInterval typically 3_600_000 ms).
BACKPACK_INTERVAL_HOURS = 1.0
BACKPACK_SETTLE_HOURS = 1.0

# Documented VIP0-style defaults when live fee schedule is unavailable.
BACKPACK_DEFAULT_MAKER_BPS = 2.0
BACKPACK_DEFAULT_TAKER_BPS = 5.0
BACKPACK_FEES_AS_OF = "2026-11-05"

_cache_lock = threading.Lock()
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


class BackpackMarketError(Exception):
    """Public Backpack market-data fetch or symbol normalization failure."""


def normalize_backpack_base(raw: object) -> str:
    """Normalize user input to base asset, e.g. SOL from SOL_USDC_PERP."""
    if raw is None:
        raise BackpackMarketError("symbol is required")
    s = str(raw).strip().upper()
    if not s:
        raise BackpackMarketError("symbol is required")
    for ch in ("/", "-", " "):
        s = s.replace(ch, "_")
    if s.endswith("_PERP"):
        s = s[: -len("_PERP")]
    elif s.endswith("PERP"):
        s = s[: -len("PERP")]
    for quote in ("_USDC", "_USDT", "_USD", "USDC", "USDT", "USD", "BUSD"):
        if s.endswith(quote) and len(s) > len(quote):
            s = s[: -len(quote)]
            break
    s = s.replace("_", "")
    if not s.isalnum():
        raise BackpackMarketError(f"Invalid Backpack symbol: {raw!r}")
    return s


def to_backpack_perp_symbol(base: str) -> str:
    return f"{base}_USDC_PERP"


def _http_get_json(path: str, params: dict[str, str] | None = None) -> Any:
    query = urllib.parse.urlencode(params or {})
    url = f"{BACKPACK_API_BASE}{path}"
    if query:
        url = f"{url}?{query}"
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "Cryptelix/1.0"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
            body = resp.read().decode("utf-8")
            if resp.status in (418, 429):
                raise BackpackMarketError(
                    f"Backpack rate limited (HTTP {resp.status}). Try again shortly."
                )
            if resp.status >= 400:
                raise BackpackMarketError(f"Backpack HTTP {resp.status}: {body[:240]}")
            return json.loads(body)
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        if exc.code in (418, 429):
            raise BackpackMarketError(
                f"Backpack rate limited (HTTP {exc.code}). Try again shortly."
            ) from exc
        detail = body[:240] if body else str(exc)
        raise BackpackMarketError(f"Backpack HTTP {exc.code}: {detail}") from exc
    except BackpackMarketError:
        raise
    except Exception as exc:
        raise BackpackMarketError(f"Backpack request failed: {exc}") from exc


def _cache_get(key: str) -> dict[str, Any] | None:
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            out = dict(hit[1])
            out["cached"] = True
            return out
    return None


def _cache_set(key: str, payload: dict[str, Any], *, ttl_sec: float | None = None) -> None:
    ttl = CACHE_TTL_SEC if ttl_sec is None else float(ttl_sec)
    with _cache_lock:
        _cache[key] = (time.monotonic() + ttl, dict(payload))


def _safe_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_book_levels(raw: object) -> list[tuple[float, float]]:
    if not isinstance(raw, list):
        return []
    out: list[tuple[float, float]] = []
    for row in raw:
        if not isinstance(row, (list, tuple)) or len(row) < 2:
            continue
        price = _safe_float(row[0])
        qty = _safe_float(row[1])
        if price is None or qty is None or price <= 0 or qty <= 0:
            continue
        out.append((price, qty))
    return out


def list_perp_markets(*, use_cache: bool = True) -> dict[str, Any]:
    cache_key = "markets|all"
    if use_cache:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    raw = _http_get_json("/api/v1/markets")
    if not isinstance(raw, list):
        raise BackpackMarketError("Unexpected markets payload")

    markets: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        if str(row.get("marketType") or "").upper() != "PERP":
            continue
        if row.get("visible") is False:
            continue
        symbol = str(row.get("symbol") or "")
        base = str(row.get("baseSymbol") or normalize_backpack_base(symbol))
        quote = str(row.get("quoteSymbol") or "USDC")
        markets.append(
            {
                "symbol": base,
                "venue_symbol": symbol,
                "base": base,
                "quote": quote,
                "listed": True,
            }
        )

    result = {
        "venue": "backpack",
        "markets": markets,
        "count": len(markets),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
        "source": "backpack_perp_public",
    }
    if use_cache:
        _cache_set(cache_key, result, ttl_sec=MARKETS_CACHE_TTL_SEC)
    return result


def get_orderbook_snapshot(symbol_raw: object, *, use_cache: bool = True) -> dict[str, Any]:
    base = normalize_backpack_base(symbol_raw)
    venue_symbol = to_backpack_perp_symbol(base)
    cache_key = f"orderbook|{venue_symbol}"
    if use_cache:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    raw = _http_get_json(
        "/api/v1/depth",
        {"symbol": venue_symbol, "limit": "100"},
    )
    bids = _parse_book_levels(raw.get("bids"))
    asks = _parse_book_levels(raw.get("asks"))
    bids.sort(key=lambda x: x[0], reverse=True)
    asks.sort(key=lambda x: x[0])
    mid = None
    if bids and asks:
        mid = (bids[0][0] + asks[0][0]) / 2.0

    result = {
        "venue": "backpack",
        "symbol": base,
        "venue_symbol": venue_symbol,
        "bids": [{"price": p, "quantity": q} for p, q in bids],
        "asks": [{"price": p, "quantity": q} for p, q in asks],
        "mid": mid,
        "slot": raw.get("lastUpdateId"),
        "bid_levels": len(bids),
        "ask_levels": len(asks),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
        "source": "backpack_perp_public",
    }
    if use_cache:
        _cache_set(cache_key, result, ttl_sec=ORDERBOOK_CACHE_TTL_SEC)
    return result


def get_funding_snapshot(symbol_raw: object, *, use_cache: bool = True) -> dict[str, Any]:
    """
    Normalized funding snapshot.

    Backpack `fundingRate` is a fraction per funding interval (typically 1h).
    """
    base = normalize_backpack_base(symbol_raw)
    venue_symbol = to_backpack_perp_symbol(base)
    cache_key = f"funding|{venue_symbol}"
    if use_cache:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    marks = _http_get_json("/api/v1/markPrices", {"symbol": venue_symbol})
    if not isinstance(marks, list) or not marks:
        raise BackpackMarketError(f"No mark/funding for {venue_symbol}")
    row = marks[0] if isinstance(marks[0], dict) else {}
    rate_fraction = _safe_float(row.get("fundingRate"))
    if rate_fraction is None:
        raise BackpackMarketError(f"Invalid funding rate for {venue_symbol}")

    interval_hours = BACKPACK_INTERVAL_HOURS
    rate_24h = rate_fraction * (24.0 / interval_hours)
    rate_pct = rate_fraction * 100.0
    rate_24h_pct = rate_24h * 100.0

    next_funding_at = None
    nft = row.get("nextFundingTimestamp")
    if nft is not None:
        try:
            # Backpack timestamps appear as ms.
            ts = int(nft)
            if ts > 10_000_000_000:
                ts = ts // 1000
            next_funding_at = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        except (TypeError, ValueError, OSError):
            next_funding_at = str(nft)

    result = {
        "venue": "backpack",
        "symbol": base,
        "venue_symbol": venue_symbol,
        "funding_rate": rate_fraction,
        "funding_rate_percent": rate_pct,
        "interval_hours": interval_hours,
        "settle_hours": BACKPACK_SETTLE_HOURS,
        "rate_per_24h_percent": rate_24h_pct,
        "rate_per_24h": rate_24h,
        "next_funding_at": next_funding_at,
        "rate_as_of": datetime.now(timezone.utc).isoformat(),
        "settle_model": "Hourly funding interval",
        "mark_price": _safe_float(row.get("markPrice")),
        "index_price": _safe_float(row.get("indexPrice")),
        "samples_in_24h_window": 1,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
        "source": "backpack_perp_public",
    }
    if use_cache:
        _cache_set(cache_key, result)
    return result


def get_fee_schedule(*, use_cache: bool = True) -> dict[str, Any]:
    cache_key = "fees|default"
    if use_cache:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    result = {
        "venue": "backpack",
        "maker_bps": BACKPACK_DEFAULT_MAKER_BPS,
        "taker_bps": BACKPACK_DEFAULT_TAKER_BPS,
        "tier": "default",
        "as_of": BACKPACK_FEES_AS_OF,
        "source": "config",
        "note": "Static VIP0-style defaults; live fee tiers not exposed on public market API.",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
    }
    if use_cache:
        _cache_set(cache_key, result, ttl_sec=MARKETS_CACHE_TTL_SEC)
    return result
