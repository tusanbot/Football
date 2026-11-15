# Prisma to D1 schema conversion

The source of truth remains \`apps/api/prisma/schema.prisma\` and PostgreSQL. The D1 migration is a separately generated compatibility target; it is not a replacement for the PostgreSQL migration history.

## Generate the current inventory and draft D1 migration

From the repository root:

\`\`\`bash
node cloudflare/api/scripts/prisma-d1-schema.mjs
\`\`\`

The command writes:

- \`cloudflare/api/schema/prisma-d1-inventory.json\`: every Prisma model, scalar column, enum, index, unique constraint, relation and mapping decision.
- \`cloudflare/api/migrations/0002_game_schema.sql\`: a generated SQLite/D1 DDL draft.

The generated migration must be reviewed against the existing PostgreSQL migrations and tested against a local D1 database before it is applied anywhere. Do not apply it to a remote database as part of this stage.

## Mapping policy

| Prisma type / feature | D1 representation | Required application behavior |
| --- | --- | --- |
| String | TEXT | Keep identifiers as strings; generate cuid/uuid in application code |
| Int | INTEGER | Validate integer range at domain boundaries |
| BigInt | INTEGER (SQLite signed 64-bit) | Bind decimal strings, never JS BigInt; select with \`CAST(column AS TEXT)\` and parse to JS BigInt |
| Float | REAL | Validate finite values |
| Boolean | INTEGER | CHECK constraint limits values to 0/1 |
| DateTime | TEXT | Persist canonical ISO-8601 UTC strings |
| DateTime with \`@db.Date\` | TEXT | Persist canonical YYYY-MM-DD values |
| Json | TEXT | Validate JSON and enforce \`json_valid\` |
| Prisma enum | TEXT | CHECK constraint against the declared enum values |
| Scalar arrays | TEXT JSON array | Encode/decode JSON explicitly |

## Financial integrity gates

D1 does not accept JavaScript BigInt values in binding parameters. The new \`d1-integer.ts\` adapter accepts decimal strings, validates the signed 64-bit SQLite range, and rejects unsafe Number conversions. Reads of financial columns must use SQL such as \`CAST(balance AS TEXT) AS balance\`; selecting an INTEGER amount directly can cross the JavaScript safe-integer boundary and lose precision.

Wallet, ledger, purchases, rewards, transfers, and club/alliance finance must not be moved to ordinary multi-query read/modify/write code. Their final repository must use a single D1 atomic statement/trigger or a D1 batch whose rollback and idempotency semantics are proven by concurrency tests. The generated DDL is only a schema draft and does not itself satisfy this gate.

## Deliberately not done

- No remote D1 database was created or changed.
- No D1 migration was applied.
- No PostgreSQL data was exported or imported.
- No API route or bot traffic was switched.
- No webhook, DNS, or production deployment was changed.
- The Worker readiness and game routes remain fail-closed.


## Wallet and ledger atomicity

The generated migration creates the private \`fe_write_guard\` table. The D1 wallet repository uses a four-statement \`DB.batch()\` sequence:

1. Insert the immutable ledger row with \`ON CONFLICT(idempotencyKey) DO NOTHING\`.
2. Update the wallet only when SQLite \`changes()\` confirms that statement 1 inserted exactly one row, and only when credit/debit and signed-64-bit overflow conditions are satisfied.
3. Insert the result of \`changes()\` into \`fe_write_guard\`, whose CHECK constraint accepts only \`1\`. This turns a missing wallet, duplicate idempotency key, insufficient funds, or overflow into a SQL error.
4. Delete the guard row.

D1 executes a batch sequentially as a transaction and rolls back the entire batch when a statement fails. The repository resolves a failed batch by checking for an existing idempotency key first, then classifying wallet-not-found, insufficient-funds, or overflow. It never performs an application-side read/modify/write balance update.

The Python CI validator executes this exact SQL sequence against SQLite, including duplicate replay, insufficient debit, successful debit/credit and overflow cases. This is a local SQL-semantics test; a live D1 concurrency/load test is still required before production cutover.
