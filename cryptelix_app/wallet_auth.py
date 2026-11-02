"""Wallet login (EVM SIWE-style + Solana ed25519) for the beta.

Nonce is stored in Redis when REDIS_URL is set, otherwise in-process memory
(local dev). Nonces are single-use with a short TTL. The signed message is
bound to APP_DOMAIN so signatures are not portable across sites.
"""

from __future__ import annotations

import os
import re
import secrets
import time
from datetime import datetime, timezone
from typing import Any

from eth_account.messages import encode_defunct
from eth_account import Account
from fastapi import HTTPException, status
from nacl.encoding import RawEncoder
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey
from sqlalchemy.orm import Session

from models import User, WalletIdentity

CHAIN_EVM = "eip155"
CHAIN_SOLANA = "solana"
ALLOWED_CHAINS = {CHAIN_EVM, CHAIN_SOLANA}

NONCE_TTL_SEC = int(os.getenv("WALLET_NONCE_TTL_SEC", "300"))
APP_DOMAIN = (os.getenv("APP_DOMAIN") or "cryptelix.app").strip().rstrip("/")
APP_URI = (os.getenv("APP_URI") or f"https://{APP_DOMAIN}").strip().rstrip("/")
STATEMENT = "Sign in to Cryptelix"

_NONCE_PREFIX = "wallet_nonce:"
_memory_nonces: dict[str, float] = {}
_redis_client: Any = None
_redis_failed = False


def _redis() -> Any:
    """Lazy Redis client; None if unset or unavailable (fail-open to memory)."""
    global _redis_client, _redis_failed
    if _redis_failed:
        return None
    if _redis_client is not None:
        return _redis_client
    url = (os.getenv("REDIS_URL") or "").strip()
    if not url:
        return None
    try:
        import redis as redis_lib

        _redis_client = redis_lib.from_url(url, decode_responses=True)
        _redis_client.ping()
        return _redis_client
    except Exception:
        _redis_failed = True
        return None


def _store_nonce(nonce: str) -> None:
    expires = time.time() + NONCE_TTL_SEC
    client = _redis()
    if client is not None:
        try:
            client.setex(_NONCE_PREFIX + nonce, NONCE_TTL_SEC, "1")
            return
        except Exception:
            pass
    _memory_nonces[nonce] = expires
    # Drop expired local entries opportunistically.
    now = time.time()
    stale = [k for k, exp in _memory_nonces.items() if exp <= now]
    for k in stale:
        _memory_nonces.pop(k, None)


def _consume_nonce(nonce: str) -> bool:
    """Return True and delete if present and unexpired (single-use)."""
    client = _redis()
    if client is not None:
        try:
            deleted = client.delete(_NONCE_PREFIX + nonce)
            if deleted:
                return True
        except Exception:
            pass
    exp = _memory_nonces.pop(nonce, None)
    if exp is None:
        return False
    return exp > time.time()


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat()


def build_login_message(*, address: str, chain: str, nonce: str, issued_at: str) -> str:
    """Domain-bound message both EVM and Solana wallets sign as UTF-8 bytes."""
    return (
        f"{APP_DOMAIN} wants you to sign in with your account:\n"
        f"{address}\n\n"
        f"{STATEMENT}\n\n"
        f"URI: {APP_URI}\n"
        f"Version: 1\n"
        f"Chain: {chain}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {issued_at}"
    )


def issue_nonce() -> dict[str, str]:
    nonce = secrets.token_urlsafe(16)
    issued_at = _now_iso()
    _store_nonce(nonce)
    # Address/chain filled by the client before signing; nonce+issued_at are bound.
    message = build_login_message(
        address="{address}",
        chain="{chain}",
        nonce=nonce,
        issued_at=issued_at,
    )
    return {
        "nonce": nonce,
        "message": message,
        "domain": APP_DOMAIN,
        "issued_at": issued_at,
    }


def _parse_message_fields(message: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    nonce_m = re.search(r"^Nonce: (.+)$", message, re.MULTILINE)
    chain_m = re.search(r"^Chain: (.+)$", message, re.MULTILINE)
    issued_m = re.search(r"^Issued At: (.+)$", message, re.MULTILINE)
    uri_m = re.search(r"^URI: (.+)$", message, re.MULTILINE)
    if nonce_m:
        fields["nonce"] = nonce_m.group(1).strip()
    if chain_m:
        fields["chain"] = chain_m.group(1).strip()
    if issued_m:
        fields["issued_at"] = issued_m.group(1).strip()
    if uri_m:
        fields["uri"] = uri_m.group(1).strip()
    return fields


def _normalize_evm_address(address: str) -> str:
    cleaned = address.strip()
    if not cleaned.startswith("0x") or len(cleaned) != 42:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid EVM address"
        )
    return cleaned.lower()


def _normalize_solana_address(address: str) -> str:
    cleaned = address.strip()
    if len(cleaned) < 32 or len(cleaned) > 44:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Solana address"
        )
    return cleaned


def _verify_evm(message: str, signature: str, claimed: str) -> str:
    recovered = Account.recover_message(
        encode_defunct(text=message), signature=signature
    )
    recovered_n = recovered.lower()
    claimed_n = _normalize_evm_address(claimed)
    if recovered_n != claimed_n:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Signature mismatch"
        )
    return recovered_n


def _b58decode(data: str) -> bytes:
    import base58

    return base58.b58decode(data)


def _verify_solana(message: str, signature: str, claimed: str) -> str:
    address = _normalize_solana_address(claimed)
    try:
        pubkey = _b58decode(address)
        if len(pubkey) != 32:
            raise ValueError("bad pubkey length")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Solana address"
        ) from exc

    sig = signature.strip()
    try:
        if sig.startswith("0x"):
            sig_bytes = bytes.fromhex(sig[2:])
        else:
            try:
                sig_bytes = bytes.fromhex(sig)
            except ValueError:
                sig_bytes = _b58decode(sig)
        if len(sig_bytes) != 64:
            raise ValueError("bad signature length")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Solana signature"
        ) from exc

    try:
        VerifyKey(pubkey, encoder=RawEncoder).verify(
            message.encode("utf-8"), sig_bytes, encoder=RawEncoder
        )
    except BadSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Signature mismatch"
        ) from exc
    return address


def verify_and_get_user(
    db: Session,
    *,
    chain: str,
    address: str,
    message: str,
    signature: str,
) -> User:
    chain_n = (chain or "").strip().lower()
    if chain_n not in ALLOWED_CHAINS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported chain"
        )
    if APP_DOMAIN not in message:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid sign-in message"
        )

    fields = _parse_message_fields(message)
    nonce = fields.get("nonce")
    if not nonce or not _consume_nonce(nonce):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired nonce",
        )
    msg_chain = (fields.get("chain") or "").strip().lower()
    if msg_chain and msg_chain != chain_n:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Chain mismatch"
        )

    expected = build_login_message(
        address=address.strip(),
        chain=chain_n,
        nonce=nonce,
        issued_at=fields.get("issued_at") or "",
    )
    # Allow the client to fill the template placeholders from GET /nonce.
    expected_from_template = message.replace("{address}", address.strip()).replace(
        "{chain}", chain_n
    )
    if message.strip() != expected.strip() and message.strip() != expected_from_template.strip():
        # Still accept if only the first address line matches claimed address.
        if address.strip() not in message or STATEMENT not in message:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid sign-in message",
            )

    if chain_n == CHAIN_EVM:
        stored_address = _verify_evm(message, signature, address)
    else:
        stored_address = _verify_solana(message, signature, address)

    row = (
        db.query(WalletIdentity)
        .filter(
            WalletIdentity.chain == chain_n,
            WalletIdentity.address == stored_address,
        )
        .one_or_none()
    )
    if row is not None:
        user = db.get(User, row.user_id)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session"
            )
        return user

    # Local/prod `users.username` may still be NOT NULL; keep a stable placeholder.
    placeholder = f"wallet_{chain_n}_{stored_address[:8]}".replace("0x", "")[:50]
    user = User(
        email=None,
        username=placeholder,
        password_hash=None,
        token_version=0,
    )
    db.add(user)
    db.flush()
    db.add(
        WalletIdentity(
            user_id=user.id,
            chain=chain_n,
            address=stored_address,
        )
    )
    db.commit()
    db.refresh(user)
    return user
