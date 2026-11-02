"""SQLite app client for tenant-isolation tests.

Does not touch DATABASE_URL. Startup tasks (portfolio loop) are disabled so
TestClient cannot open the real database.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@compiles(PG_UUID, "sqlite")
def _compile_pg_uuid_sqlite(type_, compiler, **kw):  # noqa: ANN001
    return "CHAR(36)"


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):  # noqa: ANN001
    return "TEXT"


@pytest.fixture(scope="session")
def app_modules():
    import main as main_mod
    from database import Base, get_db
    from models import (
        APIKey,
        BinanceWs,
        ChatMessage,
        ChatSession,
        ConstructorBoard,
        Trade,
        User,
    )

    for table in Base.metadata.tables.values():
        table.schema = None

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    tables = [
        User.__table__,
        Trade.__table__,
        APIKey.__table__,
        BinanceWs.__table__,
        ChatSession.__table__,
        ChatMessage.__table__,
        ConstructorBoard.__table__,
    ]
    Base.metadata.create_all(engine, tables=tables)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    main_mod.app.router.on_startup.clear()
    main_mod.app.dependency_overrides[get_db] = override_get_db

    yield {
        "main": main_mod,
        "Session": Session,
        "get_db": get_db,
    }

    main_mod.app.dependency_overrides.clear()


@pytest.fixture()
def db_session(app_modules):
    session = app_modules["Session"]()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(app_modules):
    from fastapi.testclient import TestClient

    with TestClient(app_modules["main"].app) as test_client:
        yield test_client
