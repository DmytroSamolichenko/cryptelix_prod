from datetime import datetime, timedelta, timezone
from decimal import Decimal
import random

from database import DEFAULT_USER_ID, SessionLocal
from models import Trade


PAIRS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "DOT/USDT"]
SIDES = ["Long", "Short"]


def _random_date_within_last_days(days: int = 7) -> datetime:
    now = datetime.now(tz=timezone.utc)
    delta = timedelta(days=random.randint(0, days), hours=random.randint(0, 23), minutes=random.randint(0, 59))
    return now - delta


def _generate_mock_trades(num_trades: int = 10) -> list[Trade]:
    trades: list[Trade] = []

    for i in range(num_trades):
        pair = random.choice(PAIRS)
        side = random.choice(SIDES)

        entry_price = Decimal(str(round(random.uniform(10, 60000), 2)))
        # Make some trades profitable, some losing
        price_move = Decimal(str(round(random.uniform(-0.1, 0.1), 4)))  # +/-10%
        exit_price = entry_price * (Decimal("1") + price_move)

        quantity = Decimal(str(round(random.uniform(0.01, 5), 4)))

        # Simple PnL approximation: (exit - entry) * qty
        pnl = (exit_price - entry_price) * quantity

        # Small commission as 0.1% of notional
        commission = entry_price * quantity * Decimal("0.001")

        trade = Trade(
            date=_random_date_within_last_days(7),
            pair=pair,
            side=side,
            entry_price=entry_price,
            exit_price=exit_price,
            quantity=quantity,
            pnl=pnl,
            commission=commission,
            notes=None,
            exchange_trade_id=f"mock-binance-{i+1}",
            exchange_name="binance",
            user_id=DEFAULT_USER_ID,  # TODO: MULTI-USER-MIGRATION
        )
        trades.append(trade)

    return trades


def seed_trades(num_trades: int = 10) -> None:
    db = SessionLocal()
    try:
        trades = _generate_mock_trades(num_trades)
        for t in trades:
            db.add(t)
        db.commit()
        print("Seeding complete!")
    except Exception as exc:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_trades(10)

