"""Idempotent schema patches applied at API startup."""

from sqlalchemy import text

from database import engine


def ensure_balance_spot_constraints() -> None:
    """
    After renaming balance_transactions -> balance_spot_transactions,
    PostgreSQL keeps the old CHECK (DEPOSIT/WITHDRAWAL only).
    Both constraints must not coexist — drop the legacy one.
    """
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE balance_spot_transactions "
                "DROP CONSTRAINT IF EXISTS balance_transactions_type_check"
            )
        )
        # Legacy single-user constraint: external_id was globally unique.
        # In multi-user mode the same Binance trade id can appear for
        # different users, so per-user uniqueness (created in
        # ensure_multi_user_constraints) is what we keep — drop the global one.
        conn.execute(
            text(
                "ALTER TABLE balance_spot_transactions "
                "DROP CONSTRAINT IF EXISTS balance_transactions_external_id_key"
            )
        )
        conn.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'balance_spot_transactions_type_check'
                          AND conrelid = 'balance_spot_transactions'::regclass
                    ) THEN
                        ALTER TABLE balance_spot_transactions
                            ADD CONSTRAINT balance_spot_transactions_type_check
                            CHECK (
                                type IN (
                                    'BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL',
                                    'BALANCE_SNAPSHOT', 'OPENING_LOT'
                                )
                            );
                    END IF;
                END $$;
                """
            )
        )


def ensure_multi_user_constraints() -> None:
    """Per-user uniqueness for trades, inventory, ws sessions, and spot fills."""
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_exchange_trade_id_key"
            )
        )
        # Legacy single-user index: exchange_trade_id was globally unique.
        # In multi-user mode the same exchange_trade_id (e.g. wac-<id>) can
        # appear for different users, so per-user uniqueness below is what we
        # keep. Re-create it as a plain (non-unique) lookup index to match the
        # model's index=True intent and preserve query performance.
        conn.execute(text("DROP INDEX IF EXISTS ix_trades_exchange_trade_id"))
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_trades_exchange_trade_id "
                "ON trades (exchange_trade_id)"
            )
        )
        # Legacy global unique on username breaks multi-user activation when two
        # invited users share the same display name. The model does not declare
        # username unique, so drop it.
        conn.execute(
            text("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key")
        )
        conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS trades_user_exchange_trade_id_unique
                    ON trades (user_id, exchange_trade_id)
                    WHERE exchange_trade_id IS NOT NULL
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS pair_inventory_user_pair_unique
                    ON pair_inventory (user_id, pair)
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS binance_ws_user_account_unique
                    ON binance_ws (user_id, account_type)
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS balance_spot_user_exchange_external_unique
                    ON balance_spot_transactions (user_id, exchange_name, external_id)
                    WHERE external_id IS NOT NULL
                """
            )
        )
