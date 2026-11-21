# Pilot analytics queries

Run these read-only queries in the Supabase SQL Editor for the isolated Football Empire Staging project. All timestamps are grouped in UTC. The table contains HMAC-pseudonymized user keys, not Telegram IDs.

## Daily bot starts

```sql
SELECT
  date_trunc('day', "occurredAt")::date AS day_utc,
  count(*) AS start_events,
  count(DISTINCT "userKey") AS unique_starters
FROM public."PilotAnalyticsEvent"
WHERE "eventName" = 'bot_start'
GROUP BY 1
ORDER BY 1 DESC;
```

## Daily active users

Counts a person once per UTC day, across bot commands, callbacks, and Mini App launches. Generic `bot_update` events are excluded so ordinary chat traffic does not inflate the engagement metric.

```sql
SELECT
  date_trunc('day', "occurredAt")::date AS day_utc,
  count(DISTINCT "userKey") AS dau
FROM public."PilotAnalyticsEvent"
WHERE "eventName" IN ('bot_start', 'bot_command', 'bot_callback', 'miniapp_session')
GROUP BY 1
ORDER BY 1 DESC;
```

## Command and callback usage

```sql
SELECT
  "eventName",
  "actionKey",
  count(*) AS event_count,
  count(DISTINCT "userKey") AS unique_users
FROM public."PilotAnalyticsEvent"
WHERE "eventName" IN ('bot_command', 'bot_callback')
GROUP BY 1, 2
ORDER BY event_count DESC;
```

## Mini App launches

```sql
SELECT
  date_trunc('day', "occurredAt")::date AS day_utc,
  count(*) AS sessions,
  count(DISTINCT "userKey") AS unique_users
FROM public."PilotAnalyticsEvent"
WHERE "eventName" = 'miniapp_session'
GROUP BY 1
ORDER BY 1 DESC;
```

## Private vs group activity

```sql
SELECT
  "chatType",
  count(*) AS events,
  count(DISTINCT "userKey") AS unique_users
FROM public."PilotAnalyticsEvent"
WHERE "source" = 'bot'
GROUP BY 1
ORDER BY events DESC;
```

## First-week retention by cohort

Day 1 and day 7 mean the next calendar day and the seventh calendar day after the first recorded engagement day. Cohorts with incomplete observation windows naturally have lower apparent retention.

```sql
WITH activity AS (
  SELECT DISTINCT "userKey", "occurredAt"::date AS active_day
  FROM public."PilotAnalyticsEvent"
  WHERE "eventName" IN ('bot_start', 'bot_command', 'bot_callback', 'miniapp_session')
),
cohorts AS (
  SELECT "userKey", min(active_day) AS cohort_day
  FROM activity
  GROUP BY "userKey"
)
SELECT
  c.cohort_day,
  count(*) AS cohort_users,
  count(*) FILTER (WHERE a1."userKey" IS NOT NULL) AS day_1_returned,
  count(*) FILTER (WHERE a7."userKey" IS NOT NULL) AS day_7_returned,
  round(100.0 * count(*) FILTER (WHERE a1."userKey" IS NOT NULL) / nullif(count(*), 0), 1) AS day_1_retention_pct,
  round(100.0 * count(*) FILTER (WHERE a7."userKey" IS NOT NULL) / nullif(count(*), 0), 1) AS day_7_retention_pct
FROM cohorts c
LEFT JOIN activity a1
  ON a1."userKey" = c."userKey" AND a1.active_day = c.cohort_day + 1
LEFT JOIN activity a7
  ON a7."userKey" = c."userKey" AND a7.active_day = c.cohort_day + 7
GROUP BY c.cohort_day
ORDER BY c.cohort_day DESC;
```

## Important interpretation notes

- The event table starts empty. Counts begin only after the separate staging Bot is activated and users actually interact with it or open the Mini App.
- `bot_start` measures Telegram `/start` commands, not unique Bot installs. A user can send `/start` more than once; use `unique_starters` for distinct users.
- Current capture covers starts, commands, callbacks, generic updates, and Mini App launch sessions. Challenge creation/join, tournament participation, match decisions, and revenue/conversion events are not yet instrumented.
- Cloudflare request counts, CPU time, errors, and platform usage are measured separately in Worker Observability; they are not inferred from this event table.
- Do not expose this table to browser roles or add raw Telegram identifiers, message bodies, or raw callback payloads.
