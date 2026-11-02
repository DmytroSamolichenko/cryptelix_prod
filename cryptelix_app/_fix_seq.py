from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import text

load_dotenv((Path(__file__).resolve().parent / ".env").resolve(), override=True)
from database import engine

sql = """
SELECT setval(
  pg_get_serial_sequence('public.users', 'id'),
  (SELECT COALESCE(MAX(id), 1) FROM public.users)
)
"""
with engine.begin() as c:
    val = c.execute(text(sql)).scalar()
    mx = c.execute(text("SELECT MAX(id) FROM public.users")).scalar()
    print("seq", val, "max_id", mx)
