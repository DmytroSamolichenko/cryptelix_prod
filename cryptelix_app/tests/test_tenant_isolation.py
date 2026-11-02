"""Cross-user access must look like a missing resource, and must not mutate it.

Covers the ID-addressable routes from the 4.8 audit: trades (list, patch,
delete, analyze, summary, export), chat sessions, connect jobs, exchange
credentials, and the constructor board.
"""

from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from openpyxl import load_workbook

from auth import create_access_token
from constructor_board_service import default_payload
from models import APIKey, ChatMessage, ChatSession, ConstructorBoard, Trade, User


def _user(db, email: str) -> User:
    user = User(
        email=email,
        username=email.split("@")[0],
        password_hash="not-used",
        token_version=0,
    )
    db.add(user)
    db.flush()
    return user


def _auth(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user)}"}


def _trade(db, user: User, *, pair: str, notes: str, pnl: str = "10.00") -> Trade:
    trade = Trade(
        id=uuid.uuid4(),
        user_id=user.id,
        date=datetime(2026, 11, 1, 12, 0, 0),
        pair=pair,
        side="buy",
        quantity="1",
        pnl=pnl,
        commission="0.10",
        notes=notes,
        is_manual=True,
        account_type="spot",
        entry_price="1",
        exchange_trade_id=f"manual-{pair}",
        exchange_name="binance",
    )
    db.add(trade)
    db.flush()
    return trade


def test_trade_reads_and_writes_stay_on_the_owner(client, db_session):
    owner = _user(db_session, "owner-trades@isolation.test")
    stranger = _user(db_session, "stranger-trades@isolation.test")
    secret = _trade(
        db_session,
        owner,
        pair="ZZZ/SECRET",
        notes="owner-only-note",
        pnl="42.50",
    )
    own = _trade(db_session, stranger, pair="BTC/USDT", notes="stranger-note", pnl="1.00")
    db_session.commit()

    listed = client.get("/api/v1/trades", headers=_auth(stranger))
    assert listed.status_code == 200
    pairs = [row["pair"] for row in listed.json()]
    assert "BTC/USDT" in pairs
    assert "ZZZ/SECRET" not in pairs

    summary = client.get("/api/v1/summary", headers=_auth(stranger))
    assert summary.status_code == 200
    # stranger's net is 1.00 - 0.10, not the owner's 42.50
    assert Decimal(summary.json()["net_trading_pnl"]) == Decimal("0.90")

    exported = client.get("/api/v1/trades/export", headers=_auth(stranger))
    assert exported.status_code == 200
    sheet = load_workbook(io.BytesIO(exported.content)).active
    cells = {
        str(cell.value)
        for row in sheet.iter_rows()
        for cell in row
        if cell.value is not None
    }
    assert "BTC/USDT" in cells
    assert "ZZZ/SECRET" not in cells

    patched = client.patch(
        f"/api/v1/trades/{secret.id}",
        headers=_auth(stranger),
        json={"notes": "stolen"},
    )
    assert patched.status_code == 404
    db_session.refresh(secret)
    assert secret.notes == "owner-only-note"
    assert secret.user_id == owner.id

    # A user_id in the body cannot move the caller's own trade.
    moved = client.patch(
        f"/api/v1/trades/{own.id}",
        headers=_auth(stranger),
        json={"notes": "still-mine", "user_id": owner.id},
    )
    assert moved.status_code == 200
    db_session.refresh(own)
    assert own.user_id == stranger.id
    assert own.notes == "still-mine"

    deleted = client.delete(
        f"/api/v1/trades/{secret.id}",
        headers=_auth(stranger),
    )
    assert deleted.status_code == 404
    assert db_session.get(Trade, secret.id) is not None


def test_analyze_other_users_trade_does_not_run(client, db_session, app_modules, monkeypatch):
    owner = _user(db_session, "owner-ai@isolation.test")
    stranger = _user(db_session, "stranger-ai@isolation.test")
    secret = _trade(db_session, owner, pair="ETH/USDT", notes="ai-secret")
    db_session.commit()

    def _fail(*_args, **_kwargs):
        raise AssertionError("AI analysis ran for a trade the caller does not own")

    monkeypatch.setattr(app_modules["main"], "analyze_trade_sync", _fail)

    response = client.post(
        f"/api/v1/trades/{secret.id}/analyze",
        headers=_auth(stranger),
    )
    assert response.status_code == 404
    db_session.refresh(secret)
    assert secret.ai_report is None


def test_chat_session_is_not_readable_or_writable_by_others(client, db_session):
    owner = _user(db_session, "owner-chat@isolation.test")
    stranger = _user(db_session, "stranger-chat@isolation.test")
    now = datetime.now(timezone.utc)
    session = ChatSession(
        id=uuid.uuid4(),
        user_id=owner.id,
        title="private-thread",
        created_at=now,
        updated_at=now,
    )
    db_session.add(session)
    db_session.flush()
    db_session.add(
        ChatMessage(
            id=uuid.uuid4(),
            session_id=session.id,
            role="user",
            content="secret-chat-line",
            created_at=now,
        )
    )
    db_session.commit()

    listing = client.get("/api/v1/chat/sessions", headers=_auth(stranger))
    assert listing.status_code == 200
    assert listing.json() == []

    messages = client.get(
        f"/api/v1/chat/sessions/{session.id}/messages",
        headers=_auth(stranger),
    )
    assert messages.status_code == 404
    assert b"secret-chat-line" not in messages.content

    sent = client.post(
        "/api/v1/chat/send",
        headers=_auth(stranger),
        json={"session_id": str(session.id), "message": "intrusion"},
    )
    assert sent.status_code == 404
    count = (
        db_session.query(ChatMessage)
        .filter(ChatMessage.session_id == session.id)
        .count()
    )
    assert count == 1


def test_connect_job_status_is_owner_only(client, db_session, app_modules):
    owner = _user(db_session, "owner-job@isolation.test")
    stranger = _user(db_session, "stranger-job@isolation.test")
    db_session.commit()

    job_id = "job-isolation-1"
    app_modules["main"]._CONNECT_JOBS[job_id] = {
        "user_id": owner.id,
        "status": "done",
        "phase": "done",
        "exchange_name": "binance",
        "phases": {"backfill": {"status": "done", "marker": "owner-job-marker"}},
        "error": None,
    }
    try:
        denied = client.get(
            f"/api/v1/exchanges/binance/connect/{job_id}",
            headers=_auth(stranger),
        )
        assert denied.status_code == 404
        assert b"owner-job-marker" not in denied.content

        allowed = client.get(
            f"/api/v1/exchanges/binance/connect/{job_id}",
            headers=_auth(owner),
        )
        assert allowed.status_code == 200
        assert allowed.json()["phases"]["backfill"]["marker"] == "owner-job-marker"
    finally:
        app_modules["main"]._CONNECT_JOBS.pop(job_id, None)


def test_credentials_are_not_visible_or_deletable_by_others(
    client, db_session, app_modules, monkeypatch
):
    owner = _user(db_session, "owner-keys@isolation.test")
    stranger = _user(db_session, "stranger-keys@isolation.test")
    db_session.add(
        APIKey(
            user_id=owner.id,
            exchange_name="binance",
            api_key_encrypted="enc-key",
            api_secret_encrypted="enc-secret",
        )
    )
    db_session.commit()

    status_resp = client.get(
        "/api/v1/exchanges/credentials/status",
        headers=_auth(stranger),
    )
    assert status_resp.status_code == 200
    body = status_resp.json()
    assert body["binance_connected"] is False
    assert body["connected_exchanges"] == []
    assert "enc-key" not in status_resp.text

    async def _noop_stop(_user_id: int, _account_type: str) -> None:
        return None

    monkeypatch.setattr(app_modules["main"], "stop_binance_ws", _noop_stop)

    deleted = client.delete(
        "/api/v1/exchanges/credentials/binance",
        headers=_auth(stranger),
    )
    assert deleted.status_code == 404
    remaining = (
        db_session.query(APIKey)
        .filter(APIKey.user_id == owner.id, APIKey.exchange_name == "binance")
        .one()
    )
    assert remaining.api_key_encrypted == "enc-key"


def test_constructor_board_is_per_user(client, db_session):
    owner = _user(db_session, "owner-board@isolation.test")
    stranger = _user(db_session, "stranger-board@isolation.test")
    now = datetime.now(timezone.utc)
    db_session.add(
        ConstructorBoard(
            id=uuid.uuid4(),
            user_id=owner.id,
            revision=7,
            payload=default_payload(),
            created_at=now,
            updated_at=now,
        )
    )
    db_session.commit()

    own = client.get("/api/v1/constructor/board", headers=_auth(owner))
    assert own.status_code == 200
    assert own.json()["exists"] is True
    assert own.json()["revision"] == 7

    other = client.get("/api/v1/constructor/board", headers=_auth(stranger))
    assert other.status_code == 200
    assert other.json()["exists"] is False
    assert other.json()["revision"] == 0
