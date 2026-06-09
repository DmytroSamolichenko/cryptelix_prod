from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

STABLE_ASSETS = frozenset({"USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI", "USDP"})
DECIMAL_ZERO = Decimal("0")
DECIMAL_ONE = Decimal("1")


def _to_decimal(value) -> Decimal:
    if value is None:
        return DECIMAL_ZERO
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


async def get_asset_usdt_rate(
    client,
    asset: str,
    at: datetime,
) -> tuple[Decimal, str]:
    """
    Return (rate_usdt, fx_source) for 1 unit of asset in USDT at `at`.
    """
    asset = (asset or "").strip().upper()
    if not asset or asset in STABLE_ASSETS:
        return DECIMAL_ONE, "stable"

    markets = client.markets or {}
    since_ms = int(at.timestamp() * 1000)

    direct = f"{asset}/USDT"
    if direct in markets:
        rate = await _kline_close(client, direct, since_ms)
        if rate > DECIMAL_ZERO:
            return rate, "direct"

    via_btc = f"{asset}/BTC"
    if via_btc in markets:
        asset_btc = await _kline_close(client, via_btc, since_ms)
        btc_usdt = await _kline_close(client, "BTC/USDT", since_ms)
        if asset_btc > DECIMAL_ZERO and btc_usdt > DECIMAL_ZERO:
            return asset_btc * btc_usdt, "via_btc"

    via_eth = f"{asset}/ETH"
    if via_eth in markets:
        asset_eth = await _kline_close(client, via_eth, since_ms)
        eth_usdt = await _kline_close(client, "ETH/USDT", since_ms)
        if asset_eth > DECIMAL_ZERO and eth_usdt > DECIMAL_ZERO:
            return asset_eth * eth_usdt, "via_eth"

    return DECIMAL_ZERO, "unknown"


async def get_quote_usdt_rate(
    client,
    quote_asset: str,
    at: datetime,
) -> tuple[Decimal, str]:
    return await get_asset_usdt_rate(client, quote_asset, at)


async def _kline_close(client, symbol: str, since_ms: int) -> Decimal:
    try:
        candles = await client.fetch_ohlcv(symbol, "1m", since=since_ms, limit=1)
        if candles:
            return _to_decimal(candles[0][4])
    except Exception:
        pass
    try:
        ticker = await client.fetch_ticker(symbol)
        last = ticker.get("last") or ticker.get("close")
        if last is not None:
            return _to_decimal(last)
    except Exception:
        pass
    return DECIMAL_ZERO


async def fee_to_usdt(
    client,
    fee_amount: Decimal,
    fee_asset: str,
    at: datetime,
) -> Decimal:
    if fee_amount <= DECIMAL_ZERO:
        return DECIMAL_ZERO
    rate, _ = await get_asset_usdt_rate(client, fee_asset, at)
    return fee_amount * rate


async def convert_quote_to_usdt(
    client,
    amount: Decimal,
    quote_asset: str,
    at: datetime,
) -> Decimal:
    rate, _ = await get_quote_usdt_rate(client, quote_asset, at)
    return amount * rate


def ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
