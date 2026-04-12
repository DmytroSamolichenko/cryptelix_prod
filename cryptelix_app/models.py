import uuid

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB

from database import Base, engine


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)


class Trade(Base):
    __tablename__ = "trades"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # ID provided by the exchange for this trade, used for deduplication
    exchange_trade_id = Column(String(128), unique=True, index=True, nullable=True)
    # Short exchange identifier, e.g. "binance"
    exchange_name = Column(String(50), nullable=True)
    date = Column(DateTime, nullable=False)
    # Timestamp when the trade was fully closed/executed; used for period filtering
    closed_at = Column(DateTime, nullable=True, index=True)
    pair = Column(String(50), nullable=False)
    side = Column(String(10), nullable=False)  # e.g. "Long" or "Short"
    entry_price = Column(Numeric(18, 8), nullable=True)
    exit_price = Column(Numeric(18, 8), nullable=True)
    quantity = Column(Numeric(18, 8), nullable=False)
    pnl = Column(Numeric(18, 2), nullable=True)
    commission = Column(Numeric(18, 8), nullable=True)
    custom_fields = Column(JSONB, default=dict)
    is_manual = Column(Boolean, nullable=True)
    external_id = Column(String(128), nullable=True)
    notes = Column(Text, nullable=True)
    ai_report = Column(Text, nullable=True, default=None)


class APIKey(Base):
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    exchange_name = Column(String(50), nullable=False)
    api_key_encrypted = Column(String(512), nullable=False)
    api_secret_encrypted = Column(String(512), nullable=False)


class BalanceTransaction(Base):
    __tablename__ = "balance_transactions"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(String(20), nullable=False)  # 'DEPOSIT' or 'WITHDRAWAL'
    amount = Column(Numeric(18, 8), nullable=False)
    asset = Column(String(50), nullable=False)
    executed_at = Column(DateTime, nullable=False, index=True)


class AccountSnapshot(Base):
    __tablename__ = "account_snapshots"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    total_balance = Column(Numeric(18, 8), nullable=False)
    captured_at = Column(DateTime, nullable=False)


class ChatSession(Base):
    """Maps to public.chat_sessions (created manually in PostgreSQL)."""

    __tablename__ = "chat_sessions"
    __table_args__ = {"schema": "public"}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class ChatMessage(Base):
    """Maps to public.chat_messages (created manually in PostgreSQL)."""

    __tablename__ = "chat_messages"
    __table_args__ = {"schema": "public"}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("public.chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role = Column(String(32), nullable=False)
    # DB column must be named "content" (TEXT). If your table uses "message", rename the column or map: Column("message", Text, ...)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)


if __name__ == "__main__":
    # Create all tables in the configured database.
    Base.metadata.create_all(bind=engine)