from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from models import BalanceSpotTransaction
from price_service import DECIMAL_ZERO, ensure_utc, get_asset_usdt_rate

STABLE_ASSETS = frozenset({"USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI"})


def _to_decimal(value) -> Decimal:
    if value is None:
        return DECIMAL_ZERO
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _fill_exists(
    db: Session,
    user_id: int,
    exchange_name: str,
    external_id: str,
) -> bool:
    return (
        db.query(BalanceSpotTransaction.id)
        .filter(
            BalanceSpotTransaction.user_id == user_id,
            BalanceSpotTransaction.exchange_name == exchange_name,
            BalanceSpotTransaction.external_id == external_id,
            BalanceSpotTransaction.type.in_(["BUY", "SELL"]),
        )
        .first()
        is not None
    )


def insert_fill_from_ccxt(
    db: Session,
    user_id: int,
    trade: dict,
    source: str,
    exchange_name: str = "binance",
) -> Optional[BalanceSpotTransaction]:
    raw_id = trade.get("id")
    if raw_id is None:
        return None
    external_id = str(raw_id).strip()
    if not external_id or _fill_exists(db, user_id, exchange_name, external_id):
        return None

    symbol = trade.get("symbol") or "UNKNOWN"
    parts = symbol.split("/")
    base = parts[0].upper() if parts else "UNKNOWN"
    quote = parts[1].upper() if len(parts) > 1 else "USDT"

    side = (trade.get("side") or "").lower()
    fill_type = "BUY" if side == "buy" else "SELL"

    timestamp = trade.get("timestamp")
    executed_at = (
        datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc)
        if timestamp is not None
        else datetime.now(tz=timezone.utc)
    )

    fee_info = trade.get("fee") or {}
    fee_cost = fee_info.get("cost")
    fee_asset = fee_info.get("currency") or quote

    row = BalanceSpotTransaction(
        user_id=user_id,
        type=fill_type,
        amount=_to_decimal(trade.get("amount")),
        asset=base,
        executed_at=executed_at,
        external_id=external_id,
        pair=symbol,
        price=_to_decimal(trade.get("price")),
        quote_asset=quote,
        fee=_to_decimal(fee_cost) if fee_cost is not None else DECIMAL_ZERO,
        fee_asset=str(fee_asset).upper(),
        exchange_name=exchange_name,
        source=source,
    )
    db.add(row)
    return row


async def sync_balance_snapshots(
    db: Session,
    client,
    user_id: int,
    exchange_name: str = "binance",
) -> int:
    balance = await client.fetch_balance()
    now = datetime.now(tz=timezone.utc)
    count = 0

    free_map = balance.get("free") or {}
    used_map = balance.get("used") or {}
    total_map = balance.get("total") or {}

    assets = set(total_map.keys()) | set(free_map.keys())
    for asset in assets:
        total = _to_decimal(total_map.get(asset))
        if total <= DECIMAL_ZERO:
            continue

        free = _to_decimal(free_map.get(asset))
        locked = _to_decimal(used_map.get(asset))
        rate, fx_source = await get_asset_usdt_rate(client, asset.upper(), now)

        row = BalanceSpotTransaction(
            user_id=user_id,
            type="BALANCE_SNAPSHOT",
            amount=total,
            asset=asset.upper(),
            executed_at=now,
            external_id=f"snapshot-{asset.upper()}-{int(now.timestamp())}",
            free=free,
            locked=locked,
            exchange_name=exchange_name,
            source="rest",
            quote_to_usdt_rate=rate,
            fx_source=fx_source,
        )
        db.add(row)
        count += 1

    db.commit()
    return count


def _discover_trade_symbols(client, balance_assets: set[str]) -> list[str]:
    markets = client.markets or {}
    symbols: set[str] = set()

    for market_symbol, market in markets.items():
        if not isinstance(market, dict):
            continue
        if not market.get("spot", False):
            continue
        if not market.get("active", True):
            continue
        base = (market.get("base") or "").upper()
        if base in balance_assets or base not in STABLE_ASSETS:
            symbols.add(market_symbol)

    priority_quotes = ("USDT", "USDC", "BTC", "ETH", "BNB")
    result: list[str] = []
    for asset in balance_assets:
        if asset in STABLE_ASSETS:
            continue
        for quote in priority_quotes:
            sym = f"{asset}/{quote}"
            if sym in symbols:
                result.append(sym)
                break

    if not result:
        for sym in sorted(symbols):
            base = sym.split("/")[0]
            if base not in STABLE_ASSETS:
                result.append(sym)

    return sorted(set(result))


async def backfill_fills_for_symbol(
    client,
    db: Session,
    user_id: int,
    symbol: str,
    exchange_name: str = "binance",
    limit: int = 1000,
) -> int:
    inserted = 0
    since: Optional[int] = None

    while True:
        trades = await client.fetch_my_trades(
            symbol=symbol,
            since=since,
            limit=limit,
            params={"recvWindow": 60000},
        )
        if not trades:
            break

        for trade in trades:
            row = insert_fill_from_ccxt(db, user_id, trade, "rest", exchange_name)
            if row is not None:
                inserted += 1

        db.commit()

        if len(trades) < limit:
            break

        last_ts = trades[-1].get("timestamp")
        if last_ts is None:
            break
        since = int(last_ts) + 1

    return inserted


async def backfill_all_fills(
    db: Session,
    client,
    user_id: int,
    exchange_name: str = "binance",
) -> dict:
    balance = await client.fetch_balance()
    total_map = balance.get("total") or {}
    balance_assets = {
        k.upper()
        for k, v in total_map.items()
        if v and float(v) > 0
    }

    await client.load_markets()
    symbols = set(_discover_trade_symbols(client, balance_assets))

    existing_pairs = (
        db.query(BalanceSpotTransaction.pair)
        .filter(
            BalanceSpotTransaction.user_id == user_id,
            BalanceSpotTransaction.pair.isnot(None),
            BalanceSpotTransaction.type.in_(["BUY", "SELL"]),
        )
        .distinct()
        .all()
    )
    for (pair,) in existing_pairs:
        if pair:
            symbols.add(pair)

    total_inserted = 0
    symbols_with_trades = 0
    for symbol in sorted(symbols):
        try:
            count = await backfill_fills_for_symbol(
                client, db, user_id, symbol, exchange_name
            )
            if count > 0:
                symbols_with_trades += 1
                total_inserted += count
        except Exception:
            continue

    return {
        "fills_inserted": total_inserted,
        "symbols_scanned": len(symbols),
        "symbols_with_trades": symbols_with_trades,
    }
