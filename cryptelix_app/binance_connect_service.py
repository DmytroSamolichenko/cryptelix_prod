from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Optional

from sqlalchemy.orm import Session

from binance_ws_listener import start_binance_ws, stop_binance_ws
from database import DEFAULT_USER_ID, SessionLocal
from exchange_service import ExchangeService
from models import BinanceWs
from reconcile_service import detect_orphans
from spot_sync_service import backfill_all_fills, sync_balance_snapshots
from wac_engine import process_all_unprocessed_fills

PhaseCallback = Callable[[str, dict], None]


def _update_ws_timestamps(
    db: Session,
    user_id: int,
    account_type: str,
    *,
    backfill: bool = False,
    balance: bool = False,
) -> None:
    row = (
        db.query(BinanceWs)
        .filter(BinanceWs.user_id == user_id, BinanceWs.account_type == account_type)
        .first()
    )
    if row is None:
        row = BinanceWs(user_id=user_id, account_type=account_type, ws_status="idle")
        db.add(row)
    now = datetime.now(tz=timezone.utc)
    if backfill:
        row.last_backfill_at = now
    if balance:
        row.last_balance_sync_at = now
    db.commit()


async def run_binance_connect_pipeline(
    user_id: int = DEFAULT_USER_ID,
    exchange_name: str = "binance",
    account_type: str = "spot",
    on_phase: Optional[PhaseCallback] = None,
) -> dict[str, Any]:
    """
    Full connect pipeline:
    1. REST balance snapshots
    2. REST backfill fills -> balance_spot_transactions
    3. WAC engine -> trades
    4. Reconcile orphans
    5. Start WebSocket (only after steps 1-3)
    """
    db = SessionLocal()
    service: Optional[ExchangeService] = None
    result: dict[str, Any] = {"status": "done", "phases": {}}

    def _phase(name: str, data: dict) -> None:
        result["phases"][name] = data
        if on_phase:
            on_phase(name, data)

    try:
        service = ExchangeService.from_db_credentials(exchange_name, db)
        await service.client.load_markets()
        await service._prepare_client_time()

        _phase("balance", {"status": "running"})
        snapshot_count = await sync_balance_snapshots(
            db, service.client, user_id, exchange_name
        )
        _update_ws_timestamps(db, user_id, account_type, balance=True)
        _phase("balance", {"status": "done", "snapshots": snapshot_count})

        _phase("backfill", {"status": "running"})
        backfill_stats = await backfill_all_fills(
            db, service.client, user_id, exchange_name
        )
        _update_ws_timestamps(db, user_id, account_type, backfill=True)
        _phase("backfill", {"status": "done", **backfill_stats})

        _phase("wac", {"status": "running"})
        wac_stats = await process_all_unprocessed_fills(
            db, service.client, user_id
        )
        _phase("wac", {"status": "done", **wac_stats})

        _phase("reconcile", {"status": "running"})
        orphans = await detect_orphans(db, service.client, user_id)
        _phase("reconcile", {"status": "done", "orphans": orphans})

        _phase("websocket", {"status": "running"})
        try:
            await start_binance_ws(user_id, account_type, service.client)
            _phase("websocket", {"status": "done"})
        except Exception as ws_exc:
            # REST pipeline succeeded; WS failure is non-fatal (e.g. Binance API migration).
            _phase("websocket", {"status": "failed", "error": str(ws_exc)})
            result["ws_error"] = str(ws_exc)

        result["orphans"] = orphans
        return result

    except Exception as exc:
        result["status"] = "failed"
        result["error"] = str(exc)
        try:
            await stop_binance_ws(user_id, account_type)
        except Exception:
            pass
        raise
    finally:
        if service is not None:
            try:
                await service.close()
            except Exception:
                pass
        db.close()
