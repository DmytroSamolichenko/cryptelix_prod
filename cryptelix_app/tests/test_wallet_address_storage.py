"""Wallet addresses are stored as Fernet ciphertext and matched by HMAC."""

from __future__ import annotations

from models import User, WalletIdentity
from security import decrypt_data
from wallet_auth import _find_wallet, _seal_wallet_row, _sealed_wallet

ADDRESS = "0x" + "ab" * 20


def _user(db) -> User:
    user = User(
        email="wallet-seal@isolation.test",
        username="wallet_eip155_abababab",
        password_hash=None,
        token_version=0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_new_wallet_row_does_not_store_the_address(db_session):
    user = _user(db_session)
    row = _sealed_wallet(user.id, "eip155", ADDRESS)
    db_session.add(row)
    db_session.commit()

    assert ADDRESS not in row.address
    assert decrypt_data(row.address) == ADDRESS
    found = _find_wallet(db_session, "eip155", ADDRESS)
    assert found is not None
    assert found.user_id == user.id


def test_legacy_plaintext_row_is_resealed_on_login(db_session):
    user = User(
        email="wallet-legacy@isolation.test",
        username="wallet_eip155_abababab",
        password_hash=None,
        token_version=0,
    )
    db_session.add(user)
    db_session.flush()
    legacy = WalletIdentity(
        user_id=user.id,
        chain="eip155",
        address=ADDRESS,
        address_hash=None,
    )
    db_session.add(legacy)
    db_session.commit()

    found = _find_wallet(db_session, "eip155", ADDRESS)
    assert found is not None
    _seal_wallet_row(found, "eip155", ADDRESS)
    db_session.commit()
    db_session.refresh(found)

    assert found.address != ADDRESS
    assert decrypt_data(found.address) == ADDRESS
    again = _find_wallet(db_session, "eip155", ADDRESS)
    assert again is not None
    assert again.id == found.id
