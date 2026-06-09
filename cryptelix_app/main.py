from __future__ import annotations

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv

# Bootstrap env before any other cryptelix_app imports (import order loads database via analytics).
_ENV_FILE = (Path(__file__).resolve().parent / ".env").resolve()
load_dotenv(_ENV_FILE, override=True)
print(
    "[SYSTEM] New Key detected. Length:",
    len((os.getenv("OPENAI_API_KEY") or "").strip()),
)

from collections import defaultdict
from datetime import datetime, date as date_type, time, timedelta
from typing import Any, Dict, List
from uuid import UUID, uuid4

import io
import json

import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from starlette.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from analytics_service import get_user_financial_summary
from ai_service import AIAnalysisError, analyze_trade_sync
import chat_service as chat_svc
from database import DEFAULT_USER_ID, SessionLocal, get_db
from binance_connect_service import run_binance_connect_pipeline
from binance_ws_listener import get_ws_status, stop_binance_ws
from db_migrations import ensure_balance_spot_constraints
from models import BalanceSpotTransaction as BalanceSpotTransactionModel
from models import ChatMessage as ChatMessageModel  # noqa: F401 — register ORM mapper
from models import APIKey as APIKeyModel
from models import BinanceWs as BinanceWsModel
from models import ChatSession as ChatSessionModel
from models import PairInventory as PairInventoryModel  # noqa: F401
from models import Trade as TradeModel
from schemas import ChatSendRequest
from schemas import (
    ExchangeCredentialsUpsertRequest,
    ExchangeSyncTradesRequest,
    TradeCreate,
    TradeUpdate,
    Trade as TradeSchema,
)
from security import encrypt_data


app = FastAPI(title="Cryptelix API", version="1.0.0")
_CONNECT_JOBS: Dict[str, Dict[str, Any]] = {}


@app.on_event("startup")
def _apply_schema_patches() -> None:
    try:
        ensure_balance_spot_constraints()
    except Exception as exc:
        print(f"[WARN] Schema patch skipped: {exc}")


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://100.114.17.18:5173",
        "http://100.114.17.18:8000",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


def _summary_to_dict(summary) -> Dict[str, Any]:
    """
    Convert FinancialSummary dataclass to a JSON-serialisable dict.
    """
    return {
        "start_balance": str(summary.start_balance),
        "net_trading_pnl": str(summary.net_trading_pnl),
        "net_transfers": str(summary.net_transfers),
        "current_equity": str(summary.current_equity),
        "period_change_percent": (
            float(summary.period_change_percent)
            if summary.period_change_percent is not None
            else None
        ),
    }


@app.get("/api/v1/summary")
async def get_financial_summary(
    start_date: datetime | None = None,
    db: Session = Depends(get_db),
):
    """
    Return the user's financial summary as JSON.
    """
    try:
        summary = get_user_financial_summary(db=db, start_date=start_date)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return _summary_to_dict(summary)


_PROFIT_TREND_PERIOD_TRUNC = {
    "days": "day",
    "weeks": "week",
    "months": "month",
}


@app.get("/api/metrics/profit-trend")
async def get_profit_trend(
    period: str = Query(
        "trades",
        description="trades: one point per trade; days/weeks/months: DATE_TRUNC buckets, cumulative.",
    ),
    db: Session = Depends(get_db),
):
    """
    Cumulative PnL from trades (pnl - commission), ordered in time.

    - period=trades: one row per trade, running cumulative balance.
    - period=days|weeks|months: SQL DATE_TRUNC groups, net PnL per bucket,
      then cumulative balance across buckets (still includes all prior periods).

    TODO: MULTI-USER-MIGRATION — currently fixed to user_id = 1.
    """
    user_id = 1  # TODO: MULTI-USER-MIGRATION
    allowed = frozenset({"trades", "days", "weeks", "months"})
    if period not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"period must be one of: {', '.join(sorted(allowed))}",
        )

    if period == "trades":
        try:
            rows: List[TradeModel] = (
                db.query(TradeModel)
                .filter(TradeModel.user_id == user_id)
                .order_by(TradeModel.date.asc())
                .all()
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        cumulative_balance = 0.0
        out: List[Dict[str, Any]] = []
        for t in rows:
            if t.date is None:
                continue
            pnl = float(t.pnl) if t.pnl is not None else 0.0
            commission = float(t.commission) if t.commission is not None else 0.0
            cumulative_balance += pnl - commission
            out.append(
                {
                    "date": t.date.strftime("%Y-%m-%d"),
                    "balance": cumulative_balance,
                }
            )
        return out

    trunc_sql = _PROFIT_TREND_PERIOD_TRUNC[period]
    sql = text(
        f"""
        SELECT date_trunc('{trunc_sql}', date) AS bucket,
               SUM(COALESCE(pnl, 0) - COALESCE(commission, 0)) AS period_net
        FROM trades
        WHERE user_id = :user_id
        GROUP BY 1
        ORDER BY 1
        """
    )
    try:
        result = db.execute(sql, {"user_id": user_id})
        grouped = result.mappings().all()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    cumulative_balance = 0.0
    out: List[Dict[str, Any]] = []
    for row in grouped:
        bucket = row["bucket"]
        period_net = row["period_net"]
        net = float(period_net) if period_net is not None else 0.0
        cumulative_balance += net
        if isinstance(bucket, datetime):
            date_str = bucket.strftime("%Y-%m-%d")
        else:
            date_str = str(bucket)[:10]
        out.append({"date": date_str, "balance": cumulative_balance})
    return out


def _normalize_ai_report_for_api(value: Any) -> str | None:
    """Expose null when there is no stored analysis (legacy placeholder treated as empty)."""
    if value is None:
        return None
    if not isinstance(value, str):
        return str(value).strip() or None
    s = value.strip()
    if not s or s == "Analysis pending...":
        return None
    return s


def _is_legacy_raw_fill_row(trade: TradeModel) -> bool:
    """Old per-fill sync rows (Buy/Sell without exit/pnl) — superseded by WAC journal trades."""
    if trade.pnl is not None or trade.exit_price is not None:
        return False
    side = (trade.side or "").strip().lower()
    if side not in {"buy", "sell"}:
        return False
    ext = (trade.exchange_trade_id or "").strip()
    if not ext or ext.startswith("mock-") or ext.startswith("wac-"):
        return False
    return True


def _trade_to_dict(trade: TradeModel) -> Dict[str, Any]:
    """JSON aligned with DB columns (snake_case). Frontend maps to React camelCase."""
    return {
        "id": str(trade.id),
        "date": trade.date.isoformat() if trade.date else None,
        "pair": trade.pair,
        "side": trade.side,
        "entry_price": str(trade.entry_price) if trade.entry_price is not None else None,
        "exit_price": str(trade.exit_price) if trade.exit_price is not None else None,
        "quantity": str(trade.quantity) if trade.quantity is not None else None,
        "pnl": str(trade.pnl) if trade.pnl is not None else None,
        "commission": str(trade.commission) if trade.commission is not None else None,
        "notes": trade.notes,
        "ai_report": _normalize_ai_report_for_api(trade.ai_report),
        "is_manual": bool(trade.is_manual),
        "exchange_trade_id": trade.exchange_trade_id,
        "exchange_name": trade.exchange_name,
        "account_type": trade.account_type or "spot",
        "custom_fields": trade.custom_fields or {},
    }


def _normalize_exchange_name(name: str) -> str:
    value = (name or "").strip().lower()
    aliases = {
        "binance": "binance",
    }
    if value not in aliases:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported exchange. For now only Binance is available.",
        )
    return aliases[value]


def _normalize_account_type(value: str | None) -> str:
    account_type = (value or "spot").strip().lower()
    allowed = {"spot"}
    if account_type not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported account_type. For now only 'spot' is available.",
        )
    return account_type


@app.post("/api/v1/exchanges/credentials")
async def upsert_exchange_credentials(
    payload: ExchangeCredentialsUpsertRequest,
    db: Session = Depends(get_db),
):
    exchange_name = _normalize_exchange_name(payload.exchange_name)
    encrypted_key = encrypt_data(payload.api_key.strip())
    encrypted_secret = encrypt_data(payload.api_secret.strip())

    try:
        row: APIKeyModel | None = (
            db.query(APIKeyModel)
            .filter(
                APIKeyModel.user_id == DEFAULT_USER_ID,
                APIKeyModel.exchange_name == exchange_name,
            )
            .first()
        )
        if row is None:
            row = APIKeyModel(
                user_id=DEFAULT_USER_ID,
                exchange_name=exchange_name,
                api_key_encrypted=encrypted_key,
                api_secret_encrypted=encrypted_secret,
            )
            db.add(row)
            action = "created"
        else:
            row.api_key_encrypted = encrypted_key
            row.api_secret_encrypted = encrypted_secret
            action = "updated"
            db.add(row)

        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    job_id = str(uuid4())
    _CONNECT_JOBS[job_id] = {
        "status": "queued",
        "phase": "queued",
        "exchange_name": exchange_name,
        "account_type": "spot",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "phases": {},
        "error": None,
    }
    asyncio.create_task(_run_binance_connect_job(job_id=job_id, account_type="spot"))

    return {
        "status": "ok",
        "action": action,
        "exchange_name": exchange_name,
        "connect_job_id": job_id,
    }


@app.get("/api/v1/exchanges/credentials/status")
async def get_exchange_credentials_status(db: Session = Depends(get_db)):
    rows: list[APIKeyModel] = (
        db.query(APIKeyModel)
        .filter(APIKeyModel.user_id == DEFAULT_USER_ID)
        .all()
    )
    connected = {str(row.exchange_name).strip().lower() for row in rows if row.exchange_name}
    return {
        "connected_exchanges": sorted(connected),
        "binance_connected": "binance" in connected,
    }


@app.delete("/api/v1/exchanges/credentials/{exchange_name}")
async def delete_exchange_credentials(
    exchange_name: str,
    db: Session = Depends(get_db),
):
    normalized = _normalize_exchange_name(exchange_name)
    row: APIKeyModel | None = (
        db.query(APIKeyModel)
        .filter(
            APIKeyModel.user_id == DEFAULT_USER_ID,
            APIKeyModel.exchange_name == normalized,
        )
        .first()
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No credentials found for exchange '{normalized}'.",
        )

    try:
        await stop_binance_ws(DEFAULT_USER_ID, "spot")
        db.query(BinanceWsModel).filter(
            BinanceWsModel.user_id == DEFAULT_USER_ID,
            BinanceWsModel.account_type == "spot",
        ).delete()
        db.delete(row)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "status": "ok",
        "exchange_name": normalized,
    }


@app.post("/api/v1/exchanges/binance/connect")
async def start_binance_connect(
    db: Session = Depends(get_db),
):
    cred_exists = (
        db.query(APIKeyModel)
        .filter(
            APIKeyModel.user_id == DEFAULT_USER_ID,
            APIKeyModel.exchange_name == "binance",
        )
        .first()
    )
    if cred_exists is None:
        raise HTTPException(
            status_code=400,
            detail="No API credentials found for exchange 'binance'.",
        )

    job_id = str(uuid4())
    _CONNECT_JOBS[job_id] = {
        "status": "queued",
        "phase": "queued",
        "exchange_name": "binance",
        "account_type": "spot",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "phases": {},
        "error": None,
    }
    asyncio.create_task(_run_binance_connect_job(job_id=job_id, account_type="spot"))
    return {
        "status": "accepted",
        "job_id": job_id,
        "exchange_name": "binance",
        "account_type": "spot",
    }


@app.get("/api/v1/exchanges/binance/connect/{job_id}")
async def get_binance_connect_status(job_id: str):
    job = _CONNECT_JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Connect job not found")
    return job


@app.get("/api/v1/exchanges/binance/ws-status")
async def get_binance_ws_status():
    return get_ws_status(DEFAULT_USER_ID, "spot")


@app.get("/api/v1/exchanges/binance/portfolio")
async def get_binance_portfolio(db: Session = Depends(get_db)):
    """Latest balance snapshots with USDT valuation."""
    subq = (
        db.query(
            BalanceSpotTransactionModel.asset,
            func.max(BalanceSpotTransactionModel.executed_at).label("max_at"),
        )
        .filter(
            BalanceSpotTransactionModel.user_id == DEFAULT_USER_ID,
            BalanceSpotTransactionModel.type == "BALANCE_SNAPSHOT",
        )
        .group_by(BalanceSpotTransactionModel.asset)
        .subquery()
    )

    rows = (
        db.query(BalanceSpotTransactionModel)
        .join(
            subq,
            (BalanceSpotTransactionModel.asset == subq.c.asset)
            & (BalanceSpotTransactionModel.executed_at == subq.c.max_at),
        )
        .filter(
            BalanceSpotTransactionModel.user_id == DEFAULT_USER_ID,
            BalanceSpotTransactionModel.type == "BALANCE_SNAPSHOT",
        )
        .all()
    )

    assets = []
    total_usdt = 0.0
    for row in rows:
        amount = float(row.amount or 0)
        rate = float(row.quote_to_usdt_rate or 0)
        value_usdt = amount * rate if rate else 0.0
        total_usdt += value_usdt
        assets.append(
            {
                "asset": row.asset,
                "total": str(row.amount),
                "free": str(row.free) if row.free is not None else None,
                "locked": str(row.locked) if row.locked is not None else None,
                "value_usdt": round(value_usdt, 2),
                "captured_at": row.executed_at.isoformat() if row.executed_at else None,
            }
        )

    return {
        "exchange_name": "binance",
        "account_type": "spot",
        "total_usdt": round(total_usdt, 2),
        "assets": sorted(assets, key=lambda a: a["value_usdt"], reverse=True),
        "ws": get_ws_status(DEFAULT_USER_ID, "spot"),
    }


async def _run_binance_connect_job(job_id: str, account_type: str) -> None:
    def on_phase(phase: str, data: dict) -> None:
        _CONNECT_JOBS[job_id]["phase"] = phase
        _CONNECT_JOBS[job_id]["phases"][phase] = data
        if data.get("status") == "running":
            _CONNECT_JOBS[job_id]["status"] = "running"

    try:
        _CONNECT_JOBS[job_id]["status"] = "running"
        result = await run_binance_connect_pipeline(
            user_id=DEFAULT_USER_ID,
            account_type=account_type,
            on_phase=on_phase,
        )
        wac_phase = (result.get("phases") or {}).get("wac") or {}
        job_update = {
            "status": "done",
            "phase": "done",
            "orphans": result.get("orphans", []),
            "trades_created": wac_phase.get("trades_created", 0),
            "fills_processed": wac_phase.get("fills_processed", 0),
            "finished_at": datetime.utcnow().isoformat() + "Z",
        }
        if result.get("ws_error"):
            job_update["ws_error"] = result["ws_error"]
            job_update["ws_status"] = "failed"
        else:
            job_update["ws_status"] = "connected"
        _CONNECT_JOBS[job_id].update(job_update)
    except Exception as exc:
        _CONNECT_JOBS[job_id].update(
            {
                "status": "failed",
                "phase": "failed",
                "error": str(exc),
                "finished_at": datetime.utcnow().isoformat() + "Z",
            }
        )


@app.post("/api/v1/exchanges/binance/sync-trades")
async def sync_binance_trades(
    payload: ExchangeSyncTradesRequest,
    db: Session = Depends(get_db),
):
    """Legacy alias — runs full connect pipeline (balance + backfill + WAC + WS)."""
    _normalize_account_type(payload.account_type)
    return await start_binance_connect(db)


@app.get("/api/v1/exchanges/binance/sync-trades/{job_id}")
async def get_binance_sync_status(job_id: str):
    """Legacy alias for connect job status."""
    job = _CONNECT_JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Sync job not found")
    return job


@app.get("/api/v1/trades")
async def get_trades(db: Session = Depends(get_db)):
    """
    Return all trades as a list of objects with date, pair, type, entry, exit, quantity, pnl, commission.
    """
    try:
        trades: List[TradeModel] = (
            db.query(TradeModel)
            .filter(
                TradeModel.user_id == DEFAULT_USER_ID  # TODO: MULTI-USER-MIGRATION
            )
            .order_by(TradeModel.date.desc())
            .all()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    visible = [t for t in trades if not _is_legacy_raw_fill_row(t)]
    return [_trade_to_dict(t) for t in visible]


@app.get("/api/v1/trades/wvl")
async def get_trades_wvl(
    start_date: date_type = Query(
        ...,
        description="Week start (Monday), YYYY-MM-DD",
    ),
    end_date: date_type = Query(
        ...,
        description="Week end (Sunday), YYYY-MM-DD",
    ),
    db: Session = Depends(get_db),
):
    """
    Wins vs Losses: trade counts per calendar day (Mon–Sun window).
    Win = pnl > 0, Loss = pnl < 0 (pnl == 0 or null excluded).
    user_id = 1 (TODO: MULTI-USER-MIGRATION).
    """
    if end_date < start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="end_date must be on or after start_date",
        )
    expected_week_end = start_date + timedelta(days=6)
    if end_date != expected_week_end:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="end_date must be start_date + 6 days (Monday–Sunday WvL week)",
        )

    start_dt = datetime.combine(start_date, time.min)
    end_exclusive = datetime.combine(start_date + timedelta(days=7), time.min)

    try:
        rows: List[TradeModel] = (
            db.query(TradeModel)
            .filter(
                TradeModel.user_id == DEFAULT_USER_ID,
                TradeModel.date >= start_dt,
                TradeModel.date < end_exclusive,
            )
            .all()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    counts: dict[date_type, dict[str, int]] = defaultdict(lambda: {"wins": 0, "losses": 0})
    for t in rows:
        if t.date is None or t.pnl is None:
            continue
        try:
            pnl_f = float(t.pnl)
        except (TypeError, ValueError):
            continue
        day = t.date.date() if isinstance(t.date, datetime) else t.date
        if day < start_date or day > start_date + timedelta(days=6):
            continue
        if pnl_f > 0:
            counts[day]["wins"] += 1
        elif pnl_f < 0:
            counts[day]["losses"] += 1

    weekday_labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    series: List[Dict[str, Any]] = []
    for i in range(7):
        day = start_date + timedelta(days=i)
        c = counts.get(day, {"wins": 0, "losses": 0})
        series.append(
            {
                "date": day.isoformat(),
                "label": weekday_labels[day.weekday()],
                "wins": c["wins"],
                "losses": c["losses"],
            }
        )

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "series": series,
    }


def _trade_float(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


@app.get("/api/v1/trades/stats")
async def get_trades_stats(db: Session = Depends(get_db)):
    """
    Key Metrics / Stats for dashboard: TNP, profit factor, trade counts, max drawdown, etc.
    Filtered to DEFAULT_USER_ID (TODO: MULTI-USER-MIGRATION).
    """
    try:
        rows: List[TradeModel] = (
            db.query(TradeModel)
            .filter(TradeModel.user_id == DEFAULT_USER_ID)
            .order_by(TradeModel.date.asc())
            .all()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    total_trades = len(rows)
    sum_pnl = 0.0
    sum_commission = 0.0
    sum_positive_pnl = 0.0
    sum_negative_pnl = 0.0
    winners = 0
    losers = 0

    for t in rows:
        pnl = _trade_float(t.pnl)
        comm = _trade_float(t.commission)
        sum_pnl += pnl
        sum_commission += comm
        if t.pnl is not None:
            if pnl > 0:
                winners += 1
                sum_positive_pnl += pnl
            elif pnl < 0:
                losers += 1
                sum_negative_pnl += pnl

    total_net_profit = sum_pnl - sum_commission

    loss_magnitude = abs(sum_negative_pnl)
    profit_factor: float | None
    if loss_magnitude > 1e-12:
        profit_factor = sum_positive_pnl / loss_magnitude
    else:
        profit_factor = None

    cumulative = 0.0
    peak = float("-inf")
    max_drawdown = 0.0
    for t in rows:
        net = _trade_float(t.pnl) - _trade_float(t.commission)
        cumulative += net
        peak = max(peak, cumulative)
        max_drawdown = max(max_drawdown, peak - cumulative)

    max_drawdown_percent = (max_drawdown / peak * 100.0) if peak > 1e-12 else 0.0

    percent_profitable = (
        (winners / total_trades * 100.0) if total_trades > 0 else 0.0
    )
    avg_trade = (total_net_profit / total_trades) if total_trades > 0 else 0.0

    return {
        "total_net_profit": total_net_profit,
        "profit_factor": profit_factor,
        "total_trades": total_trades,
        "winners": winners,
        "losers": losers,
        "max_drawdown": max_drawdown,
        "max_drawdown_percent": max_drawdown_percent,
        "percent_profitable": percent_profitable,
        "avg_trade": avg_trade,
    }


@app.get("/api/v1/trades/ftr-report")
async def get_trades_ftr_report(db: Session = Depends(get_db)):
    """
    Full Trading Report: extended metrics for the FTR widget (user_id = DEFAULT_USER_ID).
    MFE/MAE use entry vs exit as a proxy when intraday extremes are not stored.
    """
    try:
        rows: List[TradeModel] = (
            db.query(TradeModel)
            .filter(TradeModel.user_id == DEFAULT_USER_ID)
            .order_by(TradeModel.date.asc())
            .all()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    total_trades = len(rows)
    sum_pnl = 0.0
    sum_commission = 0.0
    sum_positive_pnl = 0.0
    sum_negative_pnl = 0.0
    winners = 0
    losers = 0
    gross_profit = 0.0
    gross_loss = 0.0
    largest_win = 0.0
    largest_loss = 0.0

    max_win_streak = 0
    max_loss_streak = 0
    cur_win = 0
    cur_loss = 0

    mfe_pts_list: List[float] = []
    mae_pts_list: List[float] = []
    mfe_pct_list: List[float] = []
    mae_pct_list: List[float] = []
    duration_seconds: List[float] = []

    dates_for_span: List[datetime] = []

    for t in rows:
        pnl = _trade_float(t.pnl)
        comm = _trade_float(t.commission)
        sum_pnl += pnl
        sum_commission += comm
        if t.pnl is not None:
            if pnl > 0:
                winners += 1
                gross_profit += pnl
                sum_positive_pnl += pnl
                largest_win = max(largest_win, pnl)
                cur_win += 1
                cur_loss = 0
                max_win_streak = max(max_win_streak, cur_win)
            elif pnl < 0:
                losers += 1
                gross_loss += pnl
                sum_negative_pnl += pnl
                largest_loss = min(largest_loss, pnl)
                cur_loss += 1
                cur_win = 0
                max_loss_streak = max(max_loss_streak, cur_loss)
            else:
                cur_win = 0
                cur_loss = 0
        else:
            cur_win = 0
            cur_loss = 0

        if t.date is not None:
            dates_for_span.append(t.date if isinstance(t.date, datetime) else datetime.combine(t.date, time.min))

        ep = t.entry_price
        xp = t.exit_price
        if ep is not None and xp is not None:
            try:
                e = float(ep)
                x = float(xp)
            except (TypeError, ValueError):
                e = x = None
            if e is not None and x is not None and e != 0:
                side = (t.side or "").strip().lower()
                if side.startswith("s"):
                    mfe = max(0.0, e - x)
                    mae = max(0.0, x - e)
                else:
                    mfe = max(0.0, x - e)
                    mae = max(0.0, e - x)
                mfe_pts_list.append(mfe)
                mae_pts_list.append(mae)
                mfe_pct_list.append((mfe / abs(e)) * 100.0)
                mae_pct_list.append((mae / abs(e)) * 100.0)

        if t.date is not None and t.closed_at is not None:
            d0 = t.date if isinstance(t.date, datetime) else datetime.combine(t.date, time.min)
            c0 = t.closed_at if isinstance(t.closed_at, datetime) else datetime.combine(t.closed_at, time.min)
            delta = (c0 - d0).total_seconds()
            if delta >= 0:
                duration_seconds.append(delta)

    total_net_profit = sum_pnl - sum_commission
    total_profit_gross_minus_loss = gross_profit + gross_loss

    loss_magnitude = abs(sum_negative_pnl)
    profit_factor: float | None
    if loss_magnitude > 1e-12:
        profit_factor = sum_positive_pnl / loss_magnitude
    else:
        profit_factor = None

    cumulative = 0.0
    peak = float("-inf")
    max_drawdown = 0.0
    for t in rows:
        net = _trade_float(t.pnl) - _trade_float(t.commission)
        cumulative += net
        peak = max(peak, cumulative)
        max_drawdown = max(max_drawdown, peak - cumulative)

    max_drawdown_percent = (max_drawdown / peak * 100.0) if peak > 1e-12 else 0.0

    percent_profitable = (
        (winners / total_trades * 100.0) if total_trades > 0 else 0.0
    )
    avg_trade = (total_net_profit / total_trades) if total_trades > 0 else 0.0

    avg_winning_trade = (gross_profit / winners) if winners > 0 else 0.0
    avg_losing_trade = (gross_loss / losers) if losers > 0 else 0.0

    avg_win_lose_ratio: float | None
    if losers > 0 and avg_losing_trade != 0:
        avg_win_lose_ratio = avg_winning_trade / abs(avg_losing_trade)
    else:
        avg_win_lose_ratio = None

    if dates_for_span:
        first_d = min(dates_for_span)
        last_d = max(dates_for_span)
        span_days = max(1, (last_d - first_d).days + 1)
    else:
        span_days = 1

    weeks = span_days / 7.0
    months = span_days / 30.0
    profit_per_day = total_net_profit / span_days
    profit_per_week = total_net_profit / weeks if weeks > 0 else total_net_profit
    profit_per_month = total_net_profit / months if months > 0 else total_net_profit
    trades_per_day = total_trades / span_days

    def _avg(xs: List[float]) -> float:
        return sum(xs) / len(xs) if xs else 0.0

    avg_time_seconds = _avg(duration_seconds)
    avg_mfe_points = _avg(mfe_pts_list)
    avg_mae_points = _avg(mae_pts_list)
    avg_mfe_percent = _avg(mfe_pct_list)
    avg_mae_percent = _avg(mae_pct_list)

    return {
        "total_profit_gross_minus_loss": total_profit_gross_minus_loss,
        "total_net_profit": total_net_profit,
        "total_trades": total_trades,
        "profit_per_week": profit_per_week,
        "profit_per_month": profit_per_month,
        "profit_per_day": profit_per_day,
        "profit_factor": profit_factor,
        "percent_profitable": percent_profitable,
        "max_drawdown": max_drawdown,
        "max_drawdown_percent": max_drawdown_percent,
        "max_consecutive_winners": max_win_streak,
        "max_consecutive_losers": max_loss_streak,
        "largest_winning_trade": largest_win,
        "largest_losing_trade": largest_loss,
        "gross_profit": gross_profit,
        "gross_loss": gross_loss,
        "commission_total": sum_commission,
        "avg_winning_trade": avg_winning_trade,
        "avg_win_lose_ratio": avg_win_lose_ratio,
        "avg_trade": avg_trade,
        "avg_time_in_market_seconds": avg_time_seconds,
        "avg_mfe_points": avg_mfe_points,
        "avg_mfe_percent": avg_mfe_percent,
        "avg_mae_points": avg_mae_points,
        "avg_mae_percent": avg_mae_percent,
        "avg_losing_trade": avg_losing_trade,
        "winning_trades_count": winners,
        "losing_trades_count": losers,
        "trades_per_day": trades_per_day,
    }


@app.post("/api/v1/trades", response_model=TradeSchema, status_code=status.HTTP_201_CREATED)
async def create_trade(request: Request, db: Session = Depends(get_db)):
    """
    Create a new trade record in the database and return it.
    """
    body_bytes = await request.body()
    try:
        print("[POST /api/v1/trades] incoming json:", json.loads(body_bytes.decode()))
    except Exception as exc:
        print("[POST /api/v1/trades] could not log json body:", exc)

    trade_in = TradeCreate.model_validate_json(body_bytes)

    try:
        # Treat trades created via the UI as manual by default; user_id always from server
        trade = TradeModel(
            **trade_in.model_dump(),
            is_manual=True,
            user_id=DEFAULT_USER_ID,  # TODO: MULTI-USER-MIGRATION
        )
        db.add(trade)
        db.commit()
        db.refresh(trade)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return trade


@app.delete("/api/v1/trades/{trade_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trade(trade_id: UUID, db: Session = Depends(get_db)):
    """
    Delete a trade by ID if it is marked as manual.
    """
    trade: TradeModel | None = db.get(TradeModel, trade_id)
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    if trade.user_id != DEFAULT_USER_ID:  # TODO: MULTI-USER-MIGRATION
        raise HTTPException(status_code=404, detail="Trade not found")

    if not trade.is_manual:
        raise HTTPException(
            status_code=403, detail="Cannot delete API-integrated trades"
        )

    try:
        db.delete(trade)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.patch("/api/v1/trades/{trade_id}", response_model=TradeSchema)
async def update_trade(trade_id: UUID, request: Request, db: Session = Depends(get_db)):
    """
    Partial update of trade fields (notes, prices, quantities, custom_fields, etc.).
    """
    body_bytes = await request.body()
    try:
        print(f"[PATCH /api/v1/trades/{trade_id}] incoming json:", json.loads(body_bytes.decode()))
    except Exception as exc:
        print(f"[PATCH /api/v1/trades/{trade_id}] could not log json body:", exc)

    trade_in = TradeUpdate.model_validate_json(body_bytes)

    trade: TradeModel | None = db.get(TradeModel, trade_id)
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    if trade.user_id != DEFAULT_USER_ID:  # TODO: MULTI-USER-MIGRATION
        raise HTTPException(status_code=404, detail="Trade not found")

    update_data = trade_in.model_dump(exclude_unset=True)
    update_data.pop("user_id", None)

    field_names = (
        "date",
        "pair",
        "side",
        "entry_price",
        "exit_price",
        "quantity",
        "pnl",
        "commission",
        "notes",
        "ai_report",
        "custom_fields",
    )
    for key in field_names:
        if key in update_data:
            setattr(trade, key, update_data[key])

    try:
        db.add(trade)
        db.commit()
        db.refresh(trade)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return trade


@app.post("/api/v1/trades/{trade_id}/analyze")
async def analyze_trade_endpoint(trade_id: UUID, db: Session = Depends(get_db)):
    """
    Run GPT-4o-mini analysis for a trade and persist the result in ai_report.
    """
    trade: TradeModel | None = db.get(TradeModel, trade_id)
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    if trade.user_id != DEFAULT_USER_ID:  # TODO: MULTI-USER-MIGRATION
        raise HTTPException(status_code=404, detail="Trade not found")

    try:
        report = await run_in_threadpool(analyze_trade_sync, trade)
    except AIAnalysisError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    trade.ai_report = report
    try:
        db.add(trade)
        db.commit()
        db.refresh(trade)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "id": str(trade.id),
        "ai_report": _normalize_ai_report_for_api(trade.ai_report),
    }


@app.get("/api/v1/chat/sessions")
def list_chat_sessions(db: Session = Depends(get_db)):
    """Sidebar: chat history for DEFAULT_USER_ID (TODO: MULTI-USER-MIGRATION)."""
    try:
        return chat_svc.list_sessions(db, DEFAULT_USER_ID)
    except Exception as exc:
        print("[chat/sessions] DB error:", repr(exc), flush=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"chat_sessions query failed: {exc!s}",
        ) from exc


@app.get("/api/v1/chat/sessions/{session_id}/messages")
def list_chat_session_messages(session_id: UUID, db: Session = Depends(get_db)):
    try:
        session: ChatSessionModel | None = db.get(ChatSessionModel, session_id)
        if session is None or session.user_id != DEFAULT_USER_ID:
            raise HTTPException(status_code=404, detail="Session not found")
        return chat_svc.list_session_messages(db, session_id)
    except HTTPException:
        raise
    except Exception as exc:
        print("[chat/messages] DB error:", repr(exc), flush=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"chat_messages query failed: {exc!s}",
        ) from exc


@app.post("/api/v1/chat/send")
def post_chat_send(body: ChatSendRequest, db: Session = Depends(get_db)):
    print(
        "[chat/send] start session_id=",
        body.session_id,
        "msg_len=",
        len(body.message or ""),
        flush=True,
    )
    try:
        result = chat_svc.send_chat(
            db,
            DEFAULT_USER_ID,
            body.session_id,
            body.message,
        )
        print("[chat/send] OK session_id=", result.get("session_id"), flush=True)
        return result
    except chat_svc.ChatServiceError as exc:
        detail = str(exc)
        print("[chat/send] ChatServiceError:", detail, flush=True)
        if detail == "Empty message":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=detail,
            ) from exc
        if detail == "Session not found":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=detail,
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail,
        ) from exc
    except Exception as exc:
        print("[chat/send] UNEXPECTED:", repr(exc), flush=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"chat send failed: {exc!s}",
        ) from exc


def get_db_sync():
    """
    Synchronous DB dependency using SessionLocal directly.
    This is provided in case you prefer not to use the async
    context manager from database.get_db in some contexts.
    """
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/api/v1/trades/export")
async def export_trades(db: Session = Depends(get_db)):
    """
    Export all trades to an Excel file.
    """
    try:
        trades: List[TradeModel] = (
            db.query(TradeModel)
            .filter(
                TradeModel.user_id == DEFAULT_USER_ID  # TODO: MULTI-USER-MIGRATION
            )
            .order_by(TradeModel.date.desc())
            .all()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not trades:
        raise HTTPException(
            status_code=404, detail="No trades available to export."
        )

    rows: List[Dict[str, Any]] = []
    for t in trades:
        rows.append(
            {
                "Date": t.date.isoformat() if t.date else None,
                "Pair": t.pair,
                "Type": t.side,
                "Entry Price": float(t.entry_price) if t.entry_price is not None else None,
                "Exit Price": float(t.exit_price) if t.exit_price is not None else None,
                "Quantity": float(t.quantity) if t.quantity is not None else None,
                "P&L": float(t.pnl) if t.pnl is not None else None,
                "Commission": float(t.commission) if t.commission is not None else None,
                "Notes": t.notes,
                "AI Insights": t.ai_report
                if t.ai_report and str(t.ai_report).strip() not in ("", "Analysis pending...")
                else "",
            }
        )

    df = pd.DataFrame(rows)

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Trades")

    buf.seek(0)

    today_str = date_type.today().isoformat()
    filename = f"cryptelix_trades_{today_str}.xlsx"

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"'
    }

    return StreamingResponse(
        buf,
        media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        headers=headers,
    )

