"""Local smoke: EVM + Solana verify_and_get_user against the migrated DB."""
from pathlib import Path

from dotenv import load_dotenv

load_dotenv((Path(__file__).resolve().parent / ".env").resolve(), override=True)

import base58
from eth_account import Account
from eth_account.messages import encode_defunct
from nacl.signing import SigningKey

from database import SessionLocal
from wallet_auth import (
    CHAIN_EVM,
    CHAIN_SOLANA,
    build_login_message,
    issue_nonce,
    verify_and_get_user,
)


def _fill(template: str, address: str, chain: str) -> str:
    return template.replace("{address}", address).replace("{chain}", chain)


def main() -> None:
    db = SessionLocal()
    try:
        issued = issue_nonce()
        evm_acct = Account.create()
        evm_msg = _fill(issued["message"], evm_acct.address, CHAIN_EVM)
        evm_sig = Account.sign_message(encode_defunct(text=evm_msg), evm_acct.key).signature.hex()
        evm_user = verify_and_get_user(
            db,
            chain=CHAIN_EVM,
            address=evm_acct.address,
            message=evm_msg,
            signature=evm_sig,
        )
        print("evm_ok", evm_user.id, evm_user.email)

        issued2 = issue_nonce()
        sk = SigningKey.generate()
        sol_addr = base58.b58encode(bytes(sk.verify_key)).decode("ascii")
        sol_msg = _fill(issued2["message"], sol_addr, CHAIN_SOLANA)
        sig = sk.sign(sol_msg.encode("utf-8")).signature
        sol_user = verify_and_get_user(
            db,
            chain=CHAIN_SOLANA,
            address=sol_addr,
            message=sol_msg,
            signature=bytes(sig).hex(),
        )
        print("sol_ok", sol_user.id, sol_user.email)

        from auth import get_user_by_email, check_email_status

        # Invite lookup still works for existing emails if any exist.
        sample = db.execute(
            __import__("sqlalchemy").text(
                "SELECT email FROM public.users WHERE email IS NOT NULL LIMIT 1"
            )
        ).scalar()
        if sample:
            status = check_email_status(db, sample)
            print("invite_ok", status)
        else:
            print("invite_skip_no_email_users")
            _ = get_user_by_email
    finally:
        db.close()


if __name__ == "__main__":
    main()
