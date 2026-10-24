"""
Public Phoenix Trade (perp DEX) market data — separate from Binance services.

Used by venue widgets (funding, etc.). No user API keys.
REST: https://perp-api.phoenix.trade
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

PHOENIX_API_BASE = "https://perp-api.phoenix.trade"
REQUEST_TIMEOUT_SEC = 8.0
CACHE_TTL_SEC = 30.0

# Hourly snapshots; funding settles every 24h (Phoenix docs).
PHOENIX_SNAPSHOT_INTERVAL_HOURS = 1.0
PHOENIX_SETTLE_HOURS = 24.0

_cache_lock = threading.Lock()
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


class PhoenixMarketError(Exception):
    """Public Phoenix market-data fetch or symbol normalization failure."""


def normalize_phoenix_symbol(raw: object) -> str:
    """
    Normalize to Phoenix market symbol, e.g. BTC, SOL, TSLA.

    Accepts BTC, btc, BTCUSDT, BTC/USDT, BTC-PERP → BTC.
    """
    if raw is None:
        raise PhoenixMarketError("symbol is required")
    s = str(raw).strip().upper()
    if not s:
        raise PhoenixMarketError("symbol is required")
    for ch in ("/", "-", "_", " "):
        s = s.replace(ch, "")
    if s.endswith("PERP"):
        s = s[: -len("PERP")]
    for quote in ("USDT", "USDC", "USD", "BUSD"):
        if s.endswith(quote) and len(s) > len(quote):
            s = s[: -len(quote)]
            break
    if not s.isalnum():
        raise PhoenixMarketError(f"Invalid Phoenix symbol: {raw!r}")
    return s


def _http_get_json(path: str, params: dict[str, str] | None = None) -> Any:
    query = urllib.parse.urlencode(params or {})
    url = f"{PHOENIX_API_BASE}{path}"
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
                raise PhoenixMarketError(
                    f"Phoenix rate limited (HTTP {resp.status}). Try again shortly."
                )
            if resp.status >= 400:
                raise PhoenixMarketError(f"Phoenix HTTP {resp.status}: {body[:240]}")
            return json.loads(body)
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        if exc.code in (418, 429):
            raise PhoenixMarketError(
                f"Phoenix rate limited (HTTP {exc.code}). Try again shortly."
            ) from exc
        detail = body[:240] if body else str(exc)
        raise PhoenixMarketError(f"Phoenix HTTP {exc.code}: {detail}") from exc
    except PhoenixMarketError:
        raise
    except Exception as exc:
        raise PhoenixMarketError(f"Phoenix request failed: {exc}") from exc


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


def fetch_mark_price(symbol: str) -> dict[str, Any]:
    data = _http_get_json(f"/v1/market/{symbol}/mark-price")
    mp = data.get("markPrice")
    price = None
    if isinstance(mp, dict):
        price = _safe_float(mp.get("price"))
    else:
        price = _safe_float(mp)
    return {
        "symbol": data.get("symbol") or symbol,
        "mark_price": price,
        "slot": data.get("slot"),
    }


def fetch_funding_rates(symbol: str) -> dict[str, Any]:
    """Raw history from GET /v1/funding/{symbol}/rates."""
    return _http_get_json(f"/v1/funding/{symbol}/rates")


ORDERBOOK_CACHE_TTL_SEC = 3.0


def _parse_book_levels(raw: object) -> list[tuple[float, float]]:
    """Parse [[price, size], ...] into positive (price, qty) pairs."""
    if not isinstance(raw, list):
        return []
    out: list[tuple[float, float]] = []
    for row in raw:
        price: float | None = None
        qty: float | None = None
        if isinstance(row, (list, tuple)) and len(row) >= 2:
            price = _safe_float(row[0])
            qty = _safe_float(row[1])
        elif isinstance(row, dict):
            price = _safe_float(row.get("price", row.get("px")))
            qty_raw = row.get("quantity")
            if qty_raw is None:
                qty_raw = row.get("qty")
            if qty_raw is None:
                qty_raw = row.get("size")
            qty = _safe_float(qty_raw)
        if price is None or qty is None or price <= 0 or qty <= 0:
            continue
        out.append((price, qty))
    return out


def fetch_orderbook(symbol: str) -> dict[str, Any]:
    """Raw L2 snapshot from GET /v1/view/orderbook/{symbol}."""
    return _http_get_json(f"/v1/view/orderbook/{symbol}")


def get_orderbook_snapshot(symbol_raw: object, *, use_cache: bool = True) -> dict[str, Any]:
    """
    Normalized L2 book for impact / slippage walks.

    Bids sorted price desc, asks sorted price asc. Sizes are base asset.
    Quote notional at a level ≈ price * size.
    """
    symbol = normalize_phoenix_symbol(symbol_raw)
    cache_key = f"orderbook|{symbol}"
    if use_cache:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    raw = fetch_orderbook(symbol)
    bids = _parse_book_levels(raw.get("bids"))
    asks = _parse_book_levels(raw.get("asks"))
    bids.sort(key=lambda x: x[0], reverse=True)
    asks.sort(key=lambda x: x[0])

    mid = _safe_float(raw.get("mid"))
    if mid is None and bids and asks:
        mid = (bids[0][0] + asks[0][0]) / 2.0

    result = {
        "venue": "phoenix",
        "symbol": symbol,
        "venue_symbol": symbol,
        "bids": [{"price": p, "quantity": q} for p, q in bids],
        "asks": [{"price": p, "quantity": q} for p, q in asks],
        "mid": mid,
        "slot": raw.get("slot"),
        "bid_levels": len(bids),
        "ask_levels": len(asks),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
        "source": "phoenix_perp_public",
    }
    if use_cache:
        _cache_set(cache_key, result, ttl_sec=ORDERBOOK_CACHE_TTL_SEC)
    return result


def get_funding_snapshot(symbol_raw: object, *, use_cache: bool = True) -> dict[str, Any]:
    """
    Normalized funding snapshot for widgets.

    Phoenix docs: funding accrues from hourly snapshots and settles every 24h.
    `fundingRatePercentage` is treated as a percent value per hourly snapshot
    (e.g. 0.001296 → 0.001296% for that hour).
    """
    symbol = normalize_phoenix_symbol(symbol_raw)
    cache_key = f"funding|{symbol}"
    if use_cache:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    rates_payload = fetch_funding_rates(symbol)
    rates = rates_payload.get("rates") or []
    if not isinstance(rates, list) or not rates:
        raise PhoenixMarketError(f"No funding rates for {symbol}")

    last = rates[-1] if isinstance(rates[-1], dict) else {}
    hourly_pct = _safe_float(last.get("fundingRatePercentage"))
    if hourly_pct is None:
        raise PhoenixMarketError(f"Invalid funding rate for {symbol}")

    # Sum last up-to-24 hourly percent points ≈ estimated % over ~24h.
    window = rates[-24:] if len(rates) >= 24 else rates
    sum_24h_pct = 0.0
    for row in window:
        if not isinstance(row, dict):
            continue
        v = _safe_float(row.get("fundingRatePercentage"))
        if v is not None:
            sum_24h_pct += v

    mark_price = None
    try:
        mark_price = fetch_mark_price(symbol).get("mark_price")
    except PhoenixMarketError:
        pass

    ts_raw = last.get("timestamp")
    as_of = None
    if ts_raw is not None:
        try:
            # Phoenix timestamps appear as unix seconds.
            as_of = datetime.fromtimestamp(int(ts_raw), tz=timezone.utc).isoformat()
        except (TypeError, ValueError, OSError):
            as_of = str(ts_raw)

    # Fraction equivalents for shared math (percent / 100).
    rate_fraction = hourly_pct / 100.0
    rate_24h_fraction = sum_24h_pct / 100.0

    result = {
        "venue": "phoenix",
        "symbol": symbol,
        "venue_symbol": symbol,
        "funding_rate": rate_fraction,
        "funding_rate_percent": hourly_pct,
        "interval_hours": PHOENIX_SNAPSHOT_INTERVAL_HOURS,
        "settle_hours": PHOENIX_SETTLE_HOURS,
        "rate_per_24h_percent": sum_24h_pct,
        "rate_per_24h": rate_24h_fraction,
        "next_funding_at": None,
        "rate_as_of": as_of,
        "settle_model": "Hourly accrual · settles every 24h",
        "mark_price": mark_price,
        "index_price": None,
        "samples_in_24h_window": len(window),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
        "source": "phoenix_perp_public",
    }
    if use_cache:
        _cache_set(cache_key, result)
    return result
