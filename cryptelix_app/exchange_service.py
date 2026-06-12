import asyncio
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, List

import ccxt
import ccxt.async_support as ccxt_async
from sqlalchemy.orm import Session

from database import SessionLocal
from models import Trade, APIKey
from security import decrypt_data

logger = logging.getLogger("cryptelix")


class ApiKeyPermissionError(Exception):
    """The provided exchange API key fails the read-only safety policy (C3)."""


# Binance API-key permission flags that must NOT be enabled for a journaling app.
# The app only reads balances/trades, so trading and withdrawals are never needed.
_FORBIDDEN_BINANCE_PERMISSIONS = (
    "enableWithdrawals",
    "enableInternalTransfer",
    "enableSpotAndMarginTrading",
    "enableMargin",
    "enableFutures",
    "enableVanillaOptions",
)

_FORBIDDEN_PERMISSION_LABELS = {
    "enableWithdrawals": "withdrawals",
    "enableInternalTransfer": "internal transfer",
    "enableSpotAndMarginTrading": "spot & margin trading",
    "enableMargin": "margin",
    "enableFutures": "futures",
    "enableVanillaOptions": "options",
}


async def assert_binance_key_is_read_only(api_key: str, api_secret: str) -> None:
    """
    Verify that a Binance API key is read-only before it is stored (C3).

    Rejects keys that can trade or withdraw funds. This limits the blast radius:
    even if the encrypted key and master key were ever exposed, an attacker could
    at most read trade history, never move funds.

    Raises ApiKeyPermissionError with a user-facing message on any violation,
    invalid credentials, or if permissions cannot be verified (fail closed).
    """
    client = ccxt_async.binance(
        {
            "apiKey": api_key,
            "secret": api_secret,
            "enableRateLimit": True,
            "options": {"adjustForTimeDifference": True, "recvWindow": 15000},
        }
    )
    try:
        try:
            restrictions = await client.sapi_get_account_apirestrictions()
        except ccxt.AuthenticationError as exc:
            logger.warning("Binance key verification: auth error: %s", exc)
            raise ApiKeyPermissionError(
                "Invalid Binance API key or secret."
            ) from exc
        except ccxt.BaseError as exc:
            # Fail closed: if we cannot confirm the key is read-only, do not store it.
            # Logged in full so deployment-specific failures (e.g. Binance
            # geo-restriction on the host IP) are visible in server logs.
            logger.warning(
                "Binance key verification failed (%s): %s",
                type(exc).__name__,
                exc,
            )
            raise ApiKeyPermissionError(
                "Could not verify the API key permissions with Binance. "
                "Please try again."
            ) from exc

        if not _flag_is_true(restrictions.get("enableReading")):
            raise ApiKeyPermissionError(
                "The API key does not have read access. Enable only 'Enable Reading' "
                "when creating the key."
            )

        enabled_forbidden = [
            _FORBIDDEN_PERMISSION_LABELS[flag]
            for flag in _FORBIDDEN_BINANCE_PERMISSIONS
            if _flag_is_true(restrictions.get(flag))
        ]
        if enabled_forbidden:
            raise ApiKeyPermissionError(
                "For security, Cryptelix only accepts read-only API keys. "
                "This key has extra permissions enabled: "
                f"{', '.join(enabled_forbidden)}. "
                "Create a new Binance key with only 'Enable Reading' turned on."
            )
    finally:
        try:
            await client.close()
        except Exception:
            pass


def _flag_is_true(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes"}
    return False


class ExchangeService:
    """
    Asynchronous, multi-exchange service built on ccxt.async_support.

    For MVP we focus on Binance, but the same class can be used with
    any other ccxt exchange id (e.g. "bybit", "okx", etc.).
    """

    def __init__(
        self,
        exchange_id: str,
        db: Session,
        api_key: str,
        api_secret: str,
        user_id: int,
    ):
        self.exchange_id = exchange_id
        self.db = db
        self.user_id = user_id

        exchange_cls = getattr(ccxt_async, exchange_id, None)
        if exchange_cls is None:
            raise ValueError(f"Unsupported exchange_id: {exchange_id}")

        self.client = exchange_cls(
            {
                "apiKey": api_key,
                "secret": api_secret,
                "enableRateLimit": True,
                # Binance signed endpoints are sensitive to local clock drift.
                "options": {
                    "adjustForTimeDifference": True,
                    "recvWindow": 15000,
                },
            }
        )

    @classmethod
    def from_db_credentials(
        cls,
        exchange_name: str,
        db: Session,
        user_id: int,
    ) -> "ExchangeService":
        """
        Factory that pulls encrypted API credentials from the database.

        exchange_name corresponds to APIKey.exchange_name (e.g. "Binance").
        """
        api_key_row: Optional[APIKey] = (
            db.query(APIKey)
            .filter(
                APIKey.exchange_name.ilike(exchange_name),
                APIKey.user_id == user_id,
            )
            .first()
        )
        if api_key_row is None:
            raise ValueError(
                f"No API credentials found for exchange '{exchange_name}'. "
                "Insert an APIKey row before using this service."
            )

        decrypted_key = decrypt_data(api_key_row.api_key_encrypted)
        decrypted_secret = decrypt_data(api_key_row.api_secret_encrypted)

        # Map human-friendly name to ccxt id (simple normalization for MVP).
        exchange_id = exchange_name.strip().lower()

        return cls(
            exchange_id=exchange_id,
            db=db,
            user_id=user_id,
            api_key=decrypted_key,
            api_secret=decrypted_secret,
        )

    async def close(self) -> None:
        await self.client.close()

    async def _prepare_client_time(self) -> None:
        """
        Pre-sync local/client time with exchange server time.
        Helps avoid Binance -1021 timestamp drift errors.
        """
        try:
            await self.client.load_time_difference()
        except Exception:
            # Non-fatal: keep going with adjustForTimeDifference option.
            pass

    @staticmethod
    def _is_timestamp_error(exc: Exception) -> bool:
        text = str(exc)
        return "-1021" in text or "Timestamp for this request" in text

    async def _fetch_my_trades_with_retry(
        self,
        symbol: str | None,
        since: Optional[int],
        limit: int,
    ):
        last_error: Exception | None = None
        for _ in range(3):
            try:
                return await self.client.fetch_my_trades(
                    symbol=symbol,
                    since=since,
                    limit=limit,
                    params={"recvWindow": 60000},
                )
            except Exception as exc:
                last_error = exc
                if not self._is_timestamp_error(exc):
                    raise
                await self._prepare_client_time()
                # Give exchange/client a short moment after time re-sync.
                await asyncio.sleep(0.2)
        if last_error is not None:
            raise last_error
        # Unreachable guard for type-checkers.
        raise RuntimeError("Failed to fetch trades for unknown reason")

    async def fetch_and_sync_trades(
        self,
        symbol: str,
        since: Optional[int] = None,
        limit: int = 100,
        account_type: str = "spot",
    ) -> List[Trade]:
        """
        Fetch recent trades from the exchange and synchronize them into the database.

        - Uses ccxt's unified trade structure.
        - Deduplicates by exchange_trade_id to avoid double-counting.
        """
        await self.client.load_markets()
        await self._prepare_client_time()

        try:
            trades = await self._fetch_my_trades_with_retry(
                symbol=symbol,
                since=since,
                limit=limit,
            )
        except ccxt.AuthenticationError as exc:
            raise RuntimeError(f"Authentication with {self.exchange_id} failed.") from exc
        except ccxt.RateLimitExceeded as exc:
            raise RuntimeError(
                f"Rate limit exceeded while fetching trades from {self.exchange_id}."
            ) from exc
        except ccxt.NetworkError as exc:
            raise RuntimeError(
                f"Network error while communicating with {self.exchange_id}."
            ) from exc

        synced_trades = self._upsert_trades_from_ccxt(
            trades=trades,
            fallback_symbol=symbol,
            account_type=account_type,
        )

        if synced_trades:
            self.db.commit()

        return synced_trades

    async def fetch_and_sync_all_trades(
        self,
        since: Optional[int] = None,
        limit_per_request: int = 100,
        account_type: str = "spot",
    ) -> List[Trade]:
        """
        Sync all available user trades for the selected account type.

        For exchanges that support fetch_my_trades without symbol, use one request.
        For exchanges requiring symbol (Binance spot), fallback to per-market requests.
        """
        await self.client.load_markets()
        await self._prepare_client_time()
        synced_all: List[Trade] = []

        # Attempt global fetch first (works on some exchanges).
        try:
            trades = await self._fetch_my_trades_with_retry(
                symbol=None,
                since=since,
                limit=limit_per_request,
            )
            synced_all.extend(
                self._upsert_trades_from_ccxt(
                    trades=trades,
                    fallback_symbol=None,
                    account_type=account_type,
                )
            )
            if synced_all:
                self.db.commit()
            return synced_all
        except Exception:
            # Fallback path for exchanges that require symbol.
            pass

        # Binance spot fallback: iterate active spot symbols.
        markets = self.client.markets or {}
        symbols = []
        for market_symbol, market in markets.items():
            if not market_symbol or not isinstance(market, dict):
                continue
            if not market.get("active", True):
                continue
            if not market.get("spot", False):
                continue
            symbols.append(market_symbol)

        for market_symbol in symbols:
            try:
                trades = await self._fetch_my_trades_with_retry(
                    symbol=market_symbol,
                    since=since,
                    limit=limit_per_request,
                )
            except ccxt.BaseError:
                # Skip symbols that fail due to permissions/product restrictions.
                continue

            synced_all.extend(
                self._upsert_trades_from_ccxt(
                    trades=trades,
                    fallback_symbol=market_symbol,
                    account_type=account_type,
                )
            )

        if synced_all:
            self.db.commit()
        return synced_all

    def _upsert_trades_from_ccxt(
        self,
        trades: List[dict],
        fallback_symbol: str | None,
        account_type: str,
    ) -> List[Trade]:
        synced_trades: List[Trade] = []
        seen_batch_ids: set[str] = set()
        for t in trades:
            raw_id = t.get("id")
            if raw_id is None:
                continue
            exchange_trade_id = str(raw_id).strip()
            if not exchange_trade_id:
                continue
            if exchange_trade_id in seen_batch_ids:
                continue
            seen_batch_ids.add(exchange_trade_id)

            existing = (
                self.db.query(Trade)
                .filter(
                    Trade.exchange_trade_id == exchange_trade_id,
                    Trade.user_id == self.user_id,
                )
                .first()
            )
            if existing:
                continue

            timestamp = t.get("timestamp")
            dt = (
                datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc)
                if timestamp is not None
                else datetime.now(tz=timezone.utc)
            )
            side = (t.get("side") or "").capitalize() or "Long"
            price = Decimal(str(t.get("price") or 0))
            amount = Decimal(str(t.get("amount") or 0))
            fee_info = t.get("fee") or {}
            fee_cost = fee_info.get("cost")
            commission = Decimal(str(fee_cost)) if fee_cost is not None else Decimal("0")

            trade_obj = Trade(
                date=dt,
                pair=t.get("symbol") or fallback_symbol or "UNKNOWN",
                side=side,
                entry_price=price,
                exit_price=None,
                quantity=amount,
                pnl=None,
                commission=commission,
                notes=None,
                exchange_trade_id=exchange_trade_id,
                exchange_name=self.exchange_id,
                account_type=account_type,
                user_id=self.user_id,
            )
            self.db.add(trade_obj)
            synced_trades.append(trade_obj)
        return synced_trades


async def _test_binance_connection(
    symbol: str = "BTC/USDT", *, user_id: int = 1
) -> None:
    """
    Simple integration test for Binance.

    - Loads API credentials for 'Binance' from the database.
    - Prints account balance summary.
    - Prints last 3 trades for the provided symbol.
    """
    db: Session = SessionLocal()
    try:
        service = ExchangeService.from_db_credentials("Binance", db, user_id=user_id)
        try:
            await service.client.load_markets()

            # Fetch and print a simple balance overview
            balance = await service.client.fetch_balance()
            total_balance = {
                k: v
                for k, v in balance.get("total", {}).items()
                if v and float(v) != 0.0
            }
            print("Non-zero balances:")
            for asset, amount in total_balance.items():
                print(f"  {asset}: {amount}")

            # Fetch and print last 3 trades
            print(f"\nLast 3 trades for {symbol}:")
            trades = await service.client.fetch_my_trades(symbol=symbol, limit=3)
            for t in trades:
                ts = t.get("datetime") or t.get("timestamp")
                print(
                    f"  id={t.get('id')} time={ts} side={t.get('side')} "
                    f"price={t.get('price')} amount={t.get('amount')}"
                )
        finally:
            await service.close()
    finally:
        db.close()


if __name__ == "__main__":
    # Basic connectivity and auth test for Binance.
    asyncio.run(_test_binance_connection())