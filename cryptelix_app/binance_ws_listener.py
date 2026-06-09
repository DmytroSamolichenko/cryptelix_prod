from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

import websockets
from sqlalchemy.orm import Session

from database import DEFAULT_USER_ID, SessionLocal
from models import APIKey, BinanceWs, BalanceSpotTransaction
from security import decrypt_data
from spot_sync_service import insert_fill_from_ccxt
from wac_engine import process_fill_transaction

logger = logging.getLogger(__name__)

BINANCE_WS_API_URL = "wss://ws-api.binance.com:443/ws-api/v3"

_running_tasks: dict[tuple[int, str], asyncio.Task] = {}
_stop_flags: dict[tuple[int, str], asyncio.Event] = {}
_connected_events: dict[tuple[int, str], asyncio.Event] = {}
_connect_errors: dict[tuple[int, str], Exception] = {}


def _to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def _sign_params(params: dict, secret: str) -> str:
    payload = "&".join(f"{k}={params[k]}" for k in sorted(params.keys()))
    return hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _binance_symbol_to_pair(symbol: str) -> str:
    symbol = (symbol or "").upper()
    for quote in ("USDT", "USDC", "BUSD", "FDUSD", "BTC", "ETH", "BNB"):
        if symbol.endswith(quote) and len(symbol) > len(quote):
            return f"{symbol[: -len(quote)]}/{quote}"
    return symbol


def _get_credentials(db: Session, user_id: int, exchange_name: str = "binance"):
    row = (
        db.query(APIKey)
        .filter(
            APIKey.user_id == user_id,
            APIKey.exchange_name == exchange_name,
        )
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


def _insert_balance_update(
    db: Session,
    user_id: int,
    asset: str,
    delta: Decimal,
    executed_at: datetime,
) -> None:
    if delta == 0:
        return
    txn_type = "DEPOSIT" if delta > 0 else "WITHDRAWAL"
    row = BalanceSpotTransaction(
        user_id=user_id,
        type=txn_type,
        amount=abs(delta),
        asset=asset.upper(),
        executed_at=executed_at,
        external_id=f"ws-bal-{asset}-{int(executed_at.timestamp() * 1000)}",
        exchange_name="binance",
        source="websocket",
    )
    db.add(row)


async def _subscribe_user_data_stream(ws, api_key: str, api_secret: str) -> int:
    request_id = str(uuid.uuid4())
    timestamp = int(time.time() * 1000)
    params = {"apiKey": api_key, "timestamp": timestamp}
    params["signature"] = _sign_params(params, api_secret)

    await ws.send(
        json.dumps(
            {
                "id": request_id,
                "method": "userDataStream.subscribe.signature",
                "params": params,
            }
        )
    )

    while True:
        raw = await ws.recv()
        payload = json.loads(raw)
        if payload.get("id") == request_id:
            if payload.get("status") != 200:
                raise RuntimeError(
                    f"userDataStream.subscribe.signature failed: {payload}"
                )
            return int(payload["result"]["subscriptionId"])
        # ignore push events before subscribe ack


async def _handle_event(
    db: Session,
    exchange_client,
    user_id: int,
    event: dict,
) -> None:
    event_type = event.get("e")

    if event_type == "executionReport":
        if event.get("x") != "TRADE":
            return
        trade_id = event.get("t")
        if trade_id is None or int(trade_id) < 0:
            return

        symbol = _binance_symbol_to_pair(event.get("s", ""))
        side = (event.get("S") or "").lower()
        executed_at = datetime.fromtimestamp(
            int(event.get("T", 0)) / 1000,
            tz=timezone.utc,
        )
        ccxt_trade = {
            "id": str(trade_id),
            "symbol": symbol,
            "side": side,
            "price": event.get("L") or event.get("p"),
            "amount": event.get("l") or event.get("q"),
            "timestamp": int(event.get("T", 0)),
            "fee": {
                "cost": event.get("n"),
                "currency": event.get("N"),
            },
        }

        row = insert_fill_from_ccxt(db, user_id, ccxt_trade, "websocket", "binance")
        if row is not None:
            db.commit()
            db.refresh(row)
            await process_fill_transaction(db, exchange_client, row)
            db.commit()
        return

    if event_type == "balanceUpdate":
        asset = (event.get("a") or "").upper()
        delta = _to_decimal(event.get("d"))
        executed_at = datetime.fromtimestamp(
            int(event.get("E", 0)) / 1000,
            tz=timezone.utc,
        )
        _insert_balance_update(db, user_id, asset, delta, executed_at)
        db.commit()


async def _ws_api_loop(
    user_id: int,
    account_type: str,
    api_key: str,
    api_secret: str,
    exchange_client,
) -> None:
    key = (user_id, account_type)
    stop_event = _stop_flags.get(key)

    try:
        async with websockets.connect(
            BINANCE_WS_API_URL,
            ping_interval=20,
            ping_timeout=20,
        ) as ws:
            subscription_id = await _subscribe_user_data_stream(ws, api_key, api_secret)

            db = SessionLocal()
            try:
                row = _get_or_create_ws_row(db, user_id, account_type)
                row.ws_status = "connected"
                row.listen_key = str(subscription_id)
                row.listen_key_updated_at = datetime.now(tz=timezone.utc)
                row.last_error = None
                db.commit()
            finally:
                db.close()

            connected = _connected_events.get(key)
            if connected:
                connected.set()

            while stop_event and not stop_event.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=60)
                except asyncio.TimeoutError:
                    continue

                payload = json.loads(raw)
                event = payload.get("event")
                if not event:
                    continue

                if event.get("e") == "eventStreamTerminated":
                    logger.warning("Binance user data stream terminated")
                    break

                db = SessionLocal()
                try:
                    await _handle_event(db, exchange_client, user_id, event)
                except Exception as exc:
                    logger.exception("WS event error: %s", exc)
                    row = _get_or_create_ws_row(db, user_id, account_type)
                    row.last_error = str(exc)
                    db.commit()
                finally:
                    db.close()

    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.exception("WebSocket API loop error: %s", exc)
        _connect_errors[key] = exc
        connected = _connected_events.get(key)
        if connected:
            connected.set()
        db = SessionLocal()
        try:
            row = _get_or_create_ws_row(db, user_id, account_type)
            row.ws_status = "error"
            row.last_error = str(exc)
            db.commit()
        finally:
            db.close()


async def start_binance_ws(
    user_id: int,
    account_type: str,
    exchange_client,
) -> None:
    if account_type != "spot":
        raise ValueError("Only spot WebSocket is supported in MVP")

    await stop_binance_ws(user_id, account_type)

    db = SessionLocal()
    try:
        api_key, api_secret = _get_credentials(db, user_id)
        if not api_key or not api_secret:
            raise ValueError("No API key found for user")

        row = _get_or_create_ws_row(db, user_id, account_type)
        row.ws_status = "reconnecting"
        db.commit()
    finally:
        db.close()

    key = (user_id, account_type)
    stop_event = asyncio.Event()
    connected_event = asyncio.Event()
    _stop_flags[key] = stop_event
    _connected_events[key] = connected_event
    _connect_errors.pop(key, None)

    task = asyncio.create_task(
        _ws_api_loop(user_id, account_type, api_key, api_secret, exchange_client)
    )
    _running_tasks[key] = task

    try:
        await asyncio.wait_for(connected_event.wait(), timeout=30)
    except asyncio.TimeoutError as exc:
        await stop_binance_ws(user_id, account_type)
        raise TimeoutError("Binance WebSocket subscription timed out") from exc

    connect_error = _connect_errors.pop(key, None)
    if connect_error:
        await stop_binance_ws(user_id, account_type)
        raise connect_error


async def stop_binance_ws(user_id: int, account_type: str) -> None:
    key = (user_id, account_type)
    _connected_events.pop(key, None)
    _connect_errors.pop(key, None)
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

    db = SessionLocal()
    try:
        row = (
            db.query(BinanceWs)
            .filter(BinanceWs.user_id == user_id, BinanceWs.account_type == account_type)
            .first()
        )
        if row:
            row.ws_status = "stopped"
            row.listen_key = None
            db.commit()
    finally:
        db.close()


def get_ws_status(user_id: int, account_type: str = "spot") -> dict:
    db = SessionLocal()
    try:
        row = (
            db.query(BinanceWs)
            .filter(BinanceWs.user_id == user_id, BinanceWs.account_type == account_type)
            .first()
        )
        if row is None:
            return {"ws_status": "idle", "account_type": account_type}
        return {
            "ws_status": row.ws_status,
            "account_type": row.account_type,
            "subscription_id": row.listen_key,
            "last_backfill_at": row.last_backfill_at.isoformat() if row.last_backfill_at else None,
            "last_balance_sync_at": (
                row.last_balance_sync_at.isoformat() if row.last_balance_sync_at else None
            ),
            "last_error": row.last_error,
        }
    finally:
        db.close()
