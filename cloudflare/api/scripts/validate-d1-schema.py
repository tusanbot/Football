import json
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[3]
migration = root / "cloudflare/api/migrations/0002_game_schema.sql"
inventory = root / "cloudflare/api/schema/prisma-d1-inventory.json"

bootstrap = root / "cloudflare/api/migrations/0001_platform_bootstrap.sql"
schema_sql = migration.read_text(encoding="utf-8")
report = json.loads(inventory.read_text(encoding="utf-8"))
connection = sqlite3.connect(":memory:")
connection.execute("PRAGMA foreign_keys = ON")
connection.executescript(bootstrap.read_text(encoding="utf-8"))
connection.executescript(schema_sql)

tables = connection.execute(
    "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
).fetchone()[0]
expected = report["totals"]["models"]
if tables != expected:
    raise SystemExit(f"Expected {expected} tables, generated {tables}")

foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
if foreign_key_errors:
    raise SystemExit(f"Foreign-key definition check failed: {foreign_key_errors[:10]}")

integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
if integrity != "ok":
    raise SystemExit(f"SQLite integrity_check failed: {integrity}")

print(f"Validated {tables} D1 tables; foreign keys and SQLite integrity are clean.")
