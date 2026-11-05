"""
Perp trading fee comparator across venues.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from backpack_market_service import BackpackMarketError
from backpack_market_service import get_fee_schedule as backpack_fees
from pacifica_market_service import PacificaMarketError
from pacifica_market_service import get_fee_schedule as pacifica_fees
from phoenix_market_service import PhoenixMarketError
from phoenix_market_service import get_fee_schedule as phoenix_fees

FEE_VENUES = ("phoenix", "backpack", "pacifica", "binance")

# Binance USDT-M VIP0 baseline (educational).
BINANCE_VIP0_MAKER_BPS = 2.0
BINANCE_VIP0_TAKER_BPS = 5.0
BINANCE_FEES_AS_OF = "2026-11-05"

FeeSide = Literal["maker", "taker", "round_trip"]


class VenueFeesError(Exception):
    """Invalid fee-compare args or upstream failure."""


def _binance_fee_schedule() -> dict[str, Any]:
    return {
        "venue": "binance",
        "maker_bps": BINANCE_VIP0_MAKER_BPS,
        "taker_bps": BINANCE_VIP0_TAKER_BPS,
        "tier": "VIP0",
        "as_of": BINANCE_FEES_AS_OF,
        "source": "config",
        "note": "Binance USDT-M VIP0 baseline (no BNB discount).",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
    }


def get_venue_fee_schedule(venue: str) -> dict[str, Any]:
    v = (venue or "").strip().lower()
    try:
        if v == "binance":
            return _binance_fee_schedule()
        if v == "phoenix":
            return phoenix_fees("SOL")
        if v == "backpack":
            return backpack_fees()
        if v == "pacifica":
            return pacifica_fees()
    except (PhoenixMarketError, BackpackMarketError, PacificaMarketError) as exc:
        raise VenueFeesError(str(exc)) from exc
    raise VenueFeesError(
        f"Unsupported venue {venue!r}. Use: {', '.join(FEE_VENUES)}"
    )


def _fee_usd(maker_bps: float, taker_bps: float, notional: float, side: str) -> float:
    if side == "maker":
        return notional * (maker_bps / 10_000.0)
    if side == "taker":
        return notional * (taker_bps / 10_000.0)
    # round_trip taker+taker default (educational)
    return notional * (2.0 * taker_bps / 10_000.0)


def compare_venue_fees(
    *,
    venues: list[str] | tuple[str, ...] | None = None,
    notional: float = 10_000.0,
    side: str = "taker",
) -> dict[str, Any]:
    side_norm = (side or "taker").strip().lower()
    if side_norm not in ("maker", "taker", "round_trip"):
        raise VenueFeesError("side must be maker | taker | round_trip")
    if notional <= 0:
        raise VenueFeesError("notional must be > 0")

    cleaned: list[str] = []
    for raw in venues or FEE_VENUES:
        v = str(raw).strip().lower()
        if v in FEE_VENUES and v not in cleaned:
            cleaned.append(v)
    if not cleaned:
        cleaned = list(FEE_VENUES)

    rows: list[dict[str, Any]] = []
    errors: dict[str, str] = {}
    for v in cleaned:
        try:
            sched = get_venue_fee_schedule(v)
            maker_bps = float(sched["maker_bps"])
            taker_bps = float(sched["taker_bps"])
            rows.append(
                {
                    "venue": v,
                    "maker_bps": maker_bps,
                    "taker_bps": taker_bps,
                    "fee_usd": _fee_usd(maker_bps, taker_bps, notional, side_norm),
                    "tier": sched.get("tier"),
                    "source": sched.get("source"),
                    "as_of": sched.get("as_of"),
                    "note": sched.get("note"),
                }
            )
        except VenueFeesError as exc:
            errors[v] = str(exc)

    if not rows:
        raise VenueFeesError(
            f"Could not fetch fees for any venue: {errors or 'unknown'}"
        )

    cheapest = min(rows, key=lambda r: float(r["fee_usd"]))["venue"]
    return {
        "notional": notional,
        "side": side_norm,
        "venues": cleaned,
        "rows": rows,
        "cheapest_venue": cheapest,
        "errors": errors or None,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "disclaimers": [
            "Perp trading fees only — excludes funding, borrow, and gas.",
            "Tier / VIP / referral discounts may differ from shown baseline.",
            "Educational comparison — not financial advice.",
        ],
    }
