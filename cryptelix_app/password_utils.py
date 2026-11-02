import bcrypt
import re

# bcrypt silently truncates beyond 72 bytes — enforce explicitly.
MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 72

_UPPER = re.compile(r"[A-Z]")
_LOWER = re.compile(r"[a-z]")
_DIGIT = re.compile(r"[0-9]")
# Any non-alphanumeric character counts as a symbol (!@#$%^&* etc.).
_SYMBOL = re.compile(r"[^A-Za-z0-9]")


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def validate_password_strength(plain: str) -> None:
    """Raise ValueError with a client-safe message if the password is too weak."""
    if not isinstance(plain, str):
        raise ValueError("Password is required.")

    if len(plain) < MIN_PASSWORD_LENGTH:
        raise ValueError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
        )
    if len(plain.encode("utf-8")) > MAX_PASSWORD_LENGTH:
        raise ValueError(
            f"Password must be at most {MAX_PASSWORD_LENGTH} characters."
        )
    if not _UPPER.search(plain):
        raise ValueError("Password must include at least one uppercase letter.")
    if not _LOWER.search(plain):
        raise ValueError("Password must include at least one lowercase letter.")
    if not _DIGIT.search(plain):
        raise ValueError("Password must include at least one number.")
    if not _SYMBOL.search(plain):
        raise ValueError("Password must include at least one symbol.")
