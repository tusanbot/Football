-- Normalize every not-yet-started league/cup fixture to a whole Tehran-local hour.
-- Existing friendly fixtures and in-progress/completed matches are intentionally untouched.
WITH local_times AS (
  SELECT
    "id",
    "scheduledAt" AT TIME ZONE 'Asia/Tehran' AS local_scheduled_at
  FROM "FootballMatch"
  WHERE "status" = 'SCHEDULED'
    AND "type" IN ('LEAGUE', 'CUP')
    AND "competitionId" IS NOT NULL
),
rounded AS (
  SELECT
    "id",
    (
      date_trunc('hour', local_scheduled_at)
      + CASE
          WHEN local_scheduled_at > date_trunc('hour', local_scheduled_at)
            THEN interval '1 hour'
          ELSE interval '0'
        END
    ) AT TIME ZONE 'Asia/Tehran' AS scheduled_at
  FROM local_times
)
UPDATE "FootballMatch" AS fixture
SET "scheduledAt" = rounded.scheduled_at
FROM rounded
WHERE fixture."id" = rounded."id"
  AND fixture."scheduledAt" IS DISTINCT FROM rounded.scheduled_at;

-- Keep active competition start metadata aligned with its first scheduled fixture.
UPDATE "Competition" AS competition
SET "startsAt" = first_fixture.first_kickoff
FROM (
  SELECT "competitionId", MIN("scheduledAt") AS first_kickoff
  FROM "FootballMatch"
  WHERE "status" = 'SCHEDULED'
    AND "type" IN ('LEAGUE', 'CUP')
    AND "competitionId" IS NOT NULL
  GROUP BY "competitionId"
) AS first_fixture
WHERE competition."id" = first_fixture."competitionId"
  AND competition."status" = 'ACTIVE'
  AND competition."startsAt" IS DISTINCT FROM first_fixture.first_kickoff;
