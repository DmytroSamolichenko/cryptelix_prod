from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from database import SessionLocal
from models import Trade


DECIMAL_ZERO = Decimal("0")


@dataclass
class FinancialSummary:
    """Trading PnL summary derived from public.trades only."""

    start_balance: Decimal
    net_trading_pnl: Decimal
    net_transfers: Decimal
    current_equity: Decimal
    period_change_percent: Decimal | None


def _to_decimal(value) -> Decimal:
    if value is None:
        return DECIMAL_ZERO
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def get_user_financial_summary(
    db: Session,
    user_id: int,
    start_date: datetime | None = None,
) -> FinancialSummary:
    """
    Net trading performance from trades: Sum(pnl) - Sum(commission).

    Optional start_date limits trades by the `date` column (closed_at is unused).
    Legacy response fields start_balance and net_transfers are always zero.
    """
    trades_query = db.query(
        func.coalesce(func.sum(Trade.pnl), 0),
        func.coalesce(func.sum(Trade.commission), 0),
    ).filter(Trade.user_id == user_id)

    if start_date is not None:
        trades_query = trades_query.filter(Trade.date >= start_date)

    pnl_sum, commission_sum = trades_query.one()
    net_trading_pnl = _to_decimal(pnl_sum) - _to_decimal(commission_sum)

    return FinancialSummary(
        start_balance=DECIMAL_ZERO,
        net_trading_pnl=net_trading_pnl,
        net_transfers=DECIMAL_ZERO,
        current_equity=net_trading_pnl,
        period_change_percent=None,
    )


if __name__ == "__main__":
    session: Session = SessionLocal()
    try:
        summary = get_user_financial_summary(session, user_id=1)
        print("Net Trading PnL:", summary.net_trading_pnl)
        print("Current Equity:", summary.current_equity)
    finally:
        session.close()
