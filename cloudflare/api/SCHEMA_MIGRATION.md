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


## Wallet and ledger atomicity

The generated migration creates the private \`fe_write_guard\` table. The D1 wallet repository uses a four-statement \`DB.batch()\` sequence:

1. Insert the immutable ledger row with \`ON CONFLICT(idempotencyKey) DO NOTHING\`.
2. Update the wallet only when SQLite \`changes()\` confirms that statement 1 inserted exactly one row, and only when credit/debit and signed-64-bit overflow conditions are satisfied.
3. Insert the result of \`changes()\` into \`fe_write_guard\`, whose CHECK constraint accepts only \`1\`. This turns a missing wallet, duplicate idempotency key, insufficient funds, or overflow into a SQL error.
4. Delete the guard row.

D1 executes a batch sequentially as a transaction and rolls back the entire batch when a statement fails. The repository resolves a failed batch by checking for an existing idempotency key first, then classifying wallet-not-found, insufficient-funds, or overflow. It never performs an application-side read/modify/write balance update.

The Python CI validator executes this exact SQL sequence against SQLite, including duplicate replay, insufficient debit, successful debit/credit and overflow cases. This is a local SQL-semantics test; a live D1 concurrency/load test is still required before production cutover.


## Additional atomic economy repositories

\`src/repositories/market-economy.ts\` adds two D1-native workflows:

- **Player market transfer:** buyer debit and seller credit ledger entries, both wallet mutations, listing state transition, player club ownership change (with lineup slot cleared to avoid the destination club's unique lineup constraint), and buyer/seller club finance entries are submitted in one \`DB.batch()\`. Each required mutation is guarded by \`changes()\` and the CHECK-constrained \`fe_write_guard\`; any failed precondition aborts the whole batch.
- **Group reward purchase:** an active reward grant is inserted only when the member balance covers its cost; the balance deduction and negative \`GroupPointLedger\` entry follow in the same batch. The same guard mechanism prevents partial grant/deduction/ledger state.

Both operations use caller-supplied stable IDs and idempotency keys. Replays are verified against persisted records rather than blindly treated as success. Wallet amounts are decimal strings within signed 64-bit range; unsafe JavaScript Number inputs are rejected.

The Worker still does not expose these repositories through public routes. The current tests validate repository statement composition and input invariants; SQLite end-to-end SQL tests and live D1 contention/load tests remain required before enabling traffic.


## Gift-code redemption atomicity

`src/repositories/gift-code-redemption.ts` implements the D1-side gift-code redemption transaction. It keeps Telegram's live actor verification outside the financial batch (the calling API layer must perform that check first), then rechecks the persisted group activation/suspension and membership rows inside the redemption INSERT. The same INSERT also checks code activation/window, global redemption capacity and per-user capacity before reserving a redemption.

The batch then increments the redemption counter, writes CASH/GOLD credit ledger entries and wallet upserts, and, for group-point codes, increments the group balance and writes the `GIFT_CODE` point-ledger row. Every dependent write is gated by SQLite `changes()` and the CHECK-constrained `fe_write_guard`, so a missing/invalid prerequisite or overflow aborts the whole D1 batch. Amounts are read as decimal strings and bound as decimal strings to preserve signed-64-bit precision.

Idempotent replay verifies the requesting user, canonical code, group and persisted reward amounts; reuse of a key for a different redemption is rejected. The repository is not wired to public Worker routes: the Worker remains fail-closed until API route parity, authentication, rate limiting and integration gates are complete. Current repository tests use a fake D1 statement adapter to verify statement composition and replay/input behavior; executing the repository SQL against SQLite and live D1 concurrency/load testing remain outstanding.
