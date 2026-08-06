"""Which trades are visible given the user's currently connected exchange API keys.

Exchange-synced trades stay in the DB after disconnect; they are only hidden
from read APIs until the same exchange is connected again. Manual trades
always remain visible.
"""

from __future__ import annotations

from typing import Iterable

from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from sqlalchemy.sql import ColumnElement

from models import APIKey, Trade


def connected_exchange_names(db: Session, user_id: int) -> set[str]:
    rows = (
        db.query(APIKey.exchange_name)
        .filter(APIKey.user_id == user_id)
        .all()
    )
    return {
        str(name).strip().lower()
        for (name,) in rows
        if name and str(name).strip()
    }


def trade_is_visible(trade: Trade, connected: set[str]) -> bool:
    if bool(trade.is_manual):
        return True
    name = (trade.exchange_name or "").strip().lower()
    if not name:
        # Legacy / unscoped rows — keep visible.
        return True
    return name in connected


def filter_visible_trades(
    trades: Iterable[Trade], connected: set[str]
) -> list[Trade]:
    return [t for t in trades if trade_is_visible(t, connected)]


def visible_trades_sqlalchemy_filter(connected: set[str]) -> ColumnElement:
    """ORM filter: manual OR unscoped OR exchange currently connected."""
    manual = Trade.is_manual.is_(True)
    unscoped = or_(Trade.exchange_name.is_(None), Trade.exchange_name == "")
    if not connected:
        return or_(manual, unscoped)
    return or_(
        manual,
        unscoped,
        func.lower(Trade.exchange_name).in_(sorted(connected)),
    )
