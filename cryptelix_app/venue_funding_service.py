"""
Normalize and compare perpetual funding across venues.

Venue HTTP clients stay in binance_market_service / phoenix_market_service;
this module only orchestrates snapshots and holding-cost math.
"""

from __future__ import annotations

from typing import Any

from binance_market_service import BinanceMarketError
from binance_market_service import get_funding_snapshot as binance_funding_snapshot
from phoenix_market_service import PhoenixMarketError
from phoenix_market_service import get_funding_snapshot as phoenix_funding_snapshot

SUPPORTED_VENUES = ("binance", "phoenix")


class VenueFundingError(Exception):
    """Invalid venue args or upstream market-data failure."""


def _holding_cost_usd(
    rate_per_24h: float | None,
    notional: float,
    position_side: str,
) -> float | None:
    """
    Approximate 24h funding payment in quote currency.

    Positive rate → longs pay shorts.
    Returned value: positive = you pay, negative = you receive.
    """
    if rate_per_24h is None:
        return None
    side = (position_side or "long").strip().lower()
    if side not in ("long", "short"):
        side = "long"
    # Long pays when rate > 0; short is opposite.
    signed = rate_per_24h if side == "long" else -rate_per_24h
    return notional * signed


def enrich_snapshot(
    snap: dict[str, Any],
    *,
    notional: float = 10_000.0,
    position_side: str = "long",
) -> dict[str, Any]:
    out = dict(snap)
    rate_24h = out.get("rate_per_24h")
    try:
        rate_f = float(rate_24h) if rate_24h is not None else None
    except (TypeError, ValueError):
        rate_f = None
    cost = _holding_cost_usd(rate_f, notional, position_side)
    out["notional"] = notional
    out["position_side"] = position_side if position_side in ("long", "short") else "long"
    out["est_cost_24h_usd"] = cost
    out["est_cost_24h_note"] = (
        "Approximate 24h funding cost on notional (positive = you pay). "
        "Educational estimate only — not a prediction."
    )
    return out


def get_venue_funding(
    venue: str,
    symbol: str,
    *,
    notional: float = 10_000.0,
    position_side: str = "long",
) -> dict[str, Any]:
    v = (venue or "").strip().lower()
    if v not in SUPPORTED_VENUES:
        raise VenueFundingError(
            f"Unsupported venue {venue!r}. Use: {', '.join(SUPPORTED_VENUES)}"
        )
    try:
        if v == "binance":
            snap = binance_funding_snapshot(symbol)
        else:
            snap = phoenix_funding_snapshot(symbol)
    except (BinanceMarketError, PhoenixMarketError) as exc:
        raise VenueFundingError(str(exc)) from exc
    return enrich_snapshot(snap, notional=notional, position_side=position_side)


def compare_venue_funding(
    symbol: str,
    venues: list[str] | tuple[str, ...],
    *,
    notional: float = 10_000.0,
    position_side: str = "long",
) -> dict[str, Any]:
    cleaned: list[str] = []
    for raw in venues:
        v = str(raw).strip().lower()
        if v in SUPPORTED_VENUES and v not in cleaned:
            cleaned.append(v)
    if len(cleaned) < 1:
        raise VenueFundingError("At least one venue is required")

    rows: list[dict[str, Any]] = []
    errors: dict[str, str] = {}
    for v in cleaned:
        try:
            rows.append(
                get_venue_funding(
                    v, symbol, notional=notional, position_side=position_side
                )
            )
        except VenueFundingError as exc:
            errors[v] = str(exc)

    if not rows:
        raise VenueFundingError(
            f"Could not fetch funding for any venue: {errors or 'unknown'}"
        )

    # Cheapest for the selected side = lowest est_cost_24h_usd (most negative / least pay).
    ranked = [r for r in rows if r.get("est_cost_24h_usd") is not None]
    cheapest = None
    if ranked:
        cheapest = min(ranked, key=lambda r: float(r["est_cost_24h_usd"]))["venue"]

    return {
        "symbol": str(symbol).strip().upper(),
        "notional": notional,
        "position_side": position_side if position_side in ("long", "short") else "long",
        "venues": rows,
        "cheapest_venue_24h": cheapest,
        "errors": errors or None,
        "disclaimer": (
            "Funding models differ (e.g. Binance interval settle vs Phoenix hourly/24h). "
            "24h estimates are normalized for comparison and are educational only."
        ),
    }
