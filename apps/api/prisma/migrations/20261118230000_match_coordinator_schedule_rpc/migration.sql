CREATE OR REPLACE FUNCTION public.get_match_coordinator_schedule()
RETURNS TABLE(
  next_alarm timestamp with time zone,
  has_due_runtime boolean,
  has_due_fixture boolean,
  has_due_notifications boolean,
  has_pending_tournament_finalization boolean,
  has_pending_promotion_work boolean
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  WITH clock AS (SELECT NOW() AS now),
  candidates AS (
    SELECT GREATEST(COALESCE(runtime."nextActionAt", clock.now + INTERVAL '10 seconds'),
        COALESCE(runtime."leaseExpiresAt", '-infinity'::timestamptz)) AS candidate_at,
      (runtime."nextActionAt" <= clock.now AND (runtime."leaseExpiresAt" IS NULL OR runtime."leaseExpiresAt" <= clock.now)) AS due_runtime,
      FALSE AS due_fixture, FALSE AS due_notifications, FALSE AS pending_tournament, FALSE AS pending_promotion
    FROM public."MatchRuntime" runtime CROSS JOIN clock
    WHERE runtime."status"::text IN ('QUEUED', 'RUNNING', 'AWAITING_CHECKPOINT')
    UNION ALL
    SELECT fixture."scheduledAt", FALSE, FALSE, FALSE, FALSE, FALSE
    FROM public."FootballMatch" fixture CROSS JOIN clock
    WHERE fixture."status"::text = 'SCHEDULED' AND fixture."scheduledAt" > clock.now
      AND NOT EXISTS (SELECT 1 FROM public."MatchRuntime" runtime WHERE runtime."matchId" = fixture."id")
    UNION ALL
    SELECT clock.now + INTERVAL '5 seconds', FALSE, TRUE, FALSE, FALSE, FALSE
    FROM public."FootballMatch" fixture CROSS JOIN clock
    WHERE fixture."status"::text = 'SCHEDULED' AND fixture."scheduledAt" <= clock.now
      AND NOT EXISTS (SELECT 1 FROM public."MatchRuntime" runtime WHERE runtime."matchId" = fixture."id")
    UNION ALL
    SELECT GREATEST(clock.now + INTERVAL '1 second', notice."availableAt", COALESCE(notice."lockedUntil", '-infinity'::timestamptz)),
      FALSE, FALSE,
      (notice."availableAt" <= clock.now AND (notice."lockedUntil" IS NULL OR notice."lockedUntil" < clock.now - INTERVAL '30 seconds')),
      FALSE, FALSE
    FROM public."MatchLifecycleNotification" notice CROSS JOIN clock
    WHERE notice."status" = 'PENDING'
    UNION ALL
    SELECT GREATEST(clock.now + INTERVAL '1 second', notice."availableAt", COALESCE(notice."lockedUntil", '-infinity'::timestamptz)),
      FALSE, FALSE,
      (notice."availableAt" <= clock.now AND (notice."lockedUntil" IS NULL OR notice."lockedUntil" < clock.now - INTERVAL '30 seconds')),
      FALSE, FALSE
    FROM public."MatchResultNotification" notice
    JOIN public."FootballMatch" fixture ON fixture."id" = notice."matchId"
    CROSS JOIN clock
    WHERE notice."status" = 'PENDING' AND fixture."status"::text = 'COMPLETED'
    UNION ALL
    SELECT clock.now + INTERVAL '10 seconds', FALSE, FALSE, FALSE, TRUE, FALSE
    FROM public."EventTournament" tournament
    JOIN public."Competition" competition ON competition."id" = tournament."competitionId"
    CROSS JOIN clock
    WHERE tournament."status"::text = 'ACTIVE' AND competition."status"::text = 'COMPLETED'
    UNION ALL
    SELECT clock.now + INTERVAL '10 seconds', FALSE, FALSE, FALSE, FALSE, TRUE
    FROM public."PyramidLeague" league
    JOIN public."Competition" competition ON competition."id" = league."competitionId"
    CROSS JOIN clock
    WHERE league."promotionProcessedAt" IS NULL AND competition."status"::text = 'COMPLETED'
    UNION ALL
    SELECT offer."expiresAt", FALSE, FALSE, FALSE, FALSE, (offer."expiresAt" <= clock.now)
    FROM public."LeaguePromotionOffer" offer CROSS JOIN clock
    WHERE offer."status"::text = 'PENDING'
  )
  SELECT MIN(candidate_at), COALESCE(BOOL_OR(due_runtime), FALSE), COALESCE(BOOL_OR(due_fixture), FALSE),
    COALESCE(BOOL_OR(due_notifications), FALSE), COALESCE(BOOL_OR(pending_tournament), FALSE),
    COALESCE(BOOL_OR(pending_promotion), FALSE)
  FROM candidates;
$function$;
REVOKE ALL ON FUNCTION public.get_match_coordinator_schedule() FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.get_match_coordinator_schedule() TO service_role;
  END IF;
END;
$grant$;
