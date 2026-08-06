"""Binance Futures live user-data WebSocket (USDT-M + COIN-M).

Unlike spot (which uses the ws-api `userDataStream.subscribe` model in
[binance_ws_listener.py]), futures use the classic **listenKey** model on
separate hosts:

- USDT-M: create via ``POST /fapi/v1/listenKey``, stream at
  ``wss://fstream.binance.com/ws/<listenKey>`` (keepalive ``PUT`` ~every 30 min).
- COIN-M: create via ``POST /dapi/v1/listenKey``, stream at
  ``wss://dstream.binance.com/ws/<listenKey>``.

Each market runs its own loop and its own `binance_ws` row
(``futures_usdm`` / ``futures_coinm``). ``ORDER_TRADE_UPDATE`` fills are written
into ``futures_fills`` and immediately aggregated into closed trades via the
same aggregator used by the REST path. Funding (``FUNDING_FEE``) continues to be
imported by the REST resync — the account-update stream does not attribute it
cleanly per symbol.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import ccxt.async_support as ccxt_async
import websockets
from sqlalchemy.orm import Session

from database import SessionLocal
from futures_aggregator import process_all_unprocessed_fills
from futures_sync_service import (
    _display_pair,
    _market_type,
    _resolve_futures_market,
    _to_decimal,
)
from models import APIKey, BinanceWs, FuturesFill
from security import decrypt_data

logger = logging.getLogger("cryptelix")

# market label -> (stream host, account_type row, listenKey verb prefix)
_MARKETS = {
    "usdm": {
        "host": "wss://fstream.binance.com/ws/",
        "account_type": "futures_usdm",
        "default_type": "future",
        "create": "fapiPrivatePostListenKey",
        "keepalive": "fapiPrivatePutListenKey",
        "delete": "fapiPrivateDeleteListenKey",
    },
    "coinm": {
        "host": "wss://dstream.binance.com/ws/",
        "account_type": "futures_coinm",
        "default_type": "delivery",
        "create": "dapiPrivatePostListenKey",
        "keepalive": "dapiPrivatePutListenKey",
        "delete": "dapiPrivateDeleteListenKey",
    },
}

_KEEPALIVE_INTERVAL_S = 30 * 60
_RECONNECT_BASE_S = 5
_RECONNECT_MAX_S = 60

_running_tasks: dict[tuple[int, str], asyncio.Task] = {}
_stop_flags: dict[tuple[int, str], asyncio.Event] = {}


def _get_credentials(db: Session, user_id: int, exchange_name: str = "binance"):
    row = (
        db.query(APIKey)
        .filter(APIKey.user_id == user_id, APIKey.exchange_name == exchange_name)
        .first()
    )
    if row is None:
        return None, None
    return decrypt_data(row.api_key_encrypted), decrypt_data(row.api_secret_encrypted)


def _get_or_create_ws_row(db: Session, user_id: int, account_type: str) -> BinanceWs:
    row = (
        db.query(BinanceWs)
        .filter(BinanceWs.user_id == user_id, BinanceWs.account_type == account_type)
        .first()
    )
    if row is None:
        row = BinanceWs(user_id=user_id, account_type=account_type, ws_status="idle")
        db.add(row)
        db.flush()
    return row


def _set_ws_status(
    user_id: int,
    account_type: str,
    status: str,
    *,
    listen_key: Optional[str] = None,
    error: Optional[str] = None,
) -> None:
    db = SessionLocal()
    try:
        row = _get_or_create_ws_row(db, user_id, account_type)
        row.ws_status = status
        if listen_key is not None:
            row.listen_key = listen_key
            row.listen_key_updated_at = datetime.now(tz=timezone.utc)
        row.last_error = error
        db.commit()
    finally:
        db.close()


def _make_client(api_key: str, api_secret: str, default_type: str):
    return ccxt_async.binance(
        {
            "apiKey": api_key,
            "secret": api_secret,
            "enableRateLimit": True,
            "options": {
                "defaultType": default_type,
                "adjustForTimeDifference": True,
                "recvWindow": 15000,
            },
        }
    )


def _insert_ws_fill(
    db: Session,
    user_id: int,
    market_label: str,
    order: dict,
    client,
) -> bool:
    """Map an ORDER_TRADE_UPDATE 'o' object (execution type TRADE) to a fill."""
    raw_symbol = (order.get("s") or "").strip()
    trade_id = order.get("t")
    if trade_id is None:
        return False
    external_id = str(trade_id).strip()
    if not external_id or external_id in ("0", "-1"):
        return False

    market = _resolve_futures_market(client, raw_symbol)
    market_type = _market_type(market) if market else market_label
    symbol = market.get("symbol") if market else raw_symbol
    pair = _display_pair(symbol)

    existing = (
        db.query(FuturesFill)
        .filter(
            FuturesFill.user_id == user_id,
            FuturesFill.market_type == market_type,
            FuturesFill.external_id == external_id,
        )
        .first()
    )
    if existing:
        return False

    price = _to_decimal(order.get("L") or order.get("ap") or order.get("p"))
    amount = _to_decimal(order.get("l") or order.get("q"))
    realized_raw = _to_decimal(order.get("rp"))
    commission_raw = _to_decimal(order.get("n"))
    time_ms = int(order.get("T") or order.get("E") or 0)
    executed_at = (
        datetime.fromtimestamp(time_ms / 1000, tz=timezone.utc)
        if time_ms
        else datetime.now(tz=timezone.utc)
    )

    if market_type == "coinm":
        realized_usd = realized_raw * price
        commission_usd = commission_raw * price
    else:
        realized_usd = realized_raw
        commission_usd = commission_raw

    db.add(
        FuturesFill(
            user_id=user_id,
            exchange_name="binance",
            market_type=market_type,
            symbol=symbol,
            pair=pair,
            external_id=external_id,
            order_id=str(order.get("i")) if order.get("i") is not None else None,
            side=(order.get("S") or "").strip().lower() or "buy",
            position_side=order.get("ps"),
            price=price,
            qty=amount,
            realized_pnl=realized_raw,
            commission=commission_raw,
            commission_asset=order.get("N"),
            realized_pnl_usd=realized_usd,
            commission_usd=commission_usd,
            executed_at=executed_at,
            source="websocket",
        )
    )
    return True


async def _handle_event(user_id: int, market_label: str, event: dict, client) -> None:
    if event.get("e") != "ORDER_TRADE_UPDATE":
        return
    order = event.get("o") or {}
    if order.get("x") != "TRADE":
        return

    db = SessionLocal()
    try:
        inserted = _insert_ws_fill(db, user_id, market_label, order, client)
        if inserted:
            db.commit()
            process_all_unprocessed_fills(db, user_id)
    except Exception as exc:
        db.rollback()
        logger.exception("Futures WS fill handling failed: %s", exc)
    finally:
        db.close()


async def _keepalive_loop(client, market_label: str, stop_event: asyncio.Event) -> None:
    method_name = _MARKETS[market_label]["keepalive"]
    method = getattr(client, method_name, None)
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=_KEEPALIVE_INTERVAL_S)
        except asyncio.TimeoutError:
            pass
        if stop_event.is_set():
            break
        if method is not None:
            try:
                await method()
            except Exception as exc:
                logger.warning("Futures listenKey keepalive [%s] failed: %s", market_label, exc)


async def _ws_loop(user_id: int, market_label: str) -> None:
    cfg = _MARKETS[market_label]
    account_type = cfg["account_type"]
    key = (user_id, market_label)
    stop_event = _stop_flags.get(key)

    db = SessionLocal()
    try:
        api_key, api_secret = _get_credentials(db, user_id)
    finally:
        db.close()
    if not api_key or not api_secret:
        _set_ws_status(user_id, account_type, "error", error="No API key found")
        return

    backoff = _RECONNECT_BASE_S
    while stop_event and not stop_event.is_set():
        client = _make_client(api_key, api_secret, cfg["default_type"])
        keepalive_task: Optional[asyncio.Task] = None
        try:
            await client.load_markets()
            create = getattr(client, cfg["create"], None)
            if create is None:
                _set_ws_status(user_id, account_type, "error", error="listenKey unsupported")
                return
            resp = await create()
            listen_key = (resp or {}).get("listenKey")
            if not listen_key:
                raise RuntimeError("Empty listenKey from Binance")

            url = cfg["host"] + listen_key
            async with websockets.connect(url, ping_interval=180, ping_timeout=60) as ws:
                _set_ws_status(
                    user_id, account_type, "connected", listen_key=listen_key, error=None
                )
                backoff = _RECONNECT_BASE_S
                keepalive_task = asyncio.create_task(
                    _keepalive_loop(client, market_label, stop_event)
                )

                while stop_event and not stop_event.is_set():
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=60)
                    except asyncio.TimeoutError:
                        continue
                    try:
                        event = json.loads(raw)
                    except (ValueError, TypeError):
                        continue
                    if event.get("e") == "listenKeyExpired":
                        logger.warning("Futures listenKey expired [%s]", market_label)
                        break
                    await _handle_event(user_id, market_label, event, client)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Futures WS loop [%s] error: %s", market_label, exc)
            _set_ws_status(user_id, account_type, "reconnecting", error=str(exc))
        finally:
            if keepalive_task is not None:
                keepalive_task.cancel()
                try:
                    await keepalive_task
                except (asyncio.CancelledError, Exception):
                    pass
            try:
                await client.close()
            except Exception:
                pass

        if stop_event and not stop_event.is_set():
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, _RECONNECT_MAX_S)


async def start_futures_ws(user_id: int, markets: Optional[list[str]] = None) -> None:
    """Start (or restart) the futures user-data streams for the given markets."""
    targets = markets or list(_MARKETS.keys())
    for market_label in targets:
        if market_label not in _MARKETS:
            continue
        await stop_futures_ws(user_id, [market_label])
        key = (user_id, market_label)
        stop_event = asyncio.Event()
        _stop_flags[key] = stop_event
        _set_ws_status(user_id, _MARKETS[market_label]["account_type"], "reconnecting")
        _running_tasks[key] = asyncio.create_task(_ws_loop(user_id, market_label))


async def stop_futures_ws(user_id: int, markets: Optional[list[str]] = None) -> None:
    targets = markets or list(_MARKETS.keys())
    for market_label in targets:
        key = (user_id, market_label)
        stop_event = _stop_flags.pop(key, None)
        if stop_event:
            stop_event.set()
        task = _running_tasks.pop(key, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        account_type = _MARKETS[market_label]["account_type"]
        db = SessionLocal()
        try:
            row = (
                db.query(BinanceWs)
                .filter(
                    BinanceWs.user_id == user_id,
                    BinanceWs.account_type == account_type,
                )
                .first()
            )
            if row:
                row.ws_status = "stopped"
                row.listen_key = None
                db.commit()
        finally:
            db.close()


def get_futures_ws_status(user_id: int) -> dict:
    db = SessionLocal()
    try:
        out = {}
        for market_label, cfg in _MARKETS.items():
            row = (
                db.query(BinanceWs)
                .filter(
                    BinanceWs.user_id == user_id,
                    BinanceWs.account_type == cfg["account_type"],
                )
                .first()
            )
            out[market_label] = (
                {"ws_status": "idle"}
                if row is None
                else {
                    "ws_status": row.ws_status,
                    "listen_key_updated_at": (
                        row.listen_key_updated_at.isoformat()
                        if row.listen_key_updated_at
                        else None
                    ),
                    "last_error": row.last_error,
                }
            )
        return out
    finally:
        db.close()
