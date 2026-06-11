from __future__ import annotations

import hmac
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import User
from password_utils import hash_password, validate_password_strength, verify_password

JWT_ALGORITHM = "HS256"
# H1: shorter default lifetime reduces the window of a stolen token.
JWT_EXPIRE_DAYS = int(os.getenv("JWT_EXPIRE_DAYS", "7"))

_bearer = HTTPBearer(auto_error=False)


def _jwt_secret() -> str:
    secret = (os.getenv("JWT_SECRET") or "").strip()
    if not secret:
        raise RuntimeError("JWT_SECRET is not set in the environment.")
    return secret


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _verify_invite_code(provided: str) -> None:
    """C1: require the shared alpha invite code to activate an account.

    Email presence in the whitelist is no longer sufficient on its own; the
    caller must also supply the secret code. Fails closed if not configured.
    """
    expected = (os.getenv("ALPHA_INVITE_CODE") or "").strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Account activation is not configured.",
        )
    if not hmac.compare_digest((provided or "").strip(), expected):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid invite code.",
        )


def create_access_token(user: User) -> str:
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "ver": int(user.token_version or 0),
        "iat": now,
        "exp": now + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


def get_user_by_email(db: Session, email: str) -> User | None:
    normalized = normalize_email(email)
    return (
        db.query(User)
        .filter(func.lower(User.email) == normalized)
        .first()
    )


def user_to_public(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
    }


def build_token_response(user: User) -> dict[str, Any]:
    return {
        "access_token": create_access_token(user),
        "token_type": "bearer",
        "user": user_to_public(user),
    }


def check_email_status(db: Session, email: str) -> dict[str, Any]:
    user = get_user_by_email(db, email)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This email is not invited.",
        )
    status_value = "needs_activation" if user.password_hash is None else "needs_login"
    return {"status": status_value, "email": user.email}


def activate_user(
    db: Session, email: str, password: str, invite_code: str
) -> dict[str, Any]:
    _verify_invite_code(invite_code)

    try:
        validate_password_strength(password)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    user = get_user_by_email(db, email)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This email is not invited.",
        )
    if user.password_hash is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account already activated. Please sign in.",
        )

    user.password_hash = hash_password(password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return build_token_response(user)


def login_user(db: Session, email: str, password: str) -> dict[str, Any]:
    user = get_user_by_email(db, email)
    if user is None or user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )
    if not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )
    return build_token_response(user)


def logout_user(db: Session, user: User) -> dict[str, Any]:
    """H1: revoke all of the user's active sessions by bumping token_version.

    Only flips an integer counter — no user data is modified or deleted.
    Any token issued before this point is rejected on the next request.
    """
    user.token_version = int(user.token_version or 0) + 1
    db.add(user)
    db.commit()
    return {"status": "ok"}


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    payload = decode_access_token(credentials.credentials)
    sub = payload.get("sub")
    if sub is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    try:
        user_id = int(sub)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        ) from exc

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    # H1: reject tokens issued before the user's token_version was bumped
    # (e.g. after a forced logout / password change / account revocation).
    token_version = payload.get("ver", 0)
    if int(user.token_version or 0) != int(token_version):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        )

    return user
