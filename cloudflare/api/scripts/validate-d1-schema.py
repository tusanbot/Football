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
expected = report["totals"]["models"] + 2  # includes the two D1 infrastructure tables
if tables != expected:
    raise SystemExit(f"Expected {expected} tables, generated {tables}")

migration_version = connection.execute("SELECT version FROM fe_schema_migrations WHERE version = '0002_game_schema'").fetchone()
if migration_version is None:
    raise SystemExit("Generated game schema migration did not register its version")

foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
if foreign_key_errors:
    raise SystemExit(f"Foreign-key definition check failed: {foreign_key_errors[:10]}")

integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
if integrity != "ok":
    raise SystemExit(f"SQLite integrity_check failed: {integrity}")

# Exercise atomic wallet/ledger writes with the same changes()-guarded batch used by the Worker.
connection.execute(
    'INSERT INTO "User" ("id", "telegramId", "updatedAt") VALUES (?, ?, ?)',
    ("wallet-test-user", "wallet-test-telegram", "2026-11-15T00:00:00.000Z"),
)
connection.execute(
    'INSERT INTO "Wallet" ("id", "userId", "asset", "balance", "version", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ("wallet-test-id", "wallet-test-user", "CASH", 100, 0, "2026-11-15T00:00:00.000Z", "2026-11-15T00:00:00.000Z"),
)
connection.commit()

def atomic_wallet_delta(ledger_id, key, direction, amount):
    connection.execute("BEGIN")
    try:
        connection.execute(
            'INSERT INTO "LedgerTransaction" ("id", "idempotencyKey", "userId", "asset", "direction", "amount", "reason") '
            'VALUES (?, ?, ?, ?, ?, CAST(? AS INTEGER), ?) ON CONFLICT("idempotencyKey") DO NOTHING',
            (ledger_id, key, "wallet-test-user", "CASH", direction, str(amount), "CI atomicity test"),
        )
        connection.execute(
            'UPDATE "Wallet" SET "balance" = "balance" + CASE WHEN ? = "CREDIT" THEN CAST(? AS INTEGER) ELSE -CAST(? AS INTEGER) END, '
            '"version" = "version" + 1, "updatedAt" = ? '
            'WHERE "userId" = ? AND "asset" = ? AND changes() = 1 AND CAST(? AS INTEGER) > 0 AND "version" < 2147483647 '
            'AND ((? = "CREDIT" AND "balance" <= 9223372036854775807 - CAST(? AS INTEGER)) '
            'OR (? = "DEBIT" AND "balance" >= CAST(? AS INTEGER)))',
            (direction, str(amount), str(amount), "2026-11-15T00:01:00.000Z", "wallet-test-user", "CASH",
             str(amount), direction, str(amount), direction, str(amount)),
        )
        connection.execute("INSERT INTO fe_write_guard (assertion) VALUES (changes())")
        connection.execute("DELETE FROM fe_write_guard")
        connection.commit()
    except Exception:
        connection.rollback()
        raise

def wallet_state():
    return connection.execute(
        'SELECT "balance", "version" FROM "Wallet" WHERE "id" = "wallet-test-id"'
    ).fetchone()

atomic_wallet_delta("ledger-credit-1", "credit-1", "CREDIT", 50)
assert wallet_state() == (150, 1)

try:
    atomic_wallet_delta("ledger-credit-replay", "credit-1", "CREDIT", 50)
except sqlite3.IntegrityError:
    pass
else:
    raise SystemExit("Duplicate idempotency key unexpectedly applied twice")
assert wallet_state() == (150, 1)

try:
    atomic_wallet_delta("ledger-debit-fail", "debit-fail", "DEBIT", 200)
except sqlite3.IntegrityError:
    pass
else:
    raise SystemExit("Insufficient-funds debit unexpectedly succeeded")
assert wallet_state() == (150, 1)
assert connection.execute('SELECT count(*) FROM "LedgerTransaction"').fetchone()[0] == 1

atomic_wallet_delta("ledger-debit-2", "debit-2", "DEBIT", 20)
assert wallet_state() == (130, 2)

connection.execute('UPDATE "Wallet" SET "balance" = ? WHERE "id" = ?', (9223372036854775806, "wallet-test-id"))
connection.commit()
try:
    atomic_wallet_delta("ledger-overflow", "overflow", "CREDIT", 2)
except sqlite3.IntegrityError:
    pass
else:
    raise SystemExit("Overflowing wallet credit unexpectedly succeeded")
assert wallet_state() == (9223372036854775806, 2)
assert connection.execute('SELECT count(*) FROM "LedgerTransaction"').fetchone()[0] == 2
assert connection.execute("SELECT count(*) FROM fe_write_guard").fetchone()[0] == 0

print(f"Validated {tables} D1 tables; foreign keys, SQLite integrity, wallet atomicity, idempotency and balance guards are clean.")
