from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from database import DEFAULT_USER_ID, SessionLocal
from models import Trade, BalanceTransaction, AccountSnapshot


DECIMAL_ZERO = Decimal("0")


@dataclass
class FinancialSummary:
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
    start_date: datetime | None = None,
) -> FinancialSummary:
    """
    Hybrid accounting calculation engine.

    - Net Trading PnL = Sum(pnl) - Sum(commission) from trades.
    - Net Transfers = Sum(DEPOSIT.amount) - Sum(WITHDRAWAL.amount) from balance_transactions.
    - If start_date is provided:
        * Only include trades with closed_at >= start_date.
        * Only include balance_transactions with executed_at >= start_date.
        * Start Balance is treated as 0 (relative performance for period).
    - If start_date is not provided:
        * Start Balance = most recent account_snapshots.total_balance by captured_at (or 0 if none).
        * Only include trades / transactions at or after that snapshot's captured_at (if any).
    - Current Equity = Start Balance + Net Trading PnL + Net Transfers.
    - period_change_percent = percentage change relative to balance at the beginning
      of the selected period (None if the starting balance is <= 0).
    """
    # Determine the temporal filter and starting balance
    if start_date is not None:
        # Period mode: ignore snapshots; relative performance from start_date
        start_balance = DECIMAL_ZERO
        filter_start = start_date
    else:
        # All-time mode: latest snapshot + everything after it
        latest_snapshot: AccountSnapshot | None = (
            db.query(AccountSnapshot)
            .filter(
                AccountSnapshot.user_id == DEFAULT_USER_ID,  # TODO: MULTI-USER-MIGRATION
            )
            .order_by(AccountSnapshot.captured_at.desc())
            .first()
        )
        if latest_snapshot:
            start_balance = _to_decimal(latest_snapshot.total_balance)
            filter_start = latest_snapshot.captured_at
        else:
            start_balance = DECIMAL_ZERO
            filter_start = None

    # Net Trading PnL
    trades_query = db.query(
        func.coalesce(func.sum(Trade.pnl), 0),
        func.coalesce(func.sum(Trade.commission), 0),
    ).filter(Trade.user_id == DEFAULT_USER_ID)  # TODO: MULTI-USER-MIGRATION
    if filter_start is not None:
        trades_query = trades_query.filter(Trade.closed_at >= filter_start)

    pnl_sum, commission_sum = trades_query.one()
    total_pnl = _to_decimal(pnl_sum)
    total_commission = _to_decimal(commission_sum)
    net_trading_pnl = total_pnl - total_commission

    # Net Transfers
    deposit_query = db.query(func.coalesce(func.sum(BalanceTransaction.amount), 0)).filter(
        BalanceTransaction.type == "DEPOSIT",
        BalanceTransaction.user_id == DEFAULT_USER_ID,  # TODO: MULTI-USER-MIGRATION
    )
    withdrawal_query = db.query(
        func.coalesce(func.sum(BalanceTransaction.amount), 0)
    ).filter(
        BalanceTransaction.type == "WITHDRAWAL",
        BalanceTransaction.user_id == DEFAULT_USER_ID,  # TODO: MULTI-USER-MIGRATION
    )

    if filter_start is not None:
        deposit_query = deposit_query.filter(
            BalanceTransaction.executed_at >= filter_start
        )
        withdrawal_query = withdrawal_query.filter(
            BalanceTransaction.executed_at >= filter_start
        )

    deposit_sum = deposit_query.scalar()
    withdrawal_sum = withdrawal_query.scalar()

    total_deposits = _to_decimal(deposit_sum)
    total_withdrawals = _to_decimal(withdrawal_sum)
    net_transfers = total_deposits - total_withdrawals

    current_equity = start_balance + net_trading_pnl + net_transfers

    # Percentage change relative to the balance at the beginning of the period
    # For explicit start_date, the starting equity is treated as 0; in that case
    # we cannot compute a meaningful percentage and return None.
    starting_equity = start_balance if start_date is None else DECIMAL_ZERO
    period_pnl = net_trading_pnl + net_transfers
    if starting_equity > DECIMAL_ZERO:
        period_change_percent = (period_pnl / starting_equity) * Decimal("100")
    else:
        period_change_percent = None

    return FinancialSummary(
        start_balance=start_balance,
        net_trading_pnl=net_trading_pnl,
        net_transfers=net_transfers,
        current_equity=current_equity,
        period_change_percent=period_change_percent,
    )


def create_account_snapshot(db: Session) -> AccountSnapshot:
    """
    Persist a new AccountSnapshot using the current calculated equity.
    """
    summary = get_user_financial_summary(db)
    snapshot = AccountSnapshot(
        total_balance=summary.current_equity,
        captured_at=datetime.now(tz=timezone.utc),
        user_id=DEFAULT_USER_ID,  # TODO: MULTI-USER-MIGRATION
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


if __name__ == "__main__":
    # Simple manual test for the calculation engine.
    session: Session = SessionLocal()
    try:
        summary = get_user_financial_summary(session)
        print("Start Balance:", summary.start_balance)
        print("Net Trading PnL:", summary.net_trading_pnl)
        print("Net Transfers:", summary.net_transfers)
        print("Current Equity:", summary.current_equity)

        snapshot = create_account_snapshot(session)
        print("\nNew snapshot saved:")
        print("  id:", snapshot.id)
        print("  total_balance:", snapshot.total_balance)
        print("  captured_at:", snapshot.captured_at)
    finally:
        session.close()

