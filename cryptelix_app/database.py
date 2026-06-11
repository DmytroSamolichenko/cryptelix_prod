import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from sqlalchemy import create_engine


# Load .env next to this package; override=True so a stale Windows OPENAI_API_KEY
# cannot mask the file (python-dotenv default is override=False).
load_dotenv((Path(__file__).resolve().parent / ".env").resolve(), override=True)


def _get_database_url() -> str:
    """
    Resolve the DATABASE_URL from the environment and validate it.
    """
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Please define it in your .env file."
        )
    return db_url


DATABASE_URL: str = _get_database_url()

# Create the SQLAlchemy engine using psycopg2 (via the URL driver)
engine: Engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,  # helps avoid stale connections
)

# Session factory: autocommit=False and autoflush=False as requested
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=Session,
)

# Declarative base for ORM models
Base = declarative_base()


def get_db():
    """
    Dependency that yields a database session.
    Suitable for use with FastAPI's Depends in both sync and async endpoints.
    """
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _check_connection() -> bool:
    """
    Perform a basic connection check against the database.

    Returns True on success, False on failure.
    """
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError as exc:
        # You could plug in logging here instead of print if desired.
        print(f"Database connection check failed: {exc}")
        return False


if __name__ == "__main__":
    # Basic connection verification when this module is executed directly.
    if _check_connection():
        print("Database connection successful.")
    else:
        print("Database connection failed.")