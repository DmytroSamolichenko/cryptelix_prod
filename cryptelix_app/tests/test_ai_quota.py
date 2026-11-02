"""Daily AI caps are per user and stop before the model is called."""

from __future__ import annotations

import uuid
from datetime import datetime

import ai_quota
import chat_service
from auth import create_access_token
from models import Trade, User


def _use_memory(monkeypatch) -> None:
    monkeypatch.setattr(ai_quota, "_redis", lambda: None)
    ai_quota._memory.clear()


def _user(db, email: str) -> User:
    user = User(
        email=email,
        username=email.split("@")[0],
        password_hash="not-used",
        token_version=0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _auth(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user)}"}


def _trade(db, user: User) -> Trade:
    trade = Trade(
        id=uuid.uuid4(),
        user_id=user.id,
        date=datetime(2026, 11, 2, 12, 0, 0),
        pair="BTC/USDT",
        side="buy",
        quantity="1",
        entry_price="1",
        pnl="1.00",
        is_manual=True,
        account_type="spot",
        exchange_trade_id="manual-quota",
        exchange_name="binance",
    )
    db.add(trade)
    db.commit()
    db.refresh(trade)
    return trade


def test_default_caps_are_the_beta_numbers(monkeypatch):
    monkeypatch.delenv("AI_ANALYZE_DAILY_LIMIT", raising=False)
    monkeypatch.delenv("AI_CHAT_DAILY_LIMIT", raising=False)
    assert ai_quota.analyze_daily_limit() == 10
    assert ai_quota.chat_daily_limit() == 30


def test_analyze_cap_is_per_user_and_skips_the_model(
    client, db_session, app_modules, monkeypatch
):
    _use_memory(monkeypatch)
    monkeypatch.setattr(ai_quota, "analyze_daily_limit", lambda: 2)
    calls = {"n": 0}

    def _fake_report(_trade, _user_id):
        calls["n"] += 1
        return "report"

    monkeypatch.setattr(app_modules["main"], "analyze_trade_sync", _fake_report)

    owner = _user(db_session, "quota-owner@isolation.test")
    other = _user(db_session, "quota-other@isolation.test")
    stranger = _user(db_session, "quota-stranger@isolation.test")
    own = _trade(db_session, owner)
    foreign = _trade(db_session, other)

    denied = client.post(
        f"/api/v1/trades/{foreign.id}/analyze",
        headers=_auth(stranger),
    )
    assert denied.status_code == 404
    assert calls["n"] == 0

    for _ in range(2):
        ok = client.post(
            f"/api/v1/trades/{own.id}/analyze",
            headers=_auth(owner),
        )
        assert ok.status_code == 200

    blocked = client.post(
        f"/api/v1/trades/{own.id}/analyze",
        headers=_auth(owner),
    )
    assert blocked.status_code == 429
    assert "Daily analysis limit reached (2)" in blocked.json()["detail"]
    assert calls["n"] == 2

    # Another account still has its own cap.
    other_ok = client.post(
        f"/api/v1/trades/{foreign.id}/analyze",
        headers=_auth(other),
    )
    assert other_ok.status_code == 200
    assert calls["n"] == 3


def test_chat_cap_is_per_user_and_skips_the_model(
    client, db_session, monkeypatch
):
    _use_memory(monkeypatch)
    monkeypatch.setattr(ai_quota, "chat_daily_limit", lambda: 2)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    calls = {"n": 0}

    def _fake_completion(*_args, **_kwargs):
        calls["n"] += 1
        return "ok"

    monkeypatch.setattr(chat_service, "_run_chat_completion_with_tools", _fake_completion)
    monkeypatch.setattr(chat_service, "log_from_acc", lambda **_kwargs: None)

    owner = _user(db_session, "quota-chat@isolation.test")
    for _ in range(2):
        ok = client.post(
            "/api/v1/chat/send",
            headers=_auth(owner),
            json={"message": "hello"},
        )
        assert ok.status_code == 200

    blocked = client.post(
        "/api/v1/chat/send",
        headers=_auth(owner),
        json={"message": "one more"},
    )
    assert blocked.status_code == 429
    assert "Daily chat limit reached (2)" in blocked.json()["detail"]
    assert calls["n"] == 2
