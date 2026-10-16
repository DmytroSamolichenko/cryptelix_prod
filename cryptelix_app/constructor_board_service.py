"""
Personal Constructor board persistence (JSONB snapshot per user).

- Max 5 canvases (API-enforced).
- Encrypts text-field html/text at rest via MASTER_KEY Fernet.
- Optimistic concurrency via revision.
"""

from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from models import ConstructorBoard
from security import decrypt_data, encrypt_data

MAX_CANVASES = 5
PAYLOAD_VERSION = 1
TEXT_ENC_FLAG = "textEncrypted"


class ConstructorBoardError(Exception):
    """Validation or conflict failure for constructor boards."""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def default_payload() -> dict[str, Any]:
    canvas_id = "canvas-1"
    return {
        "version": PAYLOAD_VERSION,
        "activeCanvasId": canvas_id,
        "brushColor": "#ffffff",
        "drawingsByCanvasId": {},
        "canvases": [
            {
                "id": canvas_id,
                "name": "Dashboard 1",
                "widgets": [
                    {
                        "id": "widget-1",
                        "type": "table",
                        "title": "Full Trading Report",
                        "position": {"x": 50, "y": 50},
                        "size": {"width": 600, "height": 500},
                        "layer": 0,
                    },
                    {
                        "id": "widget-2",
                        "type": "stats-card",
                        "title": "Key Metrics",
                        "position": {"x": 700, "y": 50},
                        "size": {"width": 450, "height": 320},
                        "layer": 0,
                    },
                    {
                        "id": "widget-3",
                        "type": "line-chart",
                        "title": "Price Chart",
                        "position": {"x": 50, "y": 600},
                        "size": {"width": 500, "height": 300},
                        "layer": 0,
                    },
                    {
                        "id": "widget-4",
                        "type": "bar-chart",
                        "title": "Wins vs Losses",
                        "position": {"x": 600, "y": 600},
                        "size": {"width": 500, "height": 300},
                        "layer": 0,
                    },
                ],
            }
        ],
    }


def _as_dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: object) -> list[Any]:
    return value if isinstance(value, list) else []


def _normalize_widget(raw: object) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    wid = raw.get("id")
    wtype = raw.get("type")
    if not isinstance(wid, str) or not wid.strip():
        return None
    if not isinstance(wtype, str) or not wtype.strip():
        return None
    out = copy.deepcopy(raw)
    out["id"] = wid.strip()
    out["type"] = wtype.strip()
    if not isinstance(out.get("title"), str):
        out["title"] = out["type"]
    pos = _as_dict(out.get("position"))
    try:
        out["position"] = {"x": float(pos.get("x", 0)), "y": float(pos.get("y", 0))}
    except (TypeError, ValueError):
        out["position"] = {"x": 0.0, "y": 0.0}
    size = _as_dict(out.get("size"))
    try:
        out["size"] = {
            "width": float(size.get("width", 400)),
            "height": float(size.get("height", 320)),
        }
    except (TypeError, ValueError):
        out["size"] = {"width": 400.0, "height": 320.0}
    try:
        layer = int(out.get("layer", 0))
    except (TypeError, ValueError):
        layer = 0
    out["layer"] = layer
    data = out.get("data")
    if data is not None and not isinstance(data, dict):
        out["data"] = {}
    return out


def _normalize_canvas(raw: object) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    cid = raw.get("id")
    name = raw.get("name")
    if not isinstance(cid, str) or not cid.strip():
        return None
    if not isinstance(name, str) or not name.strip():
        name = "Dashboard"
    widgets_in = _as_list(raw.get("widgets"))
    widgets: list[dict[str, Any]] = []
    for w in widgets_in:
        nw = _normalize_widget(w)
        if nw is not None:
            widgets.append(nw)
    return {"id": cid.strip(), "name": name.strip(), "widgets": widgets}


def normalize_payload(raw: object) -> dict[str, Any]:
    """Validate + normalize client payload; raises ConstructorBoardError."""
    if not isinstance(raw, dict):
        raise ConstructorBoardError("payload must be an object")

    canvases_raw = _as_list(raw.get("canvases"))
    canvases: list[dict[str, Any]] = []
    for c in canvases_raw:
        nc = _normalize_canvas(c)
        if nc is not None:
            canvases.append(nc)

    if not canvases:
        raise ConstructorBoardError("payload.canvases must contain at least one canvas")
    if len(canvases) > MAX_CANVASES:
        raise ConstructorBoardError(
            f"Maximum {MAX_CANVASES} canvases allowed",
            status_code=400,
        )

    active = raw.get("activeCanvasId")
    if not isinstance(active, str) or not any(c["id"] == active for c in canvases):
        active = canvases[0]["id"]

    brush = raw.get("brushColor")
    if not isinstance(brush, str) or not brush.strip():
        brush = "#ffffff"

    drawings = raw.get("drawingsByCanvasId")
    if not isinstance(drawings, dict):
        drawings = {}
    drawings_out: dict[str, str] = {}
    canvas_ids = {c["id"] for c in canvases}
    for k, v in drawings.items():
        if not isinstance(k, str) or k not in canvas_ids:
            continue
        if isinstance(v, str):
            drawings_out[k] = v
        elif v is None:
            continue
        else:
            # Allow accidental object; stringify for storage compatibility with FE.
            try:
                import json

                drawings_out[k] = json.dumps(v)
            except (TypeError, ValueError):
                continue

    return {
        "version": PAYLOAD_VERSION,
        "canvases": canvases,
        "activeCanvasId": active,
        "drawingsByCanvasId": drawings_out,
        "brushColor": brush.strip(),
    }


def _encrypt_text_fields(payload: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(payload)
    for canvas in out.get("canvases") or []:
        for widget in canvas.get("widgets") or []:
            if widget.get("type") != "text-field":
                continue
            data = widget.get("data")
            if not isinstance(data, dict):
                continue
            if data.get(TEXT_ENC_FLAG):
                continue
            changed = False
            for key in ("html", "text"):
                val = data.get(key)
                if isinstance(val, str) and val != "":
                    data[key] = encrypt_data(val)
                    changed = True
            if changed:
                data[TEXT_ENC_FLAG] = True
            widget["data"] = data
    return out


def _decrypt_text_fields(payload: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(payload)
    for canvas in out.get("canvases") or []:
        for widget in canvas.get("widgets") or []:
            if widget.get("type") != "text-field":
                continue
            data = widget.get("data")
            if not isinstance(data, dict) or not data.get(TEXT_ENC_FLAG):
                continue
            for key in ("html", "text"):
                val = data.get(key)
                if isinstance(val, str) and val != "":
                    try:
                        data[key] = decrypt_data(val)
                    except ValueError:
                        # Leave as-is if token corrupt; client still gets flag cleared carefully.
                        pass
            data.pop(TEXT_ENC_FLAG, None)
            widget["data"] = data
    return out


def get_board(db: Session, user_id: int) -> dict[str, Any]:
    row = (
        db.query(ConstructorBoard)
        .filter(ConstructorBoard.user_id == user_id)
        .one_or_none()
    )
    if row is None:
        payload = default_payload()
        return {"revision": 0, "payload": payload, "exists": False}

    raw_payload = row.payload if isinstance(row.payload, dict) else default_payload()
    try:
        normalized = normalize_payload(raw_payload)
    except ConstructorBoardError:
        normalized = default_payload()
    plaintext = _decrypt_text_fields(normalized)
    return {
        "revision": int(row.revision or 1),
        "payload": plaintext,
        "exists": True,
    }


def upsert_board(
    db: Session,
    user_id: int,
    payload_raw: object,
    expected_revision: int,
) -> dict[str, Any]:
    normalized = normalize_payload(payload_raw)
    encrypted = _encrypt_text_fields(normalized)

    row = (
        db.query(ConstructorBoard)
        .filter(ConstructorBoard.user_id == user_id)
        .one_or_none()
    )
    now = datetime.now(timezone.utc)

    if row is None:
        # First save: accept expected_revision 0 or 1.
        if expected_revision not in (0, 1):
            raise ConstructorBoardError(
                "Board revision conflict",
                status_code=409,
            )
        row = ConstructorBoard(
            id=uuid.uuid4(),
            user_id=user_id,
            revision=1,
            payload=encrypted,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {
            "revision": int(row.revision),
            "payload": _decrypt_text_fields(normalize_payload(row.payload)),
            "exists": True,
        }

    current = int(row.revision or 1)
    if int(expected_revision) != current:
        raise ConstructorBoardError(
            f"Board revision conflict (expected {expected_revision}, current {current})",
            status_code=409,
        )

    row.payload = encrypted
    row.revision = current + 1
    row.updated_at = now
    db.commit()
    db.refresh(row)
    return {
        "revision": int(row.revision),
        "payload": _decrypt_text_fields(normalize_payload(row.payload)),
        "exists": True,
    }
