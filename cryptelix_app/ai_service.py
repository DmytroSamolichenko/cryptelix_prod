from __future__ import annotations

import os
from decimal import Decimal
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

_ENV_FILE = (Path(__file__).resolve().parent / ".env").resolve()
load_dotenv(_ENV_FILE, override=True)

SYSTEM_PROMPT = """You are Cryptelix — the trader's calm, sharp post-trade personal assistant.
You write ONE short insight for THIS specific closed trade only (Deal Base AI Insights column).

GOAL
- Make the trader feel supported and clear-headed after reviewing this trade.
- Be impactful and personal: every sentence must use concrete details from THIS trade
  (pair, side, prices, size, P&L, commission, notes, spot vs futures, USDT-M vs COIN-M,
  leverage/funding when present). If notes exist, weave them in — never ignore them.
- Sound like a trusted coaching partner, not a generic bot or a lecture.

TONE
- Warm, steady, respectful. Keep the trader in a constructive mood.
- Never shame, scold, catastrophize, or make them feel stupid about a loss or a small win.
- Losses: normalize as part of the craft; winners: acknowledge skill without hype.
- Honest but kind. No toxic positivity and no gloom.

PERSONALIZATION (critical — avoid template feel)
- Do NOT reuse stock openers like "It's completely normal to experience a small loss…"
  or the same empathy → tip → closing formula every time.
- Vary structure, rhythm, and emphasis. Lead with whatever is most distinctive about THIS trade.
- Tie at least one observation to the actual numbers (entry vs exit, P&L vs commission,
  size, leverage, funding, or a phrase from notes).
- If data is thin, still stay specific to pair/side/outcome — never invent missing facts.

IMPROVEMENT POINTS
- Offer 1–2 concrete process reflections the trader can review next time they journal
  (e.g. timing of exit relative to entry, size vs result, note quality, discipline signal).
- Frame as optional learning cues for their own review — NOT as orders.
- NEVER promise or imply that following your points will bring immediate profits,
  "guaranteed improvement", "next trade will win", or similar outcome claims.
- Prefer language like "worth watching", "something to notice next journal session",
  "a pattern to check in your process" — never "do this and you'll make money".

HARD GUARDRAILS
- You are NOT a financial advisor. No buy/sell/hold/enter/exit instructions for future trades.
- No price targets, no "you should go long/short X", no leverage/sizing orders framed as
  a way to make money.
- No confidential data speculation. Stay on this trade's facts only.
- Post-trade analytics and emotional support only — never future-centered trading advice.

FORMAT
- English. Freeform prose (no labeled sections like "Emotional support:" / "Recommendation:").
- About 70–110 words. Concise, vivid, readable in a table cell.
- Emojis: sometimes (not every analysis) add 0–1 restrained emoji from this allow-list only:
  📌 · 📊 · 💡 · 🙂 · 🔥 · 🚀
  Do not use any other emoji. Never spam multiple emojis.
- Prefer no emoji when it would feel forced.
- Do not invent prices, notes, or outcomes that are not in the trade data."""


class AIAnalysisError(Exception):
    """Raised when OpenAI is misconfigured, the call fails, or the response is unusable."""


def _decimal_str(value: object) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, Decimal):
        return format(value, "f")
    return str(value)


def _market_label(trade: object) -> str:
    account = str(getattr(trade, "account_type", "") or "").strip().lower()
    market = str(getattr(trade, "market_type", "") or "").strip().lower()
    if market == "usdm":
        return "Futures USDT-M"
    if market == "coinm":
        return "Futures COIN-M"
    if account in ("future", "futures") or account.startswith("futures"):
        return "Futures"
    return "Spot"


def analyze_trade_sync(trade: object) -> str:
    """
    Build a user message from trade ORM fields and return the model text (GPT-4o-mini).
    OPENAI_API_KEY is read from the environment.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key or not str(api_key).strip():
        raise AIAnalysisError("OPENAI_API_KEY is not set")

    client = OpenAI(api_key=str(api_key).strip())

    date_raw = getattr(trade, "date", None) or getattr(trade, "closed_at", None)
    date_s = date_raw.isoformat()[:10] if hasattr(date_raw, "isoformat") else str(date_raw or "n/a")

    user_content = (
        "Analyze this one closed trade. Ground every claim in these fields:\n"
        f"Date: {date_s}\n"
        f"Market: {_market_label(trade)}\n"
        f"Pair: {getattr(trade, 'pair', 'n/a')}\n"
        f"Side: {getattr(trade, 'side', 'n/a')}\n"
        f"Entry price: {_decimal_str(getattr(trade, 'entry_price', None))}\n"
        f"Exit price: {_decimal_str(getattr(trade, 'exit_price', None))}\n"
        f"Quantity: {_decimal_str(getattr(trade, 'quantity', None))}\n"
        f"P&L: {_decimal_str(getattr(trade, 'pnl', None))}\n"
        f"Commission: {_decimal_str(getattr(trade, 'commission', None))}\n"
        f"Funding: {_decimal_str(getattr(trade, 'funding', None))}\n"
        f"Leverage: {getattr(trade, 'leverage', None) if getattr(trade, 'leverage', None) is not None else 'n/a'}\n"
        f"Margin mode: {getattr(trade, 'margin_mode', None) or 'n/a'}\n"
        f"Trader notes: {getattr(trade, 'notes', None) or '(none)'}\n"
        "Write a fully personalised insight for this trade only."
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0.75,
            max_tokens=420,
            presence_penalty=0.4,
            frequency_penalty=0.35,
        )
    except Exception as exc:
        raise AIAnalysisError(str(exc)) from exc

    text = (response.choices[0].message.content or "").strip()
    if not text:
        raise AIAnalysisError("Empty model response")
    return text
