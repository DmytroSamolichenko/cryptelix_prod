"""Feedback survey: one row per user, status machine + helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import Feedback

STATUS_NOT_OFFERED = "not_offered"
STATUS_SKIPPED = "skipped"
STATUS_SUBMITTED = "submitted"

SKIP_COOLDOWN = timedelta(hours=1)
REQUIRED_ACTIVE_MS = 30 * 60 * 1000  # 30 minutes of visible app time


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_feedback_for_user(db: Session, user_id: int) -> Feedback | None:
    return (
        db.query(Feedback)
        .filter(Feedback.user_id == user_id)
        .order_by(Feedback.created_at.desc())
        .first()
    )


def ensure_feedback_row(db: Session, user_id: int) -> Feedback:
    """Create not_offered row on first app entry after login (idempotent)."""
    existing = get_feedback_for_user(db, user_id)
    if existing is not None:
        return existing

    row = Feedback(
        user_id=user_id,
        status=STATUS_NOT_OFFERED,
        created_at=_utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def build_status_payload(db: Session, user_id: int) -> dict[str, Any]:
    row = get_feedback_for_user(db, user_id)
    if row is None:
        return {
            "has_row": False,
            "status": None,
            "created_at": None,
            "skipped_at": None,
            "force": False,
            "can_offer": False,
            "required_active_ms": REQUIRED_ACTIVE_MS,
            "skip_cooldown_seconds": int(SKIP_COOLDOWN.total_seconds()),
        }

    force = False
    can_offer = False

    if row.status == STATUS_SUBMITTED:
        can_offer = False
    elif row.status == STATUS_NOT_OFFERED:
        # Client gates on active session time after created_at.
        can_offer = True
        force = False
    elif row.status == STATUS_SKIPPED:
        skipped_at = row.skipped_at
        if skipped_at is not None and skipped_at.tzinfo is None:
            skipped_at = skipped_at.replace(tzinfo=timezone.utc)
        if skipped_at is None or _utcnow() >= skipped_at + SKIP_COOLDOWN:
            can_offer = True
            force = True
        else:
            can_offer = False
            force = False
    else:
        can_offer = False

    return {
        "has_row": True,
        "status": row.status,
        "created_at": _iso(row.created_at),
        "skipped_at": _iso(row.skipped_at),
        "force": force,
        "can_offer": can_offer,
        "required_active_ms": REQUIRED_ACTIVE_MS,
        "skip_cooldown_seconds": int(SKIP_COOLDOWN.total_seconds()),
    }


def skip_feedback(db: Session, user_id: int) -> dict[str, Any]:
    row = get_feedback_for_user(db, user_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Feedback survey is not available yet.",
        )
    if row.status == STATUS_SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Survey already submitted.",
        )
    # Force re-offer after cooldown — skip is not allowed again.
    if row.status == STATUS_SKIPPED:
        skipped_at = row.skipped_at
        if skipped_at is not None and skipped_at.tzinfo is None:
            skipped_at = skipped_at.replace(tzinfo=timezone.utc)
        if skipped_at is None or _utcnow() >= skipped_at + SKIP_COOLDOWN:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This survey can no longer be skipped.",
            )

    row.status = STATUS_SKIPPED
    row.skipped_at = _utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    return build_status_payload(db, user_id)


def submit_feedback(
    db: Session,
    user_id: int,
    *,
    q1: int,
    q2: int,
    q3: int,
    comment: str | None,
) -> dict[str, Any]:
    for label, value in (("q1", q1), ("q2", q2), ("q3", q3)):
        if value not in (0, 1, 2):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{label} must be 0, 1, or 2.",
            )

    row = get_feedback_for_user(db, user_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Feedback survey is not available yet.",
        )
    if row.status == STATUS_SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Survey already submitted.",
        )

    row.q1 = q1
    row.q2 = q2
    row.q3 = q3
    row.comment = (comment or "").strip() or None
    row.status = STATUS_SUBMITTED
    row.submitted_at = _utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "status": STATUS_SUBMITTED,
        "submitted_at": _iso(row.submitted_at),
    }
