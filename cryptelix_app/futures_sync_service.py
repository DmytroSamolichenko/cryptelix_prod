"""Binance Futures raw ingest (USDT-M + COIN-M).

Pulls futures fills and funding from Binance into the raw staging tables
`futures_fills` and `futures_funding`. Aggregation into closed `trades` rows is
done separately by [futures_aggregator.py]. Symbols with activity are discovered
from futures income history because Binance's userTrades endpoint requires an
explicit symbol.

Both linear (USDT-M / fapi) and inverse (COIN-M / dapi) markets are covered. For
inverse markets Binance reports realizedPnl / commission / funding in the base
coin, so we convert them to a USD figure (via the fill price for trades, via a
kline close for funding) into the `*_usd` columns while keeping the raw values.
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Callable, Optional, Set, Tuple

import ccxt
from sqlalchemy.orm import Session

from models import FuturesFill, FuturesFunding

logger = logging.getLogger("cryptelix")

# Binance income endpoint caps each query at a 7-day window / 1000 records.
_INCOME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
_DEFAULT_LOOKBACK_DAYS = 365
_USER_TRADES_LIMIT = 1000


def _to_decimal(value: object) -> Decimal:
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def _resolve_futures_market(client, raw_id: str) -> Optional[dict]:
    """Map a raw Binance market id (e.g. 'BTCUSDT', 'SOLUSD_PERP') to a ccxt
    futures market dict (linear swap/future or inverse swap/future)."""
    entries = (getattr(client, "markets_by_id", None) or {}).get(raw_id)
    if not entries:
        return None
    if isinstance(entries, dict):
        entries = [entries]
    for market in entries:
        if not isinstance(market, dict):
            continue
        if market.get("contract") and market.get("type") in ("future", "swap"):
            return market
    return None


def _market_type(market: dict) -> str:
    if market.get("linear"):
        return "usdm"
    if market.get("inverse"):
        return "coinm"
    return "future"


def _display_pair(symbol: str) -> str:
    """'BTC/USDT:USDT' -> 'BTC/USDT', 'SOL/USD:SOL' -> 'SOL/USD'."""
    return (symbol or "").split(":", 1)[0] or symbol


def _insert_futures_fill(
    db: Session,
    user_id: int,
    exchange_name: str,
    trade: dict,
    market: dict,
    seen: Set[str],
) -> bool:
    """Insert one raw fill into futures_fills; dedup per (user, market, id)."""
    raw_id = trade.get("id")
    if raw_id is None:
        return False
    external_id = str(raw_id).strip()
    if not external_id:
        return False

    market_type = _market_type(market)
    dedup_key = f"{market_type}:{external_id}"
    if dedup_key in seen:
        return False
    seen.add(dedup_key)

    existing = (
        db.query(FuturesFill)
        .filter(
            FuturesFill.user_id == user_id,
            FuturesFill.market_type == market_type,
            FuturesFill.external_id == external_id,
        )
        .first()
    )
    if existing:
        return False

    info = trade.get("info") or {}
    timestamp = trade.get("timestamp")
    dt = (
        datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc)
        if timestamp is not None
        else datetime.now(tz=timezone.utc)
    )
    is_inverse = market_type == "coinm"

    price = _to_decimal(trade.get("price"))
    amount = _to_decimal(trade.get("amount"))
    realized_raw = _to_decimal(info.get("realizedPnl"))
    fee_info = trade.get("fee") or {}
    commission_raw = _to_decimal(
        fee_info.get("cost")
        if fee_info.get("cost") is not None
        else info.get("commission")
    )
    commission_asset = fee_info.get("currency") or info.get("commissionAsset")

    # Convert inverse (COIN-M) coin-denominated values to approximate USD via the
    # fill price. USDT-M values are already ~USD.
    if is_inverse:
        realized_usd = realized_raw * price
        commission_usd = commission_raw * price
    else:
        realized_usd = realized_raw
        commission_usd = commission_raw

    fill = FuturesFill(
        user_id=user_id,
        exchange_name=exchange_name,
        market_type=market_type,
        symbol=trade.get("symbol") or market.get("symbol") or "",
        pair=_display_pair(trade.get("symbol") or market.get("symbol") or ""),
        external_id=external_id,
        order_id=str(info.get("orderId")) if info.get("orderId") is not None else None,
        side=(trade.get("side") or "").strip().lower() or "buy",
        position_side=info.get("positionSide"),
        price=price,
        qty=amount,
        realized_pnl=realized_raw,
        commission=commission_raw,
        commission_asset=commission_asset,
        realized_pnl_usd=realized_usd,
        commission_usd=commission_usd,
        executed_at=dt,
        source="rest",
    )
    db.add(fill)
    return True


async def _discover_symbols(
    income_method: Callable, start_ms: int, end_ms: int, label: str
) -> Set[str]:
    """Raw market ids with realized-PnL activity from a futures income endpoint."""
    symbols: Set[str] = set()
    cursor = start_ms
    while cursor < end_ms:
        window_end = min(cursor + _INCOME_WINDOW_MS, end_ms)
        try:
            records = await income_method(
                {
                    "incomeType": "REALIZED_PNL",
                    "startTime": cursor,
                    "endTime": window_end,
                    "limit": 1000,
                }
            )
        except ccxt.BaseError as exc:
            logger.warning(
                "Futures income discovery failed [%s] (%s): %s",
                label,
                type(exc).__name__,
                exc,
            )
            break
        for rec in records or []:
            sym = (rec.get("symbol") or "").strip()
            if sym:
                symbols.add(sym)
        cursor = window_end + 1
    return symbols


async def _backfill_symbol(
    db: Session,
    client,
    user_id: int,
    exchange_name: str,
    market: dict,
    start_ms: int,
    end_ms: int,
) -> int:
    """Import fills for one symbol into futures_fills.

    Binance futures userTrades caps the query range at 7 days, so we page over
    7-day windows across the lookback rather than a single open-ended `since`.
    """
    symbol = market.get("symbol")
    if not symbol:
        return 0
    created = 0
    seen: Set[str] = set()
    cursor = start_ms
    while cursor < end_ms:
        window_end = min(cursor + _INCOME_WINDOW_MS, end_ms)
        try:
            trades = await client.fetch_my_trades(
                symbol=symbol,
                since=cursor,
                limit=_USER_TRADES_LIMIT,
                params={"endTime": window_end, "recvWindow": 60000},
            )
        except ccxt.BaseError as exc:
            logger.warning(
                "Futures userTrades failed for %s (%s): %s",
                symbol,
                type(exc).__name__,
                exc,
            )
            cursor = window_end + 1
            continue
        for t in trades or []:
            if _insert_futures_fill(db, user_id, exchange_name, t, market, seen):
                created += 1
        cursor = window_end + 1

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    return created


async def _kline_close_usd(client, symbol: str, at_ms: int) -> Optional[Decimal]:
    """Best-effort USD price of a futures symbol at a timestamp (for COIN-M fx)."""
    try:
        candles = await client.fetch_ohlcv(symbol, "1m", since=at_ms, limit=1)
        if candles:
            return _to_decimal(candles[0][4])
    except Exception:
        pass
    return None


async def _import_funding(
    db: Session,
    client,
    user_id: int,
    income_sources: list,
    start_ms: int,
    end_ms: int,
) -> int:
    """Import FUNDING_FEE income for both markets into futures_funding."""
    created = 0
    price_cache: dict = {}
    for label, method in income_sources:
        if method is None:
            continue
        is_inverse = label == "coinm"
        cursor = start_ms
        while cursor < end_ms:
            window_end = min(cursor + _INCOME_WINDOW_MS, end_ms)
            try:
                records = await method(
                    {
                        "incomeType": "FUNDING_FEE",
                        "startTime": cursor,
                        "endTime": window_end,
                        "limit": 1000,
                    }
                )
            except ccxt.BaseError as exc:
                logger.warning(
                    "Funding import failed [%s] (%s): %s",
                    label,
                    type(exc).__name__,
                    exc,
                )
                cursor = window_end + 1
                continue

            for rec in records or []:
                raw_symbol = (rec.get("symbol") or "").strip()
                tran_id = rec.get("tranId")
                external_id = str(tran_id) if tran_id is not None else None
                income = _to_decimal(rec.get("income"))
                time_ms = int(rec.get("time") or 0)
                executed_at = (
                    datetime.fromtimestamp(time_ms / 1000, tz=timezone.utc)
                    if time_ms
                    else datetime.now(tz=timezone.utc)
                )

                market = _resolve_futures_market(client, raw_symbol)
                symbol = market.get("symbol") if market else raw_symbol

                if external_id is not None:
                    exists = (
                        db.query(FuturesFunding)
                        .filter(
                            FuturesFunding.user_id == user_id,
                            FuturesFunding.market_type == label,
                            FuturesFunding.external_id == external_id,
                        )
                        .first()
                    )
                    if exists:
                        continue

                if is_inverse and market:
                    bucket = time_ms // _INCOME_WINDOW_MS
                    cache_key = (symbol, bucket)
                    price = price_cache.get(cache_key)
                    if price is None:
                        price = await _kline_close_usd(client, symbol, time_ms)
                        price_cache[cache_key] = price
                    income_usd = income * price if price else None
                else:
                    income_usd = income

                db.add(
                    FuturesFunding(
                        user_id=user_id,
                        market_type=label,
                        symbol=symbol,
                        income=income,
                        income_usd=income_usd,
                        external_id=external_id,
                        executed_at=executed_at,
                        source="rest",
                    )
                )
                created += 1
            cursor = window_end + 1

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    return created


async def backfill_futures_trades(
    db: Session,
    client,
    user_id: int,
    exchange_name: str = "binance",
    lookback_days: int = _DEFAULT_LOOKBACK_DAYS,
) -> dict:
    """Import raw USDT-M and COIN-M futures fills + funding for the user.

    Writes into futures_fills / futures_funding (aggregation runs separately).
    A single ccxt binance client exposes both fapi (USDT-M) and dapi (COIN-M)
    income endpoints, and fetch_my_trades routes by the symbol's market type, so
    one client covers both.
    """
    now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    start_ms = now_ms - lookback_days * 24 * 60 * 60 * 1000

    await client.load_markets()

    # (label, income endpoint) pairs — both live on the same client.
    income_sources: list[Tuple[str, Optional[Callable]]] = [
        ("usdm", getattr(client, "fapiPrivateGetIncome", None)),
        ("coinm", getattr(client, "dapiPrivateGetIncome", None)),
    ]

    raw_symbols: Set[str] = set()
    for label, method in income_sources:
        if method is None:
            continue
        raw_symbols |= await _discover_symbols(method, start_ms, now_ms, label)

    stats = {
        "symbols_discovered": len(raw_symbols),
        "symbols_synced": 0,
        "fills_created": 0,
        "funding_created": 0,
    }
    total_created = 0
    for raw in sorted(raw_symbols):
        market = _resolve_futures_market(client, raw)
        if not market:
            logger.warning("Could not resolve futures market for id=%s", raw)
            continue
        total_created += await _backfill_symbol(
            db, client, user_id, exchange_name, market, start_ms, now_ms
        )
        stats["symbols_synced"] += 1

    stats["fills_created"] = total_created
    stats["funding_created"] = await _import_funding(
        db, client, user_id, income_sources, start_ms, now_ms
    )
    return stats
