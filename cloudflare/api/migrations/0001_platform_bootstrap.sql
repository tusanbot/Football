-- Cloudflare migration foundation only.
-- This is NOT the Football Empire game schema.
CREATE TABLE IF NOT EXISTS fe_schema_migrations (
  version TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO fe_schema_migrations (version)
VALUES ('0001_platform_bootstrap');
