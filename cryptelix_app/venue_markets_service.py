"""
Perp market listing / cross-venue coverage matrix.

No DB — adapters cache market lists in memory.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from backpack_market_service import BackpackMarketError
from backpack_market_service import list_perp_markets as backpack_markets
from pacifica_market_service import PacificaMarketError
from pacifica_market_service import list_perp_markets as pacifica_markets
from phoenix_market_service import PhoenixMarketError
from phoenix_market_service import list_perp_markets as phoenix_markets

COVERAGE_VENUES = ("phoenix", "backpack", "pacifica")
# Hard limits for query params — symbols are never passed to a shell/SQL.
MAX_BASES_PER_REQUEST = 12
MAX_BASE_LEN = 16
_BASE_RE = re.compile(r"^[A-Z0-9]{1,16}$")


class VenueMarketsError(Exception):
    """Invalid venue args or upstream market-list failure."""


def sanitize_base_symbol(raw: object) -> str | None:
    """Allow only uppercase alphanumerics; strip pair suffixes when present."""
    if raw is None:
        return None
    s = str(raw).strip().upper()
    for ch in ("/", "-", "_", " ", "."):
        s = s.replace(ch, "")
    if s.endswith("PERP"):
        s = s[: -len("PERP")]
    for quote in ("USDT", "USDC", "USD", "BUSD"):
        if s.endswith(quote) and len(s) > len(quote):
            s = s[: -len(quote)]
            break
    if not _BASE_RE.fullmatch(s):
        return None
    return s


def _list_for_venue(venue: str) -> dict[str, Any]:
    v = (venue or "").strip().lower()
    try:
        if v == "phoenix":
            return phoenix_markets()
        if v == "backpack":
            return backpack_markets()
        if v == "pacifica":
            return pacifica_markets()
    except (PhoenixMarketError, BackpackMarketError, PacificaMarketError) as exc:
        raise VenueMarketsError(str(exc)) from exc
    raise VenueMarketsError(
        f"Unsupported venue {venue!r}. Use: {', '.join(COVERAGE_VENUES)}"
    )


def get_venue_markets(venue: str) -> dict[str, Any]:
    return _list_for_venue(venue)


def get_markets_coverage(
    *,
    bases: list[str] | tuple[str, ...],
    venues: list[str] | tuple[str, ...] | None = None,
) -> dict[str, Any]:
    cleaned_venues: list[str] = []
    for raw in venues or COVERAGE_VENUES:
        v = str(raw).strip().lower()
        if v in COVERAGE_VENUES and v not in cleaned_venues:
            cleaned_venues.append(v)
    if not cleaned_venues:
        cleaned_venues = list(COVERAGE_VENUES)

    cleaned_bases: list[str] = []
    for raw in bases:
        b = sanitize_base_symbol(raw)
        if b and b not in cleaned_bases:
            cleaned_bases.append(b)
        if len(cleaned_bases) >= MAX_BASES_PER_REQUEST:
            break
    if not cleaned_bases:
        raise VenueMarketsError(
            f"At least one valid base symbol is required "
            f"(A–Z / 0–9, max {MAX_BASE_LEN} chars)"
        )

    listed_by_venue: dict[str, set[str]] = {}
    errors: dict[str, str] = {}
    for v in cleaned_venues:
        try:
            payload = _list_for_venue(v)
            symbols: set[str] = set()
            for row in payload.get("markets") or []:
                if not isinstance(row, dict):
                    continue
                base = str(row.get("base") or row.get("symbol") or "").upper()
                if base:
                    symbols.add(base)
            listed_by_venue[v] = symbols
        except VenueMarketsError as exc:
            errors[v] = str(exc)
            listed_by_venue[v] = set()

    matrix: dict[str, dict[str, bool]] = {}
    for base in cleaned_bases:
        matrix[base] = {
            v: base in listed_by_venue.get(v, set()) for v in cleaned_venues
        }

    return {
        "bases": cleaned_bases,
        "venues": cleaned_venues,
        "matrix": matrix,
        "errors": errors or None,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "disclaimer": (
            "Coverage from public market lists. Symbol normalization may differ by venue."
        ),
    }
