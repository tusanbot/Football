import { Client } from "pg";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const directUrl = process.env.DIRECT_URL;
if (!directUrl) {
  throw new Error("DIRECT_URL is required. The connection string is never logged.");
}

const migrationsRoot = resolve(process.cwd(), "prisma/migrations");
const migrationEntries = await readdir(migrationsRoot, { withFileTypes: true });
const migrationNames = [];
for (const entry of migrationEntries) {
  if (!entry.isDirectory()) continue;
  try {
    await readFile(resolve(migrationsRoot, entry.name, "migration.sql"), "utf8");
    migrationNames.push(entry.name);
  } catch {
    // Ignore non-migration directories.
  }
}
migrationNames.sort((a, b) => a.localeCompare(b));

const client = new Client({
  connectionString: directUrl,
  connectionTimeoutMillis: 10_000,
  query_timeout: 20_000,
  statement_timeout: 20_000,
  application_name: "football-empire-read-only-db-audit",
});

let report;
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");

  const identity = await client.query(`
    SELECT current_database() AS database_name,
           current_schema() AS current_schema,
           current_setting('server_version') AS server_version
  `);

  const historyExists = await client.query(
    "SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS history_table_present"
  );
  let history = null;
  if (historyExists.rows[0].history_table_present) {
    const result = await client.query(`
      SELECT migration_name, started_at, finished_at, rolled_back_at,
             applied_steps_count
      FROM public."_prisma_migrations"
      ORDER BY started_at NULLS FIRST, migration_name
    `);
    history = result.rows.map((row) => ({
      migration_name: row.migration_name,
      started_at: row.started_at,
      finished_at: row.finished_at,
      rolled_back_at: row.rolled_back_at,
      applied_steps_count: row.applied_steps_count,
    }));
  }

  const tablesResult = await client.query(`
    SELECT c.relname AS table_name,
           GREATEST(c.reltuples::bigint, 0) AS estimated_rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `);

  const enumsResult = await client.query(`
    SELECT t.typname AS enum_name,
           array_agg(e.enumlabel ORDER BY e.enumsortorder) AS enum_values
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname
    ORDER BY t.typname
  `);

  const columnsResult = await client.query(`
    SELECT table_name, count(*)::int AS column_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
    GROUP BY table_name
    ORDER BY table_name
  `);

  const historyTablePresent = historyExists.rows[0].history_table_present;
  const latestByName = new Map();
  for (const row of history ?? []) latestByName.set(row.migration_name, row);
  const applied = historyTablePresent ? [] : null;
  const failed = historyTablePresent ? [] : null;
  const pending = historyTablePresent ? [] : null;
  if (historyTablePresent) {
    for (const name of migrationNames) {
      const row = latestByName.get(name);
      if (!row) {
        pending.push(name);
        continue;
      }
      if (row.finished_at && !row.rolled_back_at) applied.push(name);
      else failed.push(name);
    }
  }

  const tableNames = new Set(tablesResult.rows.map((row) => row.table_name));
  const expectedTables = [
    "User",
    "Club",
    "Player",
    "Competition",
    "PyramidLeague",
    "LeaguePromotionOffer",
    "StoreInventoryItem",
    "StorePurchase",
    "StoreItemUse",
  ];

  report = {
    generated_at: new Date().toISOString(),
    audit_mode: "READ_ONLY",
    database: identity.rows[0],
    migration_history_table_exists: historyTablePresent,
    migration_file_count: migrationNames.length,
    migration_files: migrationNames,
    applied_migrations: applied,
    pending_migrations: pending,
    failed_or_rolled_back_migrations: failed,
    history_rows: history,
    public_table_count: tablesResult.rowCount,
    public_tables: tablesResult.rows,
    public_enum_count: enumsResult.rowCount,
    public_enums: enumsResult.rows,
    public_table_column_counts: columnsResult.rows,
    expected_table_presence: Object.fromEntries(
      expectedTables.map((name) => [name, tableNames.has(name)])
    ),
    safety: {
      transaction_mode: "BEGIN READ ONLY",
      schema_changes_executed: false,
      migrations_executed: false,
      application_data_read: false,
    },
  };

  await client.query("ROLLBACK");
} finally {
  await client.end().catch(() => {});
}

const root = resolve(process.cwd(), "../..");
await writeFile(resolve(root, "database-audit.json"), JSON.stringify(report, null, 2) + "\n");

const lines = [
  "### Database catalog",
  "",
  `- Database: \`${report.database.database_name}\``,
  `- PostgreSQL: ${report.database.server_version}`,
  `- Prisma migration history table: ${report.migration_history_table_exists ? "present" : "missing"}`,
  `- Migration files in this branch: ${report.migration_file_count}`,
  `- Applied migrations: ${report.migration_history_table_exists ? report.applied_migrations.length : "unknown (no Prisma history table)"}`,
  `- Pending migrations: ${report.migration_history_table_exists ? report.pending_migrations.length : "unknown (no Prisma history table)"}`,
  `- Failed/rolled-back migrations: ${report.migration_history_table_exists ? report.failed_or_rolled_back_migrations.length : "unknown (no Prisma history table)"}`,
  `- Public tables: ${report.public_table_count}`,
  `- Public enums: ${report.public_enum_count}`,
  "",
  "### Required table presence",
  "",
  "| Table | Present |",
  "|---|---|",
  ...Object.entries(report.expected_table_presence).map(([name, present]) => `| \`${name}\` | ${present ? "yes" : "no"} |`),
  "",
  "### Safety",
  "",
  "- Database transaction was explicitly read-only.",
  "- No migration, DDL, DML, seed, or application-data query was executed.",
  "- Table row counts are PostgreSQL planner estimates, not exact counts.",
];
if (!report.migration_history_table_exists) {
  lines.push("", "Migration state is **unknown** until the existing schema is reconciled. Missing Prisma history does not prove that the database is empty.");
}
await writeFile(resolve(root, "database-audit.md"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
