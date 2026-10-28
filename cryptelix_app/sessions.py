"""Refresh-token session management + cookie/CSRF helpers (4.7).

Session model (see models.AuthSession):
- Access token: short-lived JWT (see auth.create_access_token), sent in the
  response body and carried by the frontend in the Authorization header.
- Refresh token: long-lived opaque secret, stored ONLY as a SHA-256 hash in
  `auth_sessions`, delivered to the browser as an httpOnly cookie. Rotated on
  every refresh; reuse of a revoked token revokes the whole user's sessions.
- CSRF: a random token mirrored in a non-httpOnly cookie and echoed in the
  response body. Cookie endpoints (refresh/logout) require the matching
  `X-CSRF-Token` header (double-submit). Bearer-authenticated endpoints do not
  need CSRF because an attacker site cannot set the Authorization header.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from models import AuthSession, User

def _refresh_token_days() -> int:
    raw = (os.getenv("REFRESH_TOKEN_DAYS") or "").strip()
    if not raw:
        raise RuntimeError("REFRESH_TOKEN_DAYS is not set in the environment.")
    return int(raw)


REFRESH_TOKEN_DAYS = _refresh_token_days()

REFRESH_COOKIE_NAME = "cryptelix_refresh"
CSRF_COOKIE_NAME = "cryptelix_csrf"
CSRF_HEADER_NAME = "x-csrf-token"

# Path-scope the refresh cookie to the auth routes so it is not attached to
# every API call. CSRF cookie is site-wide so the frontend JS can read it.
_REFRESH_COOKIE_PATH = "/api/v1/auth"
_CSRF_COOKIE_PATH = "/"

_IS_PRODUCTION = (os.getenv("ENVIRONMENT") or "development").strip().lower() in {
    "production",
    "prod",
}
# Secure only over HTTPS (prod). Local dev is http://localhost -> must be False.
_COOKIE_SECURE = _IS_PRODUCTION
# In prod set COOKIE_DOMAIN=.cryptelix.app so the cookie is first-party for both
# cryptelix.app (frontend) and api.cryptelix.app (backend). Unset locally.
_COOKIE_DOMAIN = (os.getenv("COOKIE_DOMAIN") or "").strip() or None


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def _generate_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def _clip(value: str | None, length: int) -> str | None:
    if not value:
        return None
    return value[:length] or None


# --------------------------------------------------------------------------- #
# Session lifecycle
# --------------------------------------------------------------------------- #
def create_session(
    db: Session,
    user: User,
    *,
    user_agent: str | None = None,
    ip: str | None = None,
) -> str:
    """Create a new refresh session and return the plaintext refresh token."""
    raw = _generate_refresh_token()
    row = AuthSession(
        user_id=user.id,
        refresh_token_hash=_hash_token(raw),
        expires_at=_now() + timedelta(days=REFRESH_TOKEN_DAYS),
        user_agent=_clip(user_agent, 400),
        ip=_clip(ip, 64),
    )
    db.add(row)
    db.commit()
    return raw


def _load_by_raw(db: Session, raw: str) -> AuthSession | None:
    return (
        db.query(AuthSession)
        .filter(AuthSession.refresh_token_hash == _hash_token(raw))
        .one_or_none()
    )


def rotate_session(
    db: Session,
    raw: str,
    *,
    user_agent: str | None = None,
    ip: str | None = None,
) -> tuple[User, str]:
    """Validate + rotate a refresh token. Returns (user, new_raw_token).

    Raises 401 on invalid/expired/reused tokens. Reuse of an already-revoked
    token revokes every active session for that user (token theft response).
    """
    row = _load_by_raw(db, raw)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session"
        )

    now = _now()

    if row.revoked_at is not None:
        # Someone presented a token we already rotated away -> likely theft.
        revoke_all_for_user(db, row.user_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session reuse detected"
        )

    if row.expires_at <= now:
        row.revoked_at = now
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired"
        )

    user = db.get(User, row.user_id)
    if user is None:
        row.revoked_at = now
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session"
        )

    new_raw = _generate_refresh_token()
    new_row = AuthSession(
        user_id=user.id,
        refresh_token_hash=_hash_token(new_raw),
        expires_at=now + timedelta(days=REFRESH_TOKEN_DAYS),
        rotated_from=row.id,
        user_agent=_clip(user_agent, 400),
        ip=_clip(ip, 64),
    )
    row.revoked_at = now
    row.last_used_at = now
    db.add(new_row)
    db.commit()
    return user, new_raw


def revoke_session(db: Session, raw: str) -> None:
    """Revoke a single session identified by its refresh token (idempotent)."""
    row = _load_by_raw(db, raw)
    if row is not None and row.revoked_at is None:
        row.revoked_at = _now()
        db.commit()


def revoke_all_for_user(db: Session, user_id: int) -> None:
    """Revoke every active session for a user (logout-all / theft response)."""
    db.query(AuthSession).filter(
        AuthSession.user_id == user_id,
        AuthSession.revoked_at.is_(None),
    ).update({AuthSession.revoked_at: _now()}, synchronize_session=False)
    db.commit()


# --------------------------------------------------------------------------- #
# Cookies + CSRF
# --------------------------------------------------------------------------- #
def set_refresh_cookie(response: Response, raw: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        raw,
        max_age=REFRESH_TOKEN_DAYS * 24 * 3600,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
        domain=_COOKIE_DOMAIN,
        path=_REFRESH_COOKIE_PATH,
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        REFRESH_COOKIE_NAME,
        domain=_COOKIE_DOMAIN,
        path=_REFRESH_COOKIE_PATH,
    )


def issue_csrf(response: Response) -> str:
    """Set a fresh CSRF cookie and return its value (to echo in the body)."""
    token = _generate_csrf_token()
    response.set_cookie(
        CSRF_COOKIE_NAME,
        token,
        max_age=REFRESH_TOKEN_DAYS * 24 * 3600,
        httponly=False,  # frontend JS reads this to build the X-CSRF-Token header
        secure=_COOKIE_SECURE,
        samesite="lax",
        domain=_COOKIE_DOMAIN,
        path=_CSRF_COOKIE_PATH,
    )
    return token


def clear_csrf_cookie(response: Response) -> None:
    response.delete_cookie(
        CSRF_COOKIE_NAME,
        domain=_COOKIE_DOMAIN,
        path=_CSRF_COOKIE_PATH,
    )


def validate_csrf(request: Request) -> None:
    """Double-submit check for cookie-authenticated endpoints."""
    cookie = request.cookies.get(CSRF_COOKIE_NAME)
    header = request.headers.get(CSRF_HEADER_NAME)
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed",
        )
