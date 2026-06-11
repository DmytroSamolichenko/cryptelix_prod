from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import BalanceSpotTransaction, PairInventory
from price_service import DECIMAL_ZERO, get_asset_usdt_rate

ORPHAN_THRESHOLD_USDT = Decimal("1")


def _to_decimal(value) -> Decimal:
    if value is None:
        return DECIMAL_ZERO
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _latest_balance_snapshots(
    db: Session,
    user_id: int,
) -> dict[str, Decimal]:
    subq = (
        db.query(
            BalanceSpotTransaction.asset,
            func.max(BalanceSpotTransaction.executed_at).label("max_at"),
        )
        .filter(
            BalanceSpotTransaction.user_id == user_id,
            BalanceSpotTransaction.type == "BALANCE_SNAPSHOT",
        )
        .group_by(BalanceSpotTransaction.asset)
        .subquery()
    )

    rows = (
        db.query(BalanceSpotTransaction)
        .join(
            subq,
            (BalanceSpotTransaction.asset == subq.c.asset)
            & (BalanceSpotTransaction.executed_at == subq.c.max_at),
        )
        .filter(
            BalanceSpotTransaction.user_id == user_id,
            BalanceSpotTransaction.type == "BALANCE_SNAPSHOT",
        )
        .all()
    )

    return {row.asset.upper(): _to_decimal(row.amount) for row in rows}


def _computed_base_inventory(db: Session, user_id: int) -> dict[str, Decimal]:
    rows = (
        db.query(PairInventory)
        .filter(PairInventory.user_id == user_id)
        .all()
    )
    totals: dict[str, Decimal] = {}
    for row in rows:
        asset = row.base_asset.upper()
        totals[asset] = totals.get(asset, DECIMAL_ZERO) + _to_decimal(row.qty)
    return totals


async def detect_orphans(
    db: Session,
    client,
    user_id: int,
) -> list[dict]:
    balance = _latest_balance_snapshots(db, user_id)
    computed = _computed_base_inventory(db, user_id)

    all_assets = set(balance.keys()) | set(computed.keys())
    orphans: list[dict] = []

    for asset in sorted(all_assets):
        balance_qty = balance.get(asset, DECIMAL_ZERO)
        computed_qty = computed.get(asset, DECIMAL_ZERO)
        orphan_qty = balance_qty - computed_qty
        if orphan_qty <= DECIMAL_ZERO:
            continue

        from datetime import datetime, timezone

        rate, _ = await get_asset_usdt_rate(client, asset, datetime.now(tz=timezone.utc))
        value_usdt = orphan_qty * rate

        if value_usdt < ORPHAN_THRESHOLD_USDT:
            continue

        orphans.append(
            {
                "asset": asset,
                "balance_qty": str(balance_qty),
                "computed_qty": str(computed_qty),
                "orphan_qty": str(orphan_qty),
                "estimated_value_usdt": str(value_usdt.quantize(Decimal("0.01"))),
                "needs_manual_cost": True,
            }
        )

    return orphans
