from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Mapping
from uuid import UUID

from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from sqlalchemy import text
from sqlalchemy.orm import Session

from models import ChatMessage as ChatMessageModel
from models import ChatSession as ChatSessionModel

_ENV_FILE = (Path(__file__).resolve().parent / ".env").resolve()
load_dotenv(_ENV_FILE, override=True)

CHAT_SYSTEM_PROMPT = (
    "Role: You are the Cryptelix global AI assistant. "
    "Objectives: Help with trading information, dashboards, crypto analytics, and product navigation. "
    "Guidelines:{"
    "1. Be concise, accurate, and professional."
    "2. Always respond in users message language"
    "3. If the user asks about the product, answer in a way that is helpful and informative."
    "4. Response wording must always be unique and never repeat the same response to the same question."
    "5. ALWAYS make sure to analyze their trades properly and provide them with the best possible non-future financial or investment advice."
    "6. React to every user message with a unique and appropriate response."
    "7. Give them anti-FOMO and anti-greed advice when needed."
    "Restrictions:{"
    "1. DO NOT provide user with any direct financial advice or investment recommendations for future trades."
    "2. Never explicitly mention any confidential information, like API keys, account numbers, etc."
    "}"

    
)

# Shown only when trade context is injected (keywords matched).
TRADE_CONTEXT_SYSTEM_ADDON = (
    "You HAVE access to the user's recent trades provided in the context below. "
    "If the user asks about them, use only this data without guessing. "
    "If the database block explicitly says there are no trades, only then say "
    "you do not see any saved trades; do not invent pairs, P&L, or dates."
)

class ChatServiceError(Exception):
    """OpenAI or configuration failure for global chat."""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def message_needs_trades_context(user_text: str) -> bool:
    """Broad trigger for injecting last trades from public.trades."""
    t = user_text.lower()
    needles = (
        "trade",
        "trades",
        "trading",
        "profit",
        "pnl",
        "statistic",
        "stats",
        "latest",
        "recent",
        "last",
        "my",
        "portfolio",
        "position",
        "positions",
    )
    if any(n in t for n in needles):
        return True
    if re.search(r"\bi\b", user_text, re.IGNORECASE):
        return True
    return False


def _decimal_str(value: object) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, Decimal):
        return format(value, "f")
    return str(value)


def _row_val(row: Mapping[str, Any], *names: str) -> Any:
    for n in names:
        if n in row:
            return row[n]
        ln = n.lower()
        for k in row:
            if str(k).lower() == ln:
                return row[k]
    return None


def _format_pnl_display(pnl: object) -> str:
    if pnl is None:
        return "n/a"
    try:
        v = float(pnl)
    except (TypeError, ValueError):
        return str(pnl)
    s = f"{v:.2f}$"
    if v > 0:
        return f"+{s}"
    return s


def _format_trade_line(row: Mapping[str, Any], idx: int, total: int) -> str:
    pair = _row_val(row, "pair") or "?"
    side = _row_val(row, "side") or "?"
    pnl_s = _format_pnl_display(_row_val(row, "pnl"))
    dt_raw = _row_val(row, "date", "closed_at", "created_at")
    if hasattr(dt_raw, "isoformat"):
        d_part = dt_raw.isoformat()[:19]
    else:
        d_part = str(dt_raw) if dt_raw is not None else "n/a"
    comm = _row_val(row, "commission")
    if comm is None:
        comm_s = "n/a"
    else:
        try:
            comm_s = f"{float(comm):.2f}$"
        except (TypeError, ValueError):
            comm_s = str(comm)
    ep = _row_val(row, "entry_price")
    xp = _row_val(row, "exit_price")
    ep_s = _decimal_str(ep) if ep is not None else "n/a"
    xp_s = _decimal_str(xp) if xp is not None else "n/a"
    if total == 1:
        head = "Your latest trade"
    elif idx == 1:
        head = f"Your most recent trade (1 of {total})"
    else:
        head = f"Trade {idx} of {total} (newest first)"
    return (
        f"{head}: {pair}, {side}, P&L: {pnl_s}, commission: {comm_s}, "
        f"entry: {ep_s}, exit: {xp_s}, date: {d_part}"
    )


def fetch_last_trades_raw(
    db: Session, user_id: int, limit: int = 10
) -> list[Mapping[str, Any]]:
    """
    Last rows from public.trades for this user.
    Uses column `date` for ordering (Cryptelix schema); there is no created_at on trades.
    """
    result = db.execute(
        text(
            """
            SELECT *
            FROM public.trades
            WHERE user_id = :uid
            ORDER BY date DESC NULLS LAST
            LIMIT :lim
            """
        ),
        {"uid": user_id, "lim": limit},
    )
    return list(result.mappings().all())


def build_trades_context_block(db: Session, user_id: int) -> str:
    """Human-readable block prepended to the system prompt when keywords match."""
    rows = fetch_last_trades_raw(db, user_id, limit=5)
    if not rows:
        return (
            "Database data (public.trades, user_id=%s): there are no saved trades right now. "
            "If the user asks about their trades, say so honestly; do not invent trades."
            % user_id
        )
    lines = [
        f"Database data: last {len(rows)} trades for user (user_id={user_id}) from public.trades, newest first:",
    ]
    for i, row in enumerate(rows, start=1):
        lines.append(_format_trade_line(row, i, len(rows)))
    return "\n".join(lines)


def _message_to_dict(m: ChatMessageModel) -> dict[str, Any]:
    return {
        "id": str(m.id),
        "role": m.role,
        "content": m.content,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def list_sessions(db: Session, user_id: int) -> list[dict[str, Any]]:
    rows: list[ChatSessionModel] = (
        db.query(ChatSessionModel)
        .filter(ChatSessionModel.user_id == user_id)
        .order_by(ChatSessionModel.updated_at.desc())
        .all()
    )
    return [
        {
            "id": str(s.id),
            "title": s.title,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        }
        for s in rows
    ]


def list_session_messages(db: Session, session_id: UUID) -> list[dict[str, Any]]:
    """Caller must ensure session exists and belongs to the user."""
    rows: list[ChatMessageModel] = (
        db.query(ChatMessageModel)
        .filter(ChatMessageModel.session_id == session_id)
        .order_by(ChatMessageModel.created_at.asc())
        .all()
    )
    return [_message_to_dict(m) for m in rows]


def send_chat(
    db: Session,
    user_id: int,
    session_id: UUID | None,
    message: str,
) -> dict[str, Any]:
    print("[chat_service/send_chat] enter", flush=True)
    text = message.strip()
    if not text:
        raise ChatServiceError("Empty message")

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key or not str(api_key).strip():
        raise ChatServiceError("OPENAI_API_KEY is not set")

    now = _utcnow()
    session: ChatSessionModel | None = None
    if session_id is not None:
        session = db.get(ChatSessionModel, session_id)
        if session is None or session.user_id != user_id:
            raise ChatServiceError("Session not found")
        print("[chat_service/send_chat] loaded session", session.id, flush=True)

    if session is None:
        session = ChatSessionModel(
            id=uuid.uuid4(),
            user_id=user_id,
            title=None,
            created_at=now,
            updated_at=now,
        )
        db.add(session)
        db.flush()
        print("[chat_service/send_chat] created session", session.id, flush=True)

    prior: list[ChatMessageModel] = (
        db.query(ChatMessageModel)
        .filter(ChatMessageModel.session_id == session.id)
        .order_by(ChatMessageModel.created_at.asc())
        .all()
    )

    user_row = ChatMessageModel(
        id=uuid.uuid4(),
        session_id=session.id,
        role="user",
        content=text,
        created_at=now,
    )
    db.add(user_row)
    db.flush()
    print("[chat_service/send_chat] saved user message id=", user_row.id, flush=True)

    if not session.title or not str(session.title).strip():
        snippet = text.replace("\n", " ").strip()
        session.title = (snippet[:80] + ("…" if len(snippet) > 80 else "")) or "Chat"

    system_content = CHAT_SYSTEM_PROMPT
    if message_needs_trades_context(text):
        trade_block = build_trades_context_block(db, user_id)
        system_content = (
            f"{CHAT_SYSTEM_PROMPT}\n\n{TRADE_CONTEXT_SYSTEM_ADDON}\n\n{trade_block}"
        )

    oai_messages: list[dict[str, str]] = [{"role": "system", "content": system_content}]
    for m in prior[-30:]:
        if m.role not in ("user", "assistant"):
            continue
        oai_messages.append({"role": m.role, "content": m.content})
    oai_messages.append({"role": "user", "content": text})

    print("[chat_service/send_chat] calling OpenAI gpt-4o-mini…", flush=True)
    client = OpenAI(api_key=str(api_key).strip())
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=oai_messages,
            temperature=0.5,
            max_tokens=1024,
        )
    except Exception as exc:
        db.rollback()
        print("[chat_service/send_chat] OpenAI error:", repr(exc), flush=True)
        raise ChatServiceError(str(exc)) from exc

    assistant_text = (response.choices[0].message.content or "").strip()
    print("[chat_service/send_chat] OpenAI OK, reply len=", len(assistant_text), flush=True)
    if not assistant_text:
        db.rollback()
        raise ChatServiceError("Empty model response")

    asst_now = _utcnow()
    assistant_row = ChatMessageModel(
        id=uuid.uuid4(),
        session_id=session.id,
        role="assistant",
        content=assistant_text,
        created_at=asst_now,
    )
    db.add(assistant_row)
    session.updated_at = asst_now
    print("[chat_service/send_chat] committing assistant message…", flush=True)
    db.commit()
    db.refresh(user_row)
    db.refresh(assistant_row)
    db.refresh(session)

    return {
        "session_id": str(session.id),
        "title": session.title,
        "user_message": _message_to_dict(user_row),
        "assistant_message": _message_to_dict(assistant_row),
    }
