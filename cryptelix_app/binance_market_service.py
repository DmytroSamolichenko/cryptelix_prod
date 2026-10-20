"""
Public Binance Spot market data for AI chat tools (no user API keys).

Endpoints used:
  - GET /api/v3/ticker/price      → last price
  - GET /api/v3/ticker/bookTicker → best bid / ask
  - GET /api/v3/ticker/24hr       → 24h stats
  - GET /api/v3/avgPrice          → short-window average price

Prefer data-api.binance.vision (market-data only). Shared in-process cache
reduces duplicate hits when many users ask about the same symbol.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

BINANCE_DATA_BASE = "https://data-api.binance.vision"
BINANCE_API_FALLBACK = "https://api.binance.com"
REQUEST_TIMEOUT_SEC = 8.0
CACHE_TTL_SEC = 10.0
KLINES_CACHE_TTL_SEC = 60.0
KLINES_ALLOWED_INTERVALS = frozenset({"15m", "1h", "4h", "1d", "1w", "1M"})
KLINES_MAX_LIMIT = 500

FIELD_LAST_PRICE = "last_price"
FIELD_BID_ASK = "bid_ask"
FIELD_TICKER_24H = "ticker_24h"
FIELD_AVG_PRICE = "avg_price"
ALL_FIELDS: tuple[str, ...] = (
    FIELD_LAST_PRICE,
    FIELD_BID_ASK,
    FIELD_TICKER_24H,
    FIELD_AVG_PRICE,
)

_QUOTE_SUFFIXES = (
    "USDT",
    "USDC",
    "BUSD",
    "FDUSD",
    "TUSD",
    "BTC",
    "ETH",
    "BNB",
    "EUR",
    "TRY",
)

_cache_lock = threading.Lock()
# key → (expires_at_monotonic, payload_dict)
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


class BinanceMarketError(Exception):
    """Public market-data fetch or symbol normalization failure."""


def normalize_binance_symbol(raw: object) -> str:
    """
    Normalize user/model input to Binance spot symbol, e.g. BTCUSDT.

    Accepts: BTCUSDT, btcusdt, BTC/USDT, BTC-USDT, BTC.
    Bare base assets default to USDT quote.
    """
    if raw is None:
        raise BinanceMarketError("symbol is required")
    s = str(raw).strip().upper()
    if not s:
        raise BinanceMarketError("symbol is required")
    for ch in ("/", "-", "_", " "):
        s = s.replace(ch, "")
    if not s.isalnum():
        raise BinanceMarketError(f"Invalid symbol: {raw!r}")
    if any(s.endswith(q) and len(s) > len(q) for q in _QUOTE_SUFFIXES):
        return s
    # Bare asset → assume USDT pair (most common chat ask).
    return f"{s}USDT"


def parse_fields(raw: object) -> list[str]:
    """Normalize tool `fields` arg → ordered unique subset of ALL_FIELDS."""
    if raw is None:
        return list(ALL_FIELDS)
    if isinstance(raw, str):
        raw = [p.strip() for p in raw.split(",") if p.strip()]
    if not isinstance(raw, (list, tuple)):
        return list(ALL_FIELDS)
    aliases = {
        "price": FIELD_LAST_PRICE,
        "last": FIELD_LAST_PRICE,
        "last_price": FIELD_LAST_PRICE,
        "ticker_price": FIELD_LAST_PRICE,
        "bid": FIELD_BID_ASK,
        "ask": FIELD_BID_ASK,
        "bid_ask": FIELD_BID_ASK,
        "book": FIELD_BID_ASK,
        "book_ticker": FIELD_BID_ASK,
        "24h": FIELD_TICKER_24H,
        "ticker": FIELD_TICKER_24H,
        "ticker_24h": FIELD_TICKER_24H,
        "stats": FIELD_TICKER_24H,
        "avg": FIELD_AVG_PRICE,
        "avg_price": FIELD_AVG_PRICE,
        "average": FIELD_AVG_PRICE,
        "all": "all",
    }
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        key = aliases.get(str(item).strip().lower())
        if key == "all":
            return list(ALL_FIELDS)
        if key and key not in seen:
            seen.add(key)
            out.append(key)
    return out or list(ALL_FIELDS)


def _http_get_json(path: str, params: dict[str, str]) -> Any:
    query = urllib.parse.urlencode(params)
    last_err: Exception | None = None
    for base in (BINANCE_DATA_BASE, BINANCE_API_FALLBACK):
        url = f"{base}{path}?{query}"
        req = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "User-Agent": "Cryptelix/1.0"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
                body = resp.read().decode("utf-8")
                if resp.status == 418 or resp.status == 429:
                    raise BinanceMarketError(
                        f"Binance rate limited (HTTP {resp.status}). Try again shortly."
                    )
                if resp.status >= 400:
                    raise BinanceMarketError(f"Binance HTTP {resp.status}: {body[:240]}")
                return json.loads(body)
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            if exc.code in (418, 429):
                raise BinanceMarketError(
                    f"Binance rate limited (HTTP {exc.code}). Try again shortly."
                ) from exc
            # -1121 bad symbol etc.
            detail = body[:240] if body else str(exc)
            last_err = BinanceMarketError(f"Binance HTTP {exc.code}: {detail}")
            if exc.code == 400:
                raise last_err from exc
        except BinanceMarketError:
            raise
        except Exception as exc:
            last_err = BinanceMarketError(f"Binance request failed: {exc}")
            continue
    raise last_err or BinanceMarketError("Binance request failed")


def fetch_last_price(symbol: str) -> dict[str, Any]:
    data = _http_get_json("/api/v3/ticker/price", {"symbol": symbol})
    return {
        "symbol": data.get("symbol") or symbol,
        "last_price": data.get("price"),
    }


def fetch_bid_ask(symbol: str) -> dict[str, Any]:
    data = _http_get_json("/api/v3/ticker/bookTicker", {"symbol": symbol})
    return {
        "symbol": data.get("symbol") or symbol,
        "bid_price": data.get("bidPrice"),
        "bid_qty": data.get("bidQty"),
        "ask_price": data.get("askPrice"),
        "ask_qty": data.get("askQty"),
    }


def fetch_ticker_24h(symbol: str) -> dict[str, Any]:
    data = _http_get_json("/api/v3/ticker/24hr", {"symbol": symbol})
    return {
        "symbol": data.get("symbol") or symbol,
        "last_price": data.get("lastPrice"),
        "price_change": data.get("priceChange"),
        "price_change_percent": data.get("priceChangePercent"),
        "weighted_avg_price": data.get("weightedAvgPrice"),
        "high_price": data.get("highPrice"),
        "low_price": data.get("lowPrice"),
        "open_price": data.get("openPrice"),
        "volume": data.get("volume"),
        "quote_volume": data.get("quoteVolume"),
        "open_time_ms": data.get("openTime"),
        "close_time_ms": data.get("closeTime"),
        "trade_count": data.get("count"),
    }


def pair_to_spot_symbol(pair: object) -> str:
    """BTC/USDT, BTC/USDT:USDT, btcusdt → BTCUSDT."""
    raw = str(pair or "").strip()
    if ":" in raw:
        raw = raw.split(":", 1)[0]
    return normalize_binance_symbol(raw)


def spot_symbol_candidates(pair: object) -> list[str]:
    """Spot symbols to try. Coin-M SOL/USD has no SOLUSD ticker — fall back to SOLUSDT."""
    primary = pair_to_spot_symbol(pair)
    out: list[str] = []

    def add(symbol: str) -> None:
        if symbol and symbol not in out:
            out.append(symbol)

    add(primary)
    if primary.endswith("USD") and not primary.endswith(("USDT", "USDC")):
        add(f"{primary[:-3]}USDT")
        add(f"{primary[:-3]}USDC")
    return out


def fetch_klines(
    symbol: str,
    interval: str = "1h",
    limit: int = 200,
    start_time_ms: int | None = None,
    end_time_ms: int | None = None,
) -> list[dict[str, Any]]:
    if interval not in KLINES_ALLOWED_INTERVALS:
        raise BinanceMarketError(
            f"interval must be one of: {', '.join(sorted(KLINES_ALLOWED_INTERVALS))}"
        )
    capped = max(1, min(int(limit), KLINES_MAX_LIMIT))
    params: dict[str, str] = {
        "symbol": symbol,
        "interval": interval,
        "limit": str(capped),
    }
    if start_time_ms is not None:
        params["startTime"] = str(int(start_time_ms))
    if end_time_ms is not None:
        params["endTime"] = str(int(end_time_ms))

    raw = _http_get_json("/api/v3/klines", params)
    if not isinstance(raw, list):
        raise BinanceMarketError("Unexpected klines payload")

    out: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, (list, tuple)) or len(row) < 6:
            continue
        out.append(
            {
                "open_time_ms": int(row[0]),
                "open": str(row[1]),
                "high": str(row[2]),
                "low": str(row[3]),
                "close": str(row[4]),
                "volume": str(row[5]),
            }
        )
    return out


def get_klines(
    symbol_raw: object,
    interval: str = "1h",
    limit: int = 200,
    start_time_ms: int | None = None,
    end_time_ms: int | None = None,
    *,
    use_cache: bool = True,
) -> dict[str, Any]:
    cache_key = f"kl|{symbol_raw}|{interval}|{limit}|{start_time_ms}|{end_time_ms}"
    if use_cache:
        now = time.monotonic()
        with _cache_lock:
            hit = _cache.get(cache_key)
            if hit and hit[0] > now:
                cached = dict(hit[1])
                cached["cached"] = True
                return cached

    last_err: Exception | None = None
    result: dict[str, Any] | None = None
    for symbol in spot_symbol_candidates(symbol_raw):
        try:
            candles = fetch_klines(
                symbol,
                interval=interval,
                limit=limit,
                start_time_ms=start_time_ms,
                end_time_ms=end_time_ms,
            )
        except BinanceMarketError as exc:
            last_err = exc
            continue
        result = {
            "source": "binance_spot_public",
            "symbol": symbol,
            "interval": interval,
            "cached": False,
            "candles": candles,
        }
        break

    if result is None:
        raise last_err or BinanceMarketError("No klines for symbol")

    if use_cache:
        with _cache_lock:
            _cache[cache_key] = (time.monotonic() + KLINES_CACHE_TTL_SEC, dict(result))
    return result


_COINGECKO_IDS = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "BNB": "binancecoin",
    "XRP": "ripple",
    "DOGE": "dogecoin",
    "ADA": "cardano",
    "AVAX": "avalanche-2",
    "DOT": "polkadot",
    "LINK": "chainlink",
    "LTC": "litecoin",
    "UNI": "uniswap",
    "ATOM": "cosmos",
    "NEAR": "near",
    "APT": "aptos",
    "SUI": "sui",
    "ARB": "arbitrum",
    "OP": "optimism",
    "PEPE": "pepe",
}

MARKET_CAP_CACHE_TTL_SEC = 300.0


def split_base_quote(symbol: str) -> tuple[str, str]:
    raw = (symbol or "").strip().upper()
    for quote in _QUOTE_SUFFIXES:
        if raw.endswith(quote) and len(raw) > len(quote):
            return raw[: -len(quote)], quote
    return raw, "USDT"


def fetch_market_cap_usd(base: str) -> float | None:
    cg_id = _COINGECKO_IDS.get((base or "").strip().upper())
    if not cg_id:
        return None
    cache_key = f"mc|{cg_id}"
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(cache_key)
        if hit and hit[0] > now:
            value = hit[1].get("market_cap_usd")
            return float(value) if value is not None else None

    url = (
        "https://api.coingecko.com/api/v3/simple/price"
        f"?ids={urllib.parse.quote(cg_id)}&vs_currencies=usd&include_market_cap=true"
    )
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "Cryptelix/1.0"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        cap = (payload.get(cg_id) or {}).get("usd_market_cap")
        value = float(cap) if cap is not None else None
    except Exception:
        value = None

    with _cache_lock:
        _cache[cache_key] = (now + MARKET_CAP_CACHE_TTL_SEC, {"market_cap_usd": value})
    return value


def get_ticker_overview(symbol_raw: object) -> dict[str, Any]:
    last_err: Exception | None = None
    ticker: dict[str, Any] | None = None
    symbol = ""
    for candidate in spot_symbol_candidates(symbol_raw):
        try:
            ticker = fetch_ticker_24h(candidate)
            symbol = str(ticker.get("symbol") or candidate)
            break
        except BinanceMarketError as exc:
            last_err = exc
            continue
    if ticker is None:
        raise last_err or BinanceMarketError("No ticker for symbol")

    base, quote = split_base_quote(symbol)
    return {
        "source": "binance_spot_public",
        "symbol": symbol,
        "base": base,
        "quote": quote,
        "last_price": ticker.get("last_price"),
        "price_change": ticker.get("price_change"),
        "price_change_percent": ticker.get("price_change_percent"),
        "high_price": ticker.get("high_price"),
        "low_price": ticker.get("low_price"),
        "volume": ticker.get("volume"),
        "quote_volume": ticker.get("quote_volume"),
        "market_cap_usd": fetch_market_cap_usd(base),
    }


def fetch_avg_price(symbol: str) -> dict[str, Any]:
    data = _http_get_json("/api/v3/avgPrice", {"symbol": symbol})
    return {
        "symbol": symbol,
        "mins": data.get("mins"),
        "avg_price": data.get("price"),
        "close_time_ms": data.get("closeTime"),
    }


_FIELD_FETCHERS = {
    FIELD_LAST_PRICE: ("last_price", fetch_last_price),
    FIELD_BID_ASK: ("bid_ask", fetch_bid_ask),
    FIELD_TICKER_24H: ("ticker_24h", fetch_ticker_24h),
    FIELD_AVG_PRICE: ("avg_price", fetch_avg_price),
}


def get_market_snapshot(
    symbol_raw: object,
    fields: object = None,
    *,
    use_cache: bool = True,
) -> dict[str, Any]:
    """
    Fetch selected public market fields for one spot symbol.

    Returns a dict suitable for JSON serialization / tool payload.
    """
    symbol = normalize_binance_symbol(symbol_raw)
    wanted = parse_fields(fields)
    cache_key = f"{symbol}|{','.join(wanted)}"

    if use_cache:
        now = time.monotonic()
        with _cache_lock:
            hit = _cache.get(cache_key)
            if hit and hit[0] > now:
                cached = dict(hit[1])
                cached["cached"] = True
                return cached

    sections: dict[str, Any] = {}
    errors: dict[str, str] = {}

    def _run(field: str) -> tuple[str, str, dict[str, Any] | None, str | None]:
        key, fn = _FIELD_FETCHERS[field]
        try:
            return field, key, fn(symbol), None
        except Exception as exc:
            return field, key, None, str(exc)

    with ThreadPoolExecutor(max_workers=min(4, len(wanted))) as pool:
        futures = [pool.submit(_run, f) for f in wanted]
        for fut in as_completed(futures):
            _field, key, payload, err = fut.result()
            if err:
                errors[key] = err
            else:
                sections[key] = payload

    fetched_at = datetime.now(timezone.utc).isoformat()
    result: dict[str, Any] = {
        "source": "binance_spot_public",
        "symbol": symbol,
        "fetched_at": fetched_at,
        "cached": False,
        "fields": wanted,
        **sections,
    }
    if errors:
        result["errors"] = errors
    if not sections:
        raise BinanceMarketError(
            f"No market data for {symbol}: {errors or 'unknown error'}"
        )

    if use_cache:
        with _cache_lock:
            _cache[cache_key] = (time.monotonic() + CACHE_TTL_SEC, dict(result))

    return result


def format_market_snapshot_for_model(snapshot: dict[str, Any]) -> str:
    """Compact text block for the chat tool loop."""
    symbol = snapshot.get("symbol", "?")
    lines = [
        f"get_binance_market_data ({symbol}):",
        f"source={snapshot.get('source')} fetched_at={snapshot.get('fetched_at')} "
        f"cached={snapshot.get('cached')}",
    ]

    last = snapshot.get("last_price")
    if isinstance(last, dict):
        lines.append(f"last_price={last.get('last_price')}")

    book = snapshot.get("bid_ask")
    if isinstance(book, dict):
        lines.append(
            f"bid={book.get('bid_price')} (qty {book.get('bid_qty')}) | "
            f"ask={book.get('ask_price')} (qty {book.get('ask_qty')})"
        )

    t24 = snapshot.get("ticker_24h")
    if isinstance(t24, dict):
        lines.append(
            f"24h: last={t24.get('last_price')} change={t24.get('price_change')} "
            f"({t24.get('price_change_percent')}%) "
            f"high={t24.get('high_price')} low={t24.get('low_price')} "
            f"open={t24.get('open_price')} volume={t24.get('volume')} "
            f"quote_volume={t24.get('quote_volume')} trades={t24.get('trade_count')}"
        )

    avg = snapshot.get("avg_price")
    if isinstance(avg, dict):
        lines.append(
            f"avg_price={avg.get('avg_price')} (window_mins={avg.get('mins')})"
        )

    errs = snapshot.get("errors")
    if isinstance(errs, dict) and errs:
        for k, v in errs.items():
            lines.append(f"error[{k}]={v}")

    lines.append(
        "These are live public Binance Spot quotes (not the user's private account). "
        "Report facts only; do not give buy/sell advice."
    )
    return "\n".join(lines)


# --- USDT-M futures funding (public fapi; separate from spot tickers above) ---

BINANCE_FAPI_BASE = "https://fapi.binance.com"
FUNDING_CACHE_TTL_SEC = 30.0
_DEFAULT_FUNDING_INTERVAL_HOURS = 8.0


def _fapi_get_json(path: str, params: dict[str, str] | None = None) -> Any:
    query = urllib.parse.urlencode(params or {})
    url = f"{BINANCE_FAPI_BASE}{path}"
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
                raise BinanceMarketError(
                    f"Binance rate limited (HTTP {resp.status}). Try again shortly."
                )
            if resp.status >= 400:
                raise BinanceMarketError(f"Binance HTTP {resp.status}: {body[:240]}")
            return json.loads(body)
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        if exc.code in (418, 429):
            raise BinanceMarketError(
                f"Binance rate limited (HTTP {exc.code}). Try again shortly."
            ) from exc
        detail = body[:240] if body else str(exc)
        raise BinanceMarketError(f"Binance HTTP {exc.code}: {detail}") from exc
    except BinanceMarketError:
        raise
    except Exception as exc:
        raise BinanceMarketError(f"Binance futures request failed: {exc}") from exc


def _funding_interval_hours(symbol: str) -> float:
    cache_key = "binance|fundingInfo"
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(cache_key)
        if hit and hit[0] > now:
            table = hit[1]
        else:
            table = None
    if table is None:
        raw = _fapi_get_json("/fapi/v1/fundingInfo")
        table = {}
        if isinstance(raw, list):
            for row in raw:
                if isinstance(row, dict) and row.get("symbol"):
                    table[str(row["symbol"])] = row
        with _cache_lock:
            # fundingInfo changes rarely — cache longer
            _cache[cache_key] = (time.monotonic() + 300.0, table)
    row = table.get(symbol) if isinstance(table, dict) else None
    if isinstance(row, dict):
        try:
            hours = float(row.get("fundingIntervalHours") or _DEFAULT_FUNDING_INTERVAL_HOURS)
            if hours > 0:
                return hours
        except (TypeError, ValueError):
            pass
    return _DEFAULT_FUNDING_INTERVAL_HOURS


def get_funding_snapshot(symbol_raw: object, *, use_cache: bool = True) -> dict[str, Any]:
    """
    Normalized USDT-M funding snapshot for widgets (public, no user keys).

    Uses premiumIndex (lastFundingRate, nextFundingTime, mark/index).
    """
    symbol = normalize_binance_symbol(symbol_raw)
    cache_key = f"binance|funding|{symbol}"
    if use_cache:
        now = time.monotonic()
        with _cache_lock:
            hit = _cache.get(cache_key)
            if hit and hit[0] > now:
                out = dict(hit[1])
                out["cached"] = True
                return out

    data = _fapi_get_json("/fapi/v1/premiumIndex", {"symbol": symbol})
    rate = None
    try:
        rate = float(data.get("lastFundingRate"))
    except (TypeError, ValueError):
        raise BinanceMarketError(f"Invalid funding rate for {symbol}") from None

    interval_hours = _funding_interval_hours(symbol)
    rate_percent = rate * 100.0
    # Normalize period rate → approximate % over 24h.
    rate_24h = rate * (24.0 / interval_hours)
    rate_24h_percent = rate_24h * 100.0

    next_at = None
    next_ms = data.get("nextFundingTime")
    if next_ms is not None:
        try:
            next_at = datetime.fromtimestamp(
                int(next_ms) / 1000.0, tz=timezone.utc
            ).isoformat()
        except (TypeError, ValueError, OSError):
            next_at = None

    mark = None
    index = None
    try:
        mark = float(data.get("markPrice")) if data.get("markPrice") is not None else None
    except (TypeError, ValueError):
        mark = None
    try:
        index = float(data.get("indexPrice")) if data.get("indexPrice") is not None else None
    except (TypeError, ValueError):
        index = None

    # Display base: BTCUSDT → BTC
    base = symbol
    for q in ("USDT", "USDC", "BUSD", "FDUSD"):
        if base.endswith(q) and len(base) > len(q):
            base = base[: -len(q)]
            break

    hours_i = int(interval_hours) if float(interval_hours).is_integer() else interval_hours
    result = {
        "venue": "binance",
        "symbol": base,
        "venue_symbol": symbol,
        "funding_rate": rate,
        "funding_rate_percent": rate_percent,
        "interval_hours": interval_hours,
        "settle_hours": interval_hours,
        "rate_per_24h_percent": rate_24h_percent,
        "rate_per_24h": rate_24h,
        "next_funding_at": next_at,
        "rate_as_of": datetime.now(timezone.utc).isoformat(),
        "settle_model": f"Settles every {hours_i}h",
        "mark_price": mark,
        "index_price": index,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
        "source": "binance_usdm_public",
    }
    if use_cache:
        with _cache_lock:
            _cache[cache_key] = (time.monotonic() + FUNDING_CACHE_TTL_SEC, dict(result))
    return result
