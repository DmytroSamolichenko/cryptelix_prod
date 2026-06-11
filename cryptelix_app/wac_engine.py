from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from models import BalanceSpotTransaction, PairInventory, Trade
from price_service import (
    DECIMAL_ZERO,
    convert_quote_to_usdt,
    ensure_utc,
    fee_to_usdt,
    get_quote_usdt_rate,
)

FILL_TYPES = frozenset({"BUY", "SELL"})


def _to_decimal(value) -> Decimal:
    if value is None:
        return DECIMAL_ZERO
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _parse_pair(pair: str) -> tuple[str, str]:
    parts = (pair or "").split("/")
    if len(parts) != 2:
        raise ValueError(f"Invalid pair: {pair}")
    return parts[0].strip().upper(), parts[1].strip().upper()


def _get_or_create_inventory(
    db: Session,
    user_id: int,
    pair: str,
) -> PairInventory:
    base, quote = _parse_pair(pair)
    inv = (
        db.query(PairInventory)
        .filter(PairInventory.user_id == user_id, PairInventory.pair == pair)
        .first()
    )
    if inv is None:
        inv = PairInventory(
            user_id=user_id,
            pair=pair,
            base_asset=base,
            quote_asset=quote,
            qty=DECIMAL_ZERO,
            total_cost=DECIMAL_ZERO,
            avg_entry_price=DECIMAL_ZERO,
            fee_pool=DECIMAL_ZERO,
        )
        db.add(inv)
        db.flush()
    return inv


def _apply_buy(inv: PairInventory, amount: Decimal, price: Decimal, fee_quote: Decimal) -> None:
    cost = amount * price
    inv.qty = _to_decimal(inv.qty) + amount
    inv.total_cost = _to_decimal(inv.total_cost) + cost
    inv.fee_pool = _to_decimal(inv.fee_pool) + fee_quote
    if inv.qty > DECIMAL_ZERO:
        inv.avg_entry_price = inv.total_cost / inv.qty
    else:
        inv.avg_entry_price = DECIMAL_ZERO


def _create_journal_trade(
    db: Session,
    user_id: int,
    pair: str,
    entry: Decimal,
    exit_price: Decimal,
    quantity: Decimal,
    commission: Decimal,
    executed_at: datetime,
    source_txn: BalanceSpotTransaction,
    quote_usdt_rate: Decimal,
) -> Optional[Trade]:
    gross = (exit_price - entry) * quantity
    net_pnl = gross - commission
    pnl_usdt = net_pnl * quote_usdt_rate if quote_usdt_rate > DECIMAL_ZERO else None

    exchange_trade_id = f"wac-{source_txn.external_id}"
    existing = (
        db.query(Trade)
        .filter(
            Trade.user_id == user_id,
            Trade.exchange_trade_id == exchange_trade_id,
        )
        .first()
    )
    if existing:
        return None

    closed = ensure_utc(executed_at)
    trade = Trade(
        user_id=user_id,
        exchange_trade_id=exchange_trade_id,
        exchange_name=source_txn.exchange_name or "binance",
        account_type="spot",
        date=closed.replace(tzinfo=None),
        closed_at=closed,
        pair=pair,
        side="Long",
        entry_price=entry,
        exit_price=exit_price,
        quantity=quantity,
        pnl=net_pnl.quantize(Decimal("0.01")),
        commission=commission,
        is_manual=False,
        external_id=source_txn.external_id,
        custom_fields={
            "aggregation_method": "wac",
            "source_balance_txn_id": str(source_txn.id),
            "pnl_usdt": str(pnl_usdt) if pnl_usdt is not None else None,
            "quote_asset": source_txn.quote_asset,
            "quote_to_usdt_rate": str(quote_usdt_rate),
        },
    )
    db.add(trade)
    return trade


def _apply_sell(
    db: Session,
    inv: PairInventory,
    amount: Decimal,
    exit_price: Decimal,
    sell_fee_quote: Decimal,
    txn: BalanceSpotTransaction,
    quote_usdt_rate: Decimal,
) -> Optional[Trade]:
    inv_qty = _to_decimal(inv.qty)
    if inv_qty <= DECIMAL_ZERO:
        return None

    sell_qty = min(amount, inv_qty)
    if sell_qty <= DECIMAL_ZERO:
        return None

    avg_entry = _to_decimal(inv.avg_entry_price)
    fee_pool = _to_decimal(inv.fee_pool)
    allocated_buy_fee = (
        fee_pool * (sell_qty / inv_qty) if inv_qty > DECIMAL_ZERO else DECIMAL_ZERO
    )
    total_commission = allocated_buy_fee + sell_fee_quote

    trade = _create_journal_trade(
        db=db,
        user_id=txn.user_id,
        pair=txn.pair or inv.pair,
        entry=avg_entry,
        exit_price=exit_price,
        quantity=sell_qty,
        commission=total_commission,
        executed_at=txn.executed_at,
        source_txn=txn,
        quote_usdt_rate=quote_usdt_rate,
    )

    inv.qty = inv_qty - sell_qty
    inv.fee_pool = fee_pool - allocated_buy_fee
    if inv.qty > DECIMAL_ZERO:
        inv.total_cost = inv.avg_entry_price * inv.qty
    else:
        inv.total_cost = DECIMAL_ZERO
        inv.avg_entry_price = DECIMAL_ZERO
        inv.fee_pool = DECIMAL_ZERO

    return trade


async def enrich_fill_fx(client, txn: BalanceSpotTransaction) -> None:
    at = ensure_utc(txn.executed_at)
    quote = (txn.quote_asset or "").upper()
    rate, fx_source = await get_quote_usdt_rate(client, quote, at)
    txn.quote_to_usdt_rate = rate
    txn.fx_source = fx_source

    fee = _to_decimal(txn.fee)
    fee_asset = txn.fee_asset or quote
    txn.fee_usdt = await fee_to_usdt(client, fee, fee_asset, at)


async def process_fill_transaction(
    db: Session,
    client,
    txn: BalanceSpotTransaction,
) -> Optional[Trade]:
    if txn.type not in FILL_TYPES or txn.processed_at is not None:
        return None
    if not txn.pair or txn.price is None:
        return None

    await enrich_fill_fx(client, txn)

    amount = _to_decimal(txn.amount)
    price = _to_decimal(txn.price)
    fee = _to_decimal(txn.fee)
    quote_rate = _to_decimal(txn.quote_to_usdt_rate)

    inv = _get_or_create_inventory(db, txn.user_id, txn.pair)
    trade: Optional[Trade] = None

    if txn.type == "BUY":
        _apply_buy(inv, amount, price, fee)
    elif txn.type == "SELL":
        trade = _apply_sell(db, inv, amount, price, fee, txn, quote_rate)

    txn.processed_at = datetime.now(tz=timezone.utc)
    return trade


async def process_all_unprocessed_fills(
    db: Session,
    client,
    user_id: int,
) -> dict:
    rows: list[BalanceSpotTransaction] = (
        db.query(BalanceSpotTransaction)
        .filter(
            BalanceSpotTransaction.user_id == user_id,
            BalanceSpotTransaction.type.in_(list(FILL_TYPES)),
            BalanceSpotTransaction.processed_at.is_(None),
        )
        .order_by(BalanceSpotTransaction.executed_at.asc())
        .all()
    )

    trades_created = 0
    fills_processed = 0
    for txn in rows:
        trade = await process_fill_transaction(db, client, txn)
        fills_processed += 1
        if trade is not None:
            trades_created += 1

    db.commit()
    return {
        "fills_processed": fills_processed,
        "trades_created": trades_created,
    }


async def process_single_fill_by_id(
    db: Session,
    client,
    txn_id: UUID,
) -> Optional[Trade]:
    txn = db.query(BalanceSpotTransaction).filter(BalanceSpotTransaction.id == txn_id).first()
    if txn is None:
        return None
    trade = await process_fill_transaction(db, client, txn)
    db.commit()
    return trade
