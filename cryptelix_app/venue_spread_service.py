"""
L2 touch spread across CLOB perp venues.
"""

from __future__ import annotations

from typing import Any

from backpack_market_service import BackpackMarketError
from backpack_market_service import get_orderbook_snapshot as backpack_book
from pacifica_market_service import PacificaMarketError
from pacifica_market_service import get_orderbook_snapshot as pacifica_book
from phoenix_market_service import PhoenixMarketError
from phoenix_market_service import get_orderbook_snapshot as phoenix_book

SPREAD_VENUES = ("phoenix", "backpack", "pacifica")


class VenueSpreadError(Exception):
    """Invalid venue args or empty orderbook."""


def _book_for_venue(venue: str, symbol: str) -> dict[str, Any]:
    v = (venue or "").strip().lower()
    try:
        if v == "phoenix":
            return phoenix_book(symbol)
        if v == "backpack":
            return backpack_book(symbol)
        if v == "pacifica":
            return pacifica_book(symbol)
    except (PhoenixMarketError, BackpackMarketError, PacificaMarketError) as exc:
        raise VenueSpreadError(str(exc)) from exc
    raise VenueSpreadError(
        f"Unsupported venue {venue!r}. Use: {', '.join(SPREAD_VENUES)}"
    )


def get_venue_spread(venue: str, symbol: str) -> dict[str, Any]:
    v = (venue or "").strip().lower()
    if v not in SPREAD_VENUES:
        raise VenueSpreadError(
            f"Unsupported venue {venue!r}. Use: {', '.join(SPREAD_VENUES)}"
        )
    book = _book_for_venue(v, symbol)
    bids = book.get("bids") or []
    asks = book.get("asks") or []
    if not bids or not asks:
        raise VenueSpreadError(f"Empty orderbook for {v} {symbol}")

    bid = float(bids[0]["price"])
    ask = float(asks[0]["price"])
    mid = book.get("mid")
    try:
        mid_f = float(mid) if mid is not None else (bid + ask) / 2.0
    except (TypeError, ValueError):
        mid_f = (bid + ask) / 2.0
    if mid_f <= 0:
        raise VenueSpreadError("Invalid mid price")

    spread_abs = ask - bid
    spread_bps = (spread_abs / mid_f) * 10_000.0

    return {
        "venue": v,
        "symbol": book.get("symbol") or str(symbol).strip().upper(),
        "venue_symbol": book.get("venue_symbol"),
        "bid": bid,
        "ask": ask,
        "mid": mid_f,
        "spread_abs": spread_abs,
        "spread_bps": spread_bps,
        "bid_levels": book.get("bid_levels"),
        "ask_levels": book.get("ask_levels"),
        "fetched_at": book.get("fetched_at"),
        "cached": bool(book.get("cached")),
        "source": book.get("source"),
        "mode": "snapshot",
        "disclaimer": (
            "Touch spread from public L2 snapshot: (ask − bid) / mid × 10000 bps. "
            "Educational only."
        ),
    }


def compare_venue_spreads(
    symbol: str,
    venues: list[str] | tuple[str, ...] | None = None,
) -> dict[str, Any]:
    cleaned: list[str] = []
    for raw in venues or SPREAD_VENUES:
        v = str(raw).strip().lower()
        if v in SPREAD_VENUES and v not in cleaned:
            cleaned.append(v)
    if not cleaned:
        cleaned = list(SPREAD_VENUES)

    rows: list[dict[str, Any]] = []
    errors: dict[str, str] = {}
    for v in cleaned:
        try:
            rows.append(get_venue_spread(v, symbol))
        except VenueSpreadError as exc:
            errors[v] = str(exc)

    if not rows:
        raise VenueSpreadError(
            f"Could not fetch spread for any venue: {errors or 'unknown'}"
        )

    tightest = min(rows, key=lambda r: float(r["spread_bps"]))["venue"]
    return {
        "symbol": str(symbol).strip().upper(),
        "venues": rows,
        "tightest_venue": tightest,
        "errors": errors or None,
        "disclaimer": (
            "Touch spreads compared across public L2 snapshots. Educational only."
        ),
    }
