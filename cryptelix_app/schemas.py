from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TradeBase(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="ignore")

    date: datetime
    pair: str
    side: str
    entry_price: float
    exit_price: float | None = None
    quantity: float
    pnl: float | None = None
    commission: float | None = None
    notes: str | None = None
    ai_report: str | None = None
    custom_fields: dict = {}
    exchange_trade_id: str
    exchange_name: str


class TradeCreate(TradeBase):
    model_config = ConfigDict(from_attributes=True)


class TradeUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="ignore")

    date: datetime | None = None
    pair: str | None = None
    side: str | None = None
    entry_price: float | None = None
    exit_price: float | None = None
    quantity: float | None = None
    pnl: float | None = None
    commission: float | None = None
    notes: str | None = None
    ai_report: str | None = None
    custom_fields: dict | None = None


class Trade(TradeBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_manual: bool | None = None


class APIKeyBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    exchange_name: str
    api_key_encrypted: str
    api_secret_encrypted: str


class APIKeyCreate(APIKeyBase):
    model_config = ConfigDict(from_attributes=True)


class APIKey(APIKeyBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class ChatSendRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    session_id: UUID | None = None
    message: str = Field(..., min_length=1, max_length=32000)

