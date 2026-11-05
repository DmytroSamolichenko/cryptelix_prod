"""
Public Pacifica perp market data.

REST: https://api.pacifica.fi/api/v1
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

PACIFICA_API_BASE = "https://api.pacifica.fi/api/v1"
REQUEST_TIMEOUT_SEC = 8.0
CACHE_TTL_SEC = 30.0
ORDERBOOK_CACHE_TTL_SEC = 3.0
MARKETS_CACHE_TTL_SEC = 600.0

# Pacifica docs: funding updates hourly.
PACIFICA_INTERVAL_HOURS = 1.0
PACIFICA_SETTLE_HOURS = 1.0

_cache_lock = threading.Lock()
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


class PacificaMarketError(Exception):
    """Public Pacifica market-data fetch or symbol normalization failure."""


def normalize_pacifica_symbol(raw: object) -> str:
    """Normalize to Pacifica market symbol, e.g. BTC, SOL."""
    if raw is None:
        raise PacificaMarketError("symbol is required")
    s = str(raw).strip().upper()
    if not s:
        raise PacificaMarketError("symbol is required")
    for ch in ("/", "-", "_", " "):
        s = s.replace(ch, "")
    if s.endswith("PERP"):
        s = s[: -len("PERP")]
    for quote in ("USDT", "USDC", "USD", "BUSD"):
        if s.endswith(quote) and len(s) > len(quote):
            s = s[: -len(quote)]
            break
    if not s.isalnum():
        raise PacificaMarketError(f"Invalid Pacifica symbol: {raw!r}")
    return s


def _http_get_json(path: str, params: dict[str, str] | None = None) -> Any:
    query = urllib.parse.urlencode(params or {})
    url = f"{PACIFICA_API_BASE}{path}"
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
                raise PacificaMarketError(
                    f"Pacifica rate limited (HTTP {resp.status}). Try again shortly."
                )
            if resp.status >= 400:
                raise PacificaMarketError(f"Pacifica HTTP {resp.status}: {body[:240]}")
            return json.loads(body)
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        if exc.code in (418, 429):
            raise PacificaMarketError(
                f"Pacifica rate limited (HTTP {exc.code}). Try again shortly."
            ) from exc
        detail = body[:240] if body else str(exc)
        raise PacificaMarketError(f"Pacifica HTTP {exc.code}: {detail}") from exc
    except PacificaMarketError:
        raise
    except Exception as exc:
        raise PacificaMarketError(f"Pacifica request failed: {exc}") from exc


def _unwrap_data(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        if payload.get("success") is False:
            err = payload.get("error") or payload.get("code") or "request failed"
            raise PacificaMarketError(f"Pacifica error: {err}")
        return payload.get("data")
    return payload


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


def list_perp_markets(*, use_cache: bool = True) -> dict[str, Any]:
    cache_key = "markets|all"
    if use_cache:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    data = _unwrap_data(_http_get_json("/info"))
    if not isinstance(data, list):
        raise PacificaMarketError("Unexpected markets payload")

    markets: list[dict[str, Any]] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        instrument = str(row.get("instrument_type") or "perpetual").lower()
        if instrument and instrument not in ("perpetual", "perp"):
            continue
        symbol = str(row.get("symbol") or "").upper()
        if not symbol:
            continue
        base = str(row.get("base_asset") or symbol).upper()
        markets.append(
            {
                "symbol": symbol,
                "venue_symbol": symbol,
                "base": base,
                "quote": "USD",
                "listed": True,
            }
        )

    result = {
        "venue": "pacifica",
        "markets": markets,
        "count": len(markets),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
        "source": "pacifica_perp_public",
    }
    if use_cache:
        _cache_set(cache_key, result, ttl_sec=MARKETS_CACHE_TTL_SEC)
    return result


def get_orderbook_snapshot(symbol_raw: object, *, use_cache: bool = True) -> dict[str, Any]:
    symbol = normalize_pacifica_symbol(symbol_raw)
    cache_key = f"orderbook|{symbol}"
    if use_cache:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    data = _unwrap_data(_http_get_json("/book", {"symbol": symbol, "agg_level": "1"}))
    if not isinstance(data, dict):
        raise PacificaMarketError(f"No orderbook for {symbol}")

    levels = data.get("l") or []
    bids_raw = levels[0] if isinstance(levels, list) and len(levels) > 0 else []
    asks_raw = levels[1] if isinstance(levels, list) and len(levels) > 1 else []

    def parse_side(side: object) -> list[tuple[float, float]]:
        if not isinstance(side, list):
            return []
        out: list[tuple[float, float]] = []
        for row in side:
            if not isinstance(row, dict):
                continue
            price = _safe_float(row.get("p"))
            qty = _safe_float(row.get("a"))
            if price is None or qty is None or price <= 0 or qty <= 0:
                continue
            out.append((price, qty))
        return out

    bids = parse_side(bids_raw)
    asks = parse_side(asks_raw)
    bids.sort(key=lambda x: x[0], reverse=True)
    asks.sort(key=lambda x: x[0])
    mid = None
    if bids and asks:
        mid = (bids[0][0] + asks[0][0]) / 2.0

    result = {
        "venue": "pacifica",
        "symbol": symbol,
        "venue_symbol": symbol,
        "bids": [{"price": p, "quantity": q} for p, q in bids],
        "asks": [{"price": p, "quantity": q} for p, q in asks],
        "mid": mid,
        "slot": data.get("t"),
        "bid_levels": len(bids),
        "ask_levels": len(asks),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
        "source": "pacifica_perp_public",
    }
    if use_cache:
        _cache_set(cache_key, result, ttl_sec=ORDERBOOK_CACHE_TTL_SEC)
    return result


def get_funding_snapshot(symbol_raw: object, *, use_cache: bool = True) -> dict[str, Any]:
    """
    Normalized funding snapshot from /info/prices.

    `funding` is a fraction for the past hourly epoch.
    """
    symbol = normalize_pacifica_symbol(symbol_raw)
    cache_key = f"funding|{symbol}"
    if use_cache:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    data = _unwrap_data(_http_get_json("/info/prices"))
    if not isinstance(data, list):
        raise PacificaMarketError("Unexpected prices payload")

    row = next(
        (r for r in data if isinstance(r, dict) and str(r.get("symbol") or "").upper() == symbol),
        None,
    )
    if row is None:
        raise PacificaMarketError(f"No funding/price for {symbol}")

    rate_fraction = _safe_float(row.get("funding"))
    if rate_fraction is None:
        rate_fraction = _safe_float(row.get("next_funding"))
    if rate_fraction is None:
        raise PacificaMarketError(f"Invalid funding rate for {symbol}")

    interval_hours = PACIFICA_INTERVAL_HOURS
    rate_24h = rate_fraction * (24.0 / interval_hours)
    as_of = None
    ts = row.get("timestamp")
    if ts is not None:
        try:
            ms = int(ts)
            as_of = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat()
        except (TypeError, ValueError, OSError):
            as_of = str(ts)

    result = {
        "venue": "pacifica",
        "symbol": symbol,
        "venue_symbol": symbol,
        "funding_rate": rate_fraction,
        "funding_rate_percent": rate_fraction * 100.0,
        "interval_hours": interval_hours,
        "settle_hours": PACIFICA_SETTLE_HOURS,
        "rate_per_24h_percent": rate_24h * 100.0,
        "rate_per_24h": rate_24h,
        "next_funding_at": None,
        "rate_as_of": as_of,
        "settle_model": "Hourly funding epoch",
        "mark_price": _safe_float(row.get("mark")),
        "index_price": _safe_float(row.get("oracle")),
        "samples_in_24h_window": 1,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
        "source": "pacifica_perp_public",
    }
    if use_cache:
        _cache_set(cache_key, result)
    return result


def get_fee_schedule(*, use_cache: bool = True) -> dict[str, Any]:
    cache_key = "fees|levels"
    if use_cache:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    data = _unwrap_data(_http_get_json("/info/fees"))
    if not isinstance(data, list) or not data:
        raise PacificaMarketError("No fee levels returned")

    # Level 0 = base retail tier.
    level0 = next((r for r in data if isinstance(r, dict) and int(r.get("level") or -1) == 0), None)
    if level0 is None:
        level0 = data[0] if isinstance(data[0], dict) else {}

    maker = _safe_float(level0.get("maker_fee_rate"))
    taker = _safe_float(level0.get("taker_fee_rate"))
    if maker is None or taker is None:
        raise PacificaMarketError("Invalid fee level rates")

    result = {
        "venue": "pacifica",
        "maker_bps": maker * 10_000.0,
        "taker_bps": taker * 10_000.0,
        "tier": f"level_{level0.get('level', 0)}",
        "as_of": datetime.now(timezone.utc).date().isoformat(),
        "source": "pacifica_perp_public",
        "note": "Base fee level (level 0).",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
    }
    if use_cache:
        _cache_set(cache_key, result, ttl_sec=MARKETS_CACHE_TTL_SEC)
    return result
