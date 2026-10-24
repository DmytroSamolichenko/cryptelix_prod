"""
Position impact calculator: L2 book walk → slippage + book (touch) impact.

V_order = margin * leverage (quote notional).
Walk asks for long / bids for short until notional is filled.
"""

from __future__ import annotations

from typing import Any, Literal

from phoenix_market_service import PhoenixMarketError
from phoenix_market_service import get_orderbook_snapshot as phoenix_orderbook

SUPPORTED_IMPACT_VENUES = ("phoenix",)

Side = Literal["long", "short"]

# Relative epsilon for "level fully consumed" (float-safe).
_LEVEL_EPS_REL = 1e-9
_ABS_EPS = 1e-12


class VenuePriceImpactError(Exception):
    """Invalid args or upstream market-data failure."""


def _level_eps(qty: float) -> float:
    return max(_ABS_EPS, abs(qty) * _LEVEL_EPS_REL)


def walk_book_notional(
    levels: list[dict[str, float]],
    v_order: float,
) -> dict[str, Any]:
    """
    Dollar-budget walk across sorted book levels.

    Each level: {"price": P_i, "quantity": Q_i} in base units.
    Level quote capacity V_i = P_i * Q_i.

    Returns fill metrics + new touch estimate after the simulated order.
    """
    if v_order <= 0:
        raise VenuePriceImpactError("notional (margin × leverage) must be > 0")
    if not levels:
        return {
            "sufficient_liquidity": False,
            "p_best": None,
            "p_avg": None,
            "p_new": None,
            "slippage_pct": None,
            "book_impact_pct": None,
            "filled_notional": 0.0,
            "unfilled_notional": float(v_order),
            "filled_base_qty": 0.0,
            "levels_used": 0,
            "best_fully_consumed": False,
            "book_exhausted": True,
        }

    p_best = float(levels[0]["price"])
    accumulated_quote = 0.0
    accumulated_base = 0.0
    levels_used = 0
    p_new: float | None = p_best
    best_fully_consumed = False
    book_exhausted = False

    for idx, level in enumerate(levels):
        price = float(level["price"])
        qty = float(level["quantity"])
        if price <= 0 or qty <= 0:
            continue

        remaining = v_order - accumulated_quote
        if remaining <= _ABS_EPS:
            break

        level_quote = price * qty
        levels_used += 1

        if level_quote + _ABS_EPS < remaining:
            # Consume entire level.
            accumulated_quote += level_quote
            accumulated_base += qty
            if idx == 0:
                best_fully_consumed = True
            # Touch moves to next level if this was the current best.
            if idx + 1 < len(levels):
                p_new = float(levels[idx + 1]["price"])
            else:
                p_new = None
                book_exhausted = True
            continue

        # Partial fill on this level.
        q_residual = remaining / price
        accumulated_quote += remaining
        accumulated_base += q_residual
        leftover = qty - q_residual
        if leftover <= _level_eps(qty):
            # Level effectively wiped.
            if idx == 0:
                best_fully_consumed = True
            if idx + 1 < len(levels):
                p_new = float(levels[idx + 1]["price"])
            else:
                p_new = None
                book_exhausted = True
        else:
            p_new = price
        break
    else:
        # Ran out of book before filling v_order.
        book_exhausted = True
        p_new = None

    filled_notional = accumulated_quote
    unfilled = max(0.0, v_order - filled_notional)
    sufficient = unfilled <= max(_ABS_EPS, v_order * _LEVEL_EPS_REL)

    p_avg = (filled_notional / accumulated_base) if accumulated_base > _ABS_EPS else None

    slippage_pct = None
    if p_avg is not None and p_best > 0:
        slippage_pct = abs(p_avg - p_best) / p_best * 100.0

    book_impact_pct = None
    if p_new is not None and p_best > 0:
        book_impact_pct = abs(p_new - p_best) / p_best * 100.0

    return {
        "sufficient_liquidity": sufficient,
        "p_best": p_best,
        "p_avg": p_avg,
        "p_new": p_new,
        "slippage_pct": slippage_pct,
        "book_impact_pct": book_impact_pct,
        "filled_notional": filled_notional,
        "unfilled_notional": unfilled if not sufficient else 0.0,
        "filled_base_qty": accumulated_base,
        "levels_used": levels_used,
        "best_fully_consumed": best_fully_consumed,
        "book_exhausted": book_exhausted and not sufficient,
    }


def calculate_position_impact(
    *,
    venue: str,
    symbol: str,
    side: str,
    margin: float,
    leverage: float,
    use_cache: bool = True,
) -> dict[str, Any]:
    """
    Full calculator payload for the Position Impact widget.

    Long → walk asks; short → walk bids.
    Slippage vs P_best (touch); book impact = |P_new - P_best| / P_best.
    """
    venue_id = (venue or "").strip().lower()
    if venue_id not in SUPPORTED_IMPACT_VENUES:
        raise VenuePriceImpactError(
            f"Unsupported venue '{venue}'. Supported: {', '.join(SUPPORTED_IMPACT_VENUES)}"
        )

    side_norm = (side or "long").strip().lower()
    if side_norm not in ("long", "short"):
        raise VenuePriceImpactError("side must be long or short")

    if margin is None or float(margin) <= 0:
        raise VenuePriceImpactError("margin must be > 0")
    if leverage is None or float(leverage) <= 0:
        raise VenuePriceImpactError("leverage must be > 0")

    margin_f = float(margin)
    leverage_f = float(leverage)
    v_order = margin_f * leverage_f
    if v_order > 50_000_000:
        raise VenuePriceImpactError("notional (margin × leverage) is too large")

    try:
        if venue_id == "phoenix":
            book = phoenix_orderbook(symbol, use_cache=use_cache)
        else:
            raise VenuePriceImpactError(f"Unsupported venue '{venue_id}'")
    except PhoenixMarketError as exc:
        raise VenuePriceImpactError(str(exc)) from exc

    levels = book["asks"] if side_norm == "long" else book["bids"]
    walk = walk_book_notional(levels, v_order)

    return {
        "venue": venue_id,
        "symbol": book.get("symbol") or symbol,
        "venue_symbol": book.get("venue_symbol") or book.get("symbol"),
        "side": side_norm,
        "margin": margin_f,
        "leverage": leverage_f,
        "notional": v_order,
        "mid": book.get("mid"),
        "slot": book.get("slot"),
        "book_bid_levels": book.get("bid_levels"),
        "book_ask_levels": book.get("ask_levels"),
        "fetched_at": book.get("fetched_at"),
        "cached": bool(book.get("cached")),
        "source": book.get("source") or f"{venue_id}_perp_public",
        "mode": "snapshot",
        "disclaimer": (
            "Educational L2 walk on a public orderbook snapshot. "
            "Slippage = |P_avg − P_best| / P_best. "
            "Book impact = |P_new − P_best| / P_best (simulated new touch). "
            "Not a predicted mark/oracle move · not financial advice."
        ),
        **walk,
    }
