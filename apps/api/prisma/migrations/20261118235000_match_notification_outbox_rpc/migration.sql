CREATE OR REPLACE FUNCTION public.claim_due_match_lifecycle_notifications(p_limit integer DEFAULT 50,p_lease_seconds integer DEFAULT 30)
RETURNS TABLE(id text,claim_token text,telegram_chat_id text,kind text,minute integer,home_score integer,away_score integer,home_club_name text,away_club_name text,payload jsonb)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 WITH candidates AS (SELECT n."id" FROM public."MatchLifecycleNotification" n WHERE n."status"='PENDING' AND n."availableAt"<=NOW()
 AND (n."lockedUntil" IS NULL OR n."lockedUntil"<NOW()-INTERVAL '30 seconds') ORDER BY n."availableAt",n."createdAt"
 FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),100)),
 claimed AS (UPDATE public."MatchLifecycleNotification" n SET "claimToken"=gen_random_uuid()::text,
 "lockedUntil"=NOW()+make_interval(secs=>LEAST(GREATEST(p_lease_seconds,5),300)),"attempts"=n."attempts"+1,"updatedAt"=NOW()
 FROM candidates c WHERE n."id"=c."id" RETURNING n.*)
 SELECT c."id",c."claimToken",c."telegramChatId",c."kind",c."minute",c."homeScore",c."awayScore",h."name",a."name",c."payload"
 FROM claimed c JOIN public."FootballMatch" m ON m."id"=c."matchId" JOIN public."Club" h ON h."id"=m."homeClubId" JOIN public."Club" a ON a."id"=m."awayClubId";
$$;
CREATE OR REPLACE FUNCTION public.claim_due_match_result_notifications(p_limit integer DEFAULT 50,p_lease_seconds integer DEFAULT 30)
RETURNS TABLE(id text,claim_token text,telegram_chat_id text,home_score integer,away_score integer,home_club_id text,away_club_id text,home_club_name text,away_club_name text,performances jsonb)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 WITH candidates AS (SELECT n."id" FROM public."MatchResultNotification" n JOIN public."FootballMatch" m ON m."id"=n."matchId"
 WHERE n."status"='PENDING' AND n."availableAt"<=NOW() AND m."status"::text='COMPLETED'
 AND (n."lockedUntil" IS NULL OR n."lockedUntil"<NOW()-INTERVAL '30 seconds') ORDER BY n."createdAt"
 FOR UPDATE OF n SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),100)),
 claimed AS (UPDATE public."MatchResultNotification" n SET "claimToken"=gen_random_uuid()::text,
 "lockedUntil"=NOW()+make_interval(secs=>LEAST(GREATEST(p_lease_seconds,5),300)),"attempts"=n."attempts"+1,"updatedAt"=NOW()
 FROM candidates c WHERE n."id"=c."id" RETURNING n.*)
 SELECT c."id",c."claimToken",c."telegramChatId",m."homeScore",m."awayScore",m."homeClubId",m."awayClubId",h."name",a."name",
 COALESCE((SELECT jsonb_agg(jsonb_build_object('club_id',p."clubId",'goals',p."goals",'shots',p."shots",'passes',p."passes",
 'tackles',p."tackles",'player_name',pl."firstName"||' '||pl."lastName") ORDER BY p."goals" DESC,pl."lastName",pl."firstName")
 FROM public."PlayerMatchPerformance" p JOIN public."Player" pl ON pl."id"=p."playerId" WHERE p."matchId"=m."id"),'[]'::jsonb)
 FROM claimed c JOIN public."FootballMatch" m ON m."id"=c."matchId" JOIN public."Club" h ON h."id"=m."homeClubId" JOIN public."Club" a ON a."id"=m."awayClubId";
$$;
CREATE OR REPLACE FUNCTION public.complete_match_notification_delivery(p_notification_type text,p_notification_id text,p_claim_token text,
 p_delivered boolean,p_error text DEFAULT NULL,p_retry_seconds integer DEFAULT 15)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE affected integer;
BEGIN
 IF p_notification_type='LIFECYCLE' THEN
 UPDATE public."MatchLifecycleNotification" SET "status"=CASE WHEN p_delivered THEN 'DELIVERED' ELSE 'PENDING' END,
 "deliveredAt"=CASE WHEN p_delivered THEN NOW() ELSE NULL END,
 "availableAt"=CASE WHEN p_delivered THEN "availableAt" ELSE NOW()+make_interval(secs=>LEAST(GREATEST(p_retry_seconds,1),3600)) END,
 "claimToken"=NULL,"lockedUntil"=NULL,"lastError"=CASE WHEN p_delivered THEN NULL ELSE left(COALESCE(p_error,'TELEGRAM_SEND_FAILED'),500) END,"updatedAt"=NOW()
 WHERE "id"=p_notification_id AND "claimToken"=p_claim_token AND "status"='PENDING';
 ELSIF p_notification_type='RESULT' THEN
 UPDATE public."MatchResultNotification" SET "status"=CASE WHEN p_delivered THEN 'DELIVERED' ELSE 'PENDING' END,
 "deliveredAt"=CASE WHEN p_delivered THEN NOW() ELSE NULL END,
 "availableAt"=CASE WHEN p_delivered THEN "availableAt" ELSE NOW()+make_interval(secs=>LEAST(GREATEST(p_retry_seconds,1),3600)) END,
 "claimToken"=NULL,"lockedUntil"=NULL,"lastError"=CASE WHEN p_delivered THEN NULL ELSE left(COALESCE(p_error,'TELEGRAM_SEND_FAILED'),500) END,"updatedAt"=NOW()
 WHERE "id"=p_notification_id AND "claimToken"=p_claim_token AND "status"='PENDING';
 ELSE RAISE EXCEPTION 'INVALID_MATCH_NOTIFICATION_TYPE';
 END IF;
 GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected=1;
END; $$;
REVOKE ALL ON FUNCTION public.claim_due_match_lifecycle_notifications(integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_due_match_result_notifications(integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_match_notification_delivery(text,text,text,boolean,text,integer) FROM PUBLIC,anon,authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT EXECUTE ON FUNCTION public.claim_due_match_lifecycle_notifications(integer,integer) TO service_role;
 GRANT EXECUTE ON FUNCTION public.claim_due_match_result_notifications(integer,integer) TO service_role;
 GRANT EXECUTE ON FUNCTION public.complete_match_notification_delivery(text,text,text,boolean,text,integer) TO service_role;
END IF; END $$;
