"""Futures position aggregator (USDT-M + COIN-M).

Mirrors the spot WAC engine ([wac_engine.py]) but supports both directions
(long and short) and aggregates *flat-to-flat*: it walks unprocessed
`futures_fills` chronologically per (symbol, position_side), keeps a signed
running position in `futures_position_inventory` (long > 0, short < 0), and
emits one closed `trades` row every time a position returns to flat.

Key rules:
- PnL is **summed from Binance `realizedPnl`** (already in USD via realized_pnl_usd),
  never recomputed.
- Commission is summed (realized_pnl_usd / commission_usd are pre-converted at
  ingest time so COIN-M coin amounts are comparable to USDT-M).
- Funding is pulled from `futures_funding` for the position's open interval and
  folded into net PnL; net-excluding-funding is stored separately.
- A fill that crosses zero is split into a closing part (emits a trade) and an
  opening part (starts the new opposite position).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from models import FuturesFill, FuturesFunding, FuturesPositionInventory, Trade

logger = logging.getLogger("cryptelix")

ZERO = Decimal("0")
# Quantities/prices below this magnitude are treated as flat (dust from rounding).
EPS = Decimal("0.00000001")


def _to_decimal(value) -> Decimal:
    if value is None:
        return ZERO
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except Exception:
        return ZERO


def _sign(value: Decimal) -> int:
    if value > ZERO:
        return 1
    if value < ZERO:
        return -1
    return 0


def _ensure_utc(dt: datetime) -> datetime:
    if dt is None:
        return datetime.now(tz=timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _get_or_create_position(
    db: Session,
    user_id: int,
    market_type: str,
    symbol: str,
    pair: str,
    position_side: str,
) -> FuturesPositionInventory:
    inv = (
        db.query(FuturesPositionInventory)
        .filter(
            FuturesPositionInventory.user_id == user_id,
            FuturesPositionInventory.symbol == symbol,
            FuturesPositionInventory.position_side == position_side,
        )
        .first()
    )
    if inv is None:
        inv = FuturesPositionInventory(
            user_id=user_id,
            market_type=market_type,
            symbol=symbol,
            pair=pair,
            position_side=position_side,
            qty=ZERO,
            avg_entry_price=ZERO,
            realized_acc=ZERO,
            commission_acc=ZERO,
            close_qty_acc=ZERO,
            close_notional_acc=ZERO,
        )
        db.add(inv)
        db.flush()
    return inv


def _reset_position(inv: FuturesPositionInventory) -> None:
    inv.qty = ZERO
    inv.avg_entry_price = ZERO
    inv.opened_at = None
    inv.realized_acc = ZERO
    inv.commission_acc = ZERO
    inv.close_qty_acc = ZERO
    inv.close_notional_acc = ZERO


def _position_side_key(fill: FuturesFill) -> str:
    ps = (fill.position_side or "").strip().upper()
    if ps in ("LONG", "SHORT"):
        return ps
    return "BOTH"


def _funding_for_interval(
    db: Session,
    user_id: int,
    symbol: str,
    opened_at: Optional[datetime],
    closed_at: datetime,
) -> Decimal:
    """Sum funding income (USD) charged while the position was open.

    Binance convention: positive income = received, negative = paid. The value
    is added to net PnL as-is.
    """
    if opened_at is None:
        return ZERO
    rows = (
        db.query(FuturesFunding)
        .filter(
            FuturesFunding.user_id == user_id,
            FuturesFunding.symbol == symbol,
            FuturesFunding.executed_at >= opened_at,
            FuturesFunding.executed_at <= closed_at,
        )
        .all()
    )
    total = ZERO
    for r in rows:
        val = r.income_usd if r.income_usd is not None else r.income
        total += _to_decimal(val)
    return total


def _open_or_increase(
    inv: FuturesPositionInventory,
    amount: Decimal,
    price: Decimal,
    signed_dir: int,
    commission: Decimal,
    opened_at: datetime,
) -> None:
    """Add `amount` contracts in `signed_dir` to the position, updating the
    weighted-average entry price. Does not touch realized/exit accumulators."""
    cur_qty = _to_decimal(inv.qty)
    cur_abs = abs(cur_qty)
    if cur_abs <= EPS:
        inv.opened_at = opened_at
        inv.avg_entry_price = price
    else:
        new_abs = cur_abs + amount
        inv.avg_entry_price = (
            _to_decimal(inv.avg_entry_price) * cur_abs + price * amount
        ) / new_abs
    inv.qty = cur_qty + (amount if signed_dir > 0 else -amount)
    inv.commission_acc = _to_decimal(inv.commission_acc) + commission


def _emit_trade(
    db: Session,
    inv: FuturesPositionInventory,
    fill: FuturesFill,
    direction: str,
) -> Optional[Trade]:
    closed_at = _ensure_utc(fill.executed_at)
    opened_at = _ensure_utc(inv.opened_at) if inv.opened_at else closed_at

    close_qty = _to_decimal(inv.close_qty_acc)
    exit_price = (
        _to_decimal(inv.close_notional_acc) / close_qty if close_qty > ZERO else ZERO
    )
    realized = _to_decimal(inv.realized_acc)
    commission = _to_decimal(inv.commission_acc)
    funding = _funding_for_interval(
        db, inv.user_id, inv.symbol, inv.opened_at, closed_at
    )
    net_ex_funding = realized - commission
    net_pnl = net_ex_funding + funding

    exchange_trade_id = f"futagg-{fill.market_type}-{fill.external_id}"
    existing = (
        db.query(Trade)
        .filter(
            Trade.user_id == inv.user_id,
            Trade.exchange_trade_id == exchange_trade_id,
        )
        .first()
    )
    if existing is not None:
        return None

    trade = Trade(
        user_id=inv.user_id,
        exchange_trade_id=exchange_trade_id,
        exchange_name=fill.exchange_name or "binance",
        account_type="future",
        market_type=inv.market_type,
        date=closed_at.replace(tzinfo=None),
        closed_at=closed_at,
        pair=inv.pair,
        side=direction,
        entry_price=_to_decimal(inv.avg_entry_price),
        exit_price=exit_price,
        quantity=close_qty,
        pnl=net_pnl.quantize(Decimal("0.01")),
        net_pnl_ex_funding=net_ex_funding.quantize(Decimal("0.01")),
        funding=funding.quantize(Decimal("0.00000001")),
        commission=commission,
        is_manual=False,
        external_id=str(fill.external_id),
        custom_fields={
            "source": "futures_aggregated",
            "market_type": inv.market_type,
            "position_side": inv.position_side,
            "realized_pnl_usd": str(realized),
            "funding_usd": str(funding),
            "opened_at": opened_at.isoformat(),
        },
    )
    db.add(trade)
    return trade


def process_fill(db: Session, fill: FuturesFill) -> Optional[Trade]:
    """Fold one raw fill into its position; emit a closed trade on return to flat."""
    position_side = _position_side_key(fill)
    inv = _get_or_create_position(
        db,
        fill.user_id,
        fill.market_type,
        fill.symbol,
        fill.pair,
        position_side,
    )

    amount = abs(_to_decimal(fill.qty))
    price = _to_decimal(fill.price)
    realized = _to_decimal(
        fill.realized_pnl_usd if fill.realized_pnl_usd is not None else fill.realized_pnl
    )
    commission = _to_decimal(
        fill.commission_usd if fill.commission_usd is not None else fill.commission
    )
    side = (fill.side or "").strip().lower()
    fill_dir = 1 if side == "buy" else -1
    executed_at = _ensure_utc(fill.executed_at)

    if amount <= EPS:
        fill.processed_at = datetime.now(tz=timezone.utc)
        return None

    emitted: Optional[Trade] = None
    cur = _to_decimal(inv.qty)

    is_closing = abs(cur) > EPS and _sign(cur) != fill_dir
    if is_closing:
        close_amt = min(amount, abs(cur))
        frac_close = close_amt / amount if amount > ZERO else Decimal("1")

        inv.close_qty_acc = _to_decimal(inv.close_qty_acc) + close_amt
        inv.close_notional_acc = _to_decimal(inv.close_notional_acc) + price * close_amt
        inv.realized_acc = _to_decimal(inv.realized_acc) + realized
        inv.commission_acc = _to_decimal(inv.commission_acc) + commission * frac_close

        direction = "Long" if cur > ZERO else "Short"
        new_qty = cur + (close_amt if fill_dir > 0 else -close_amt)
        inv.qty = new_qty

        if abs(new_qty) <= EPS:
            emitted = _emit_trade(db, inv, fill, direction)
            _reset_position(inv)

        # Leftover opens a new position in the fill's direction (zero-cross).
        open_amt = amount - close_amt
        if open_amt > EPS:
            _open_or_increase(
                inv,
                open_amt,
                price,
                fill_dir,
                commission * (Decimal("1") - frac_close),
                executed_at,
            )
    else:
        # Opening from flat or increasing an existing position.
        inv.realized_acc = _to_decimal(inv.realized_acc) + realized
        _open_or_increase(inv, amount, price, fill_dir, commission, executed_at)

    inv.updated_at = datetime.now(tz=timezone.utc)
    fill.processed_at = datetime.now(tz=timezone.utc)
    return emitted


def process_all_unprocessed_fills(db: Session, user_id: int) -> dict:
    """Aggregate every unprocessed fill for a user, oldest first."""
    fills = (
        db.query(FuturesFill)
        .filter(
            FuturesFill.user_id == user_id,
            FuturesFill.processed_at.is_(None),
        )
        .order_by(FuturesFill.executed_at.asc(), FuturesFill.created_at.asc())
        .all()
    )

    fills_processed = 0
    trades_created = 0
    for fill in fills:
        trade = process_fill(db, fill)
        fills_processed += 1
        if trade is not None:
            trades_created += 1

    db.commit()
    return {
        "fills_processed": fills_processed,
        "trades_created": trades_created,
    }
