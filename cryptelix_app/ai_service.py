from __future__ import annotations

import os
from decimal import Decimal
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

_ENV_FILE = (Path(__file__).resolve().parent / ".env").resolve()
load_dotenv(_ENV_FILE, override=True)

SYSTEM_PROMPT = """You are a professional Cryptelix analyst and emotional support assistant. 
Provide a concise technical report on a specific trade in English while keeping in mind the user's emotional state and the trade's outcome.
Analyze entry and exit quality, consider P&L and the user's notes. If the trade was a winner, provide emotional support and encouragement. If the trade was a loser, provide emotional support and advice on how to improve.
Response structure:

Restrictions: DO NOT use structure in a prompt, as an output format. Write in a freeform manner. But be concise and to the point.

Emotional support: [Emotional support and encouragement or advice on how to improve], be very supportive, but also realistic and honest.

Execution analysis: [Assessment of entry/exit accuracy], be detailed and specific.

Risk management: [Assessment of stop size or profit target]

Recommendation: [Specific technical advice for the future].
Length: 60-80 words. Write professionally but clearly. Use emojis if appropriate."""


class AIAnalysisError(Exception):
    """Raised when OpenAI is misconfigured, the call fails, or the response is unusable."""


def _decimal_str(value: object) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, Decimal):
        return format(value, "f")
    return str(value)


def analyze_trade_sync(trade: object) -> str:
    """
    Build a user message from trade ORM fields and return the model text (GPT-4o-mini).
    OPENAI_API_KEY is read from the environment.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key or not str(api_key).strip():
        raise AIAnalysisError("OPENAI_API_KEY is not set")

    client = OpenAI(api_key=str(api_key).strip())

    user_content = (
        f"Trade pair: {getattr(trade, 'pair', 'n/a')}\n"
        f"Side: {getattr(trade, 'side', 'n/a')}\n"
        f"Entry price: {_decimal_str(getattr(trade, 'entry_price', None))}\n"
        f"Exit price: {_decimal_str(getattr(trade, 'exit_price', None))}\n"
        f"Quantity: {_decimal_str(getattr(trade, 'quantity', None))}\n"
        f"P&L: {_decimal_str(getattr(trade, 'pnl', None))}\n"
        f"Commission: {_decimal_str(getattr(trade, 'commission', None))}\n"
        f"User notes: {getattr(trade, 'notes', None) or '(none)'}\n"
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0.4,
            max_tokens=512,
        )
    except Exception as exc:
        raise AIAnalysisError(str(exc)) from exc

    text = (response.choices[0].message.content or "").strip()
    if not text:
        raise AIAnalysisError("Empty model response")
    return text
