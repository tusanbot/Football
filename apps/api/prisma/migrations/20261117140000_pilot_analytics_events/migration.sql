CREATE TABLE "PilotAnalyticsEvent" (
  "id" BIGSERIAL NOT NULL,
  "eventName" VARCHAR(40) NOT NULL,
  "userKey" VARCHAR(32) NOT NULL,
  "actionKey" VARCHAR(64) NOT NULL DEFAULT '',
  "chatType" VARCHAR(16) NOT NULL DEFAULT 'unknown',
  "source" VARCHAR(16) NOT NULL,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PilotAnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PilotAnalyticsEvent_eventName_occurredAt_idx"
  ON "PilotAnalyticsEvent" ("eventName", "occurredAt");
CREATE INDEX "PilotAnalyticsEvent_userKey_occurredAt_idx"
  ON "PilotAnalyticsEvent" ("userKey", "occurredAt");
CREATE INDEX "PilotAnalyticsEvent_source_occurredAt_idx"
  ON "PilotAnalyticsEvent" ("source", "occurredAt");

ALTER TABLE "PilotAnalyticsEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PilotAnalyticsEvent" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE "PilotAnalyticsEvent_id_seq" FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'football_runtime') THEN
    GRANT SELECT, INSERT ON TABLE "PilotAnalyticsEvent" TO football_runtime;
    GRANT USAGE, SELECT ON SEQUENCE "PilotAnalyticsEvent_id_seq" TO football_runtime;
  END IF;
END
$$;
