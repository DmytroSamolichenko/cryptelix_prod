"""
Invite an alpha user by email (password_hash stays NULL until they activate in Sign In).

Usage:
    python invite_user.py user@example.com
    python invite_user.py user@example.com --username "Display Name"
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from sqlalchemy import func

from database import SessionLocal
from models import User


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def invite_user(email: str, username: str | None = None) -> User:
    normalized = _normalize_email(email)
    if not normalized or "@" not in normalized:
        raise ValueError(f"Invalid email: {email!r}")

    db = SessionLocal()
    try:
        existing = (
            db.query(User)
            .filter(func.lower(User.email) == normalized)
            .first()
        )
        if existing is not None:
            raise ValueError(
                f"User already exists: id={existing.id} email={existing.email}"
            )

        row = User(
            email=normalized,
            username=username.strip() if username else None,
            password_hash=None,
            created_at=datetime.now(tz=timezone.utc).replace(tzinfo=None),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Invite alpha user by email")
    parser.add_argument("email", help="Invite email (stored lowercase)")
    parser.add_argument(
        "--username",
        help="Optional display name",
        default=None,
    )
    args = parser.parse_args()

    try:
        user = invite_user(args.email, args.username)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Failed to invite user: {exc}", file=sys.stderr)
        return 1

    print(f"Invited user id={user.id} email={user.email} password_hash=NULL")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
