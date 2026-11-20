CREATE OR REPLACE FUNCTION public.claim_due_match_lifecycle_notifications_node_http(p_limit integer DEFAULT 50,p_lease_seconds integer DEFAULT 30)
RETURNS TABLE(id text,channel text,telegram_chat_id text,claim_token text,attempt integer,kind text,minute integer,home_score integer,away_score integer,payload jsonb,match_id text,home_club_name text,away_club_name text)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 WITH candidates AS (
  SELECT n."id" FROM public."MatchLifecycleNotification" n
  WHERE n."status"='PENDING' AND n."availableAt"<=NOW()
   AND (n."lockedUntil" IS NULL OR n."lockedUntil"<NOW()-INTERVAL '30 seconds')
  ORDER BY n."availableAt",n."createdAt" FOR UPDATE SKIP LOCKED
  LIMIT LEAST(GREATEST(COALESCE(p_limit,50),1),100)
 ), claimed AS (
  UPDATE public."MatchLifecycleNotification" n SET "claimToken"=gen_random_uuid()::text,
   "lockedUntil"=NOW()+make_interval(secs=>LEAST(GREATEST(COALESCE(p_lease_seconds,30),5),300)),
   "attempts"=n."attempts"+1,"updatedAt"=NOW()
  FROM candidates c WHERE n."id"=c."id" RETURNING n.*
 )
 SELECT c."id",c."channel"::text,c."telegramChatId",c."claimToken",c."attempts",c."kind"::text,c."minute",
  c."homeScore",c."awayScore",c."payload",m."id",h."name",a."name"
 FROM claimed c JOIN public."FootballMatch" m ON m."id"=c."matchId"
 JOIN public."Club" h ON h."id"=m."homeClubId" JOIN public."Club" a ON a."id"=m."awayClubId";
$$;

CREATE OR REPLACE FUNCTION public.claim_due_match_result_notifications_node_http(p_limit integer DEFAULT 25,p_lease_seconds integer DEFAULT 30)
RETURNS TABLE(id text,channel text,telegram_chat_id text,claim_token text,attempt integer,match_id text,
 home_score integer,away_score integer,completed_at timestamp without time zone,home_club_id text,away_club_id text,
 home_club_name text,away_club_name text,performances jsonb)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 WITH candidates AS (
  SELECT n."id" FROM public."MatchResultNotification" n JOIN public."FootballMatch" m ON m."id"=n."matchId"
  WHERE n."status"='PENDING' AND n."availableAt"<=NOW() AND m."status"::text='COMPLETED'
   AND (n."lockedUntil" IS NULL OR n."lockedUntil"<NOW()-INTERVAL '30 seconds')
  ORDER BY n."createdAt" FOR UPDATE OF n SKIP LOCKED
  LIMIT LEAST(GREATEST(COALESCE(p_limit,25),1),100)
 ), claimed AS (
  UPDATE public."MatchResultNotification" n SET "claimToken"=gen_random_uuid()::text,
   "lockedUntil"=NOW()+make_interval(secs=>LEAST(GREATEST(COALESCE(p_lease_seconds,30),5),300)),
   "attempts"=n."attempts"+1,"updatedAt"=NOW()
  FROM candidates c WHERE n."id"=c."id" RETURNING n.*
 )
 SELECT c."id",c."channel"::text,c."telegramChatId",c."claimToken",c."attempts",m."id",
  m."homeScore",m."awayScore",m."completedAt",m."homeClubId",m."awayClubId",h."name",a."name",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('club_id',p."clubId",'goals',p."goals",'shots',p."shots",
   'passes',p."passes",'tackles',p."tackles",'player_name',pl."firstName"||' '||pl."lastName")
   ORDER BY p."goals" DESC,pl."lastName",pl."firstName")
   FROM public."PlayerMatchPerformance" p JOIN public."Player" pl ON pl."id"=p."playerId" WHERE p."matchId"=m."id"),'[]'::jsonb)
 FROM claimed c JOIN public."FootballMatch" m ON m."id"=c."matchId"
 JOIN public."Club" h ON h."id"=m."homeClubId" JOIN public."Club" a ON a."id"=m."awayClubId";
$$;

CREATE OR REPLACE FUNCTION public.claim_due_match_checkpoint_notifications_node_http(p_limit integer DEFAULT 25,p_checkpoint_id text DEFAULT NULL)
RETURNS TABLE(checkpoint_id text,match_id text,checkpoint_key text,minute integer,deadline_at timestamp without time zone,
 club_id text,club_name text,opponent_name text,telegram_user_id text,side text,attempt integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE cp record; changed integer;
BEGIN
 FOR cp IN
  SELECT c.*,m."id" AS match_id,m."homeClubId",m."awayClubId",hc."name" AS home_name,ac."name" AS away_name,
   hu."telegramId" AS home_telegram,au."telegramId" AS away_telegram,
   EXISTS(SELECT 1 FROM public."MatchTacticalDecision" d WHERE d."checkpointId"=c."id" AND d."clubId"=m."homeClubId") AS home_decided,
   EXISTS(SELECT 1 FROM public."MatchTacticalDecision" d WHERE d."checkpointId"=c."id" AND d."clubId"=m."awayClubId") AS away_decided
  FROM public."MatchTacticalCheckpoint" c JOIN public."FootballMatch" m ON m."id"=c."matchId"
  JOIN public."Club" hc ON hc."id"=m."homeClubId" JOIN public."Club" ac ON ac."id"=m."awayClubId"
  JOIN public."User" hu ON hu."id"=hc."ownerId" JOIN public."User" au ON au."id"=ac."ownerId"
  WHERE c."status"='OPEN' AND c."openedAt"<=NOW() AND c."decisionDeadlineAt">NOW()
   AND (p_checkpoint_id IS NULL OR c."id"=p_checkpoint_id)
   AND ((c."homeBotNotifiedAt" IS NULL AND (c."homeBotNotificationClaimedAt" IS NULL OR c."homeBotNotificationClaimedAt"<NOW()-INTERVAL '30 seconds'))
    OR (c."awayBotNotifiedAt" IS NULL AND (c."awayBotNotificationClaimedAt" IS NULL OR c."awayBotNotificationClaimedAt"<NOW()-INTERVAL '30 seconds')))
  ORDER BY c."openedAt",c."minute" FOR UPDATE OF c SKIP LOCKED
  LIMIT LEAST(GREATEST(COALESCE(p_limit,25),1),100)
 LOOP
  IF cp."homeBotNotifiedAt" IS NULL THEN
   IF cp.home_decided THEN
    UPDATE public."MatchTacticalCheckpoint" SET "homeBotNotifiedAt"=NOW(),"homeBotNotificationClaimedAt"=NULL
     WHERE "id"=cp."id" AND "homeBotNotifiedAt" IS NULL;
   ELSE
    UPDATE public."MatchTacticalCheckpoint" SET "homeBotNotificationClaimedAt"=NOW(),"homeBotNotificationAttempts"="homeBotNotificationAttempts"+1
     WHERE "id"=cp."id" AND "homeBotNotifiedAt" IS NULL
      AND ("homeBotNotificationClaimedAt" IS NULL OR "homeBotNotificationClaimedAt"<NOW()-INTERVAL '30 seconds');
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed=1 THEN checkpoint_id:=cp."id";match_id:=cp.match_id;checkpoint_key:=cp."checkpointKey";minute:=cp."minute";
     deadline_at:=cp."decisionDeadlineAt";club_id:=cp."homeClubId";club_name:=cp.home_name;opponent_name:=cp.away_name;
     telegram_user_id:=cp.home_telegram;side:='HOME';attempt:=cp."homeBotNotificationAttempts"+1;RETURN NEXT; END IF;
   END IF;
  END IF;
  IF cp."awayBotNotifiedAt" IS NULL THEN
   IF cp.away_decided THEN
    UPDATE public."MatchTacticalCheckpoint" SET "awayBotNotifiedAt"=NOW(),"awayBotNotificationClaimedAt"=NULL
     WHERE "id"=cp."id" AND "awayBotNotifiedAt" IS NULL;
   ELSE
    UPDATE public."MatchTacticalCheckpoint" SET "awayBotNotificationClaimedAt"=NOW(),"awayBotNotificationAttempts"="awayBotNotificationAttempts"+1
     WHERE "id"=cp."id" AND "awayBotNotifiedAt" IS NULL
      AND ("awayBotNotificationClaimedAt" IS NULL OR "awayBotNotificationClaimedAt"<NOW()-INTERVAL '30 seconds');
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed=1 THEN checkpoint_id:=cp."id";match_id:=cp.match_id;checkpoint_key:=cp."checkpointKey";minute:=cp."minute";
     deadline_at:=cp."decisionDeadlineAt";club_id:=cp."awayClubId";club_name:=cp.away_name;opponent_name:=cp.home_name;
     telegram_user_id:=cp.away_telegram;side:='AWAY';attempt:=cp."awayBotNotificationAttempts"+1;RETURN NEXT; END IF;
   END IF;
  END IF;
 END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.ack_match_checkpoint_notification_node_http(p_checkpoint_id text,p_side text,p_delivered boolean,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE affected integer;
BEGIN
 IF p_side='HOME' THEN
  UPDATE public."MatchTacticalCheckpoint" SET
   "homeBotNotifiedAt"=CASE WHEN p_delivered THEN NOW() ELSE "homeBotNotifiedAt" END,
   "homeBotNotificationClaimedAt"=CASE WHEN p_delivered THEN NULL ELSE "homeBotNotificationClaimedAt" END,
   "homeBotNotificationLastError"=CASE WHEN p_delivered THEN NULL ELSE left(COALESCE(p_error,'TELEGRAM_SEND_FAILED'),500) END
  WHERE "id"=p_checkpoint_id AND "status"='OPEN' AND "homeBotNotificationClaimedAt" IS NOT NULL;
 ELSIF p_side='AWAY' THEN
  UPDATE public."MatchTacticalCheckpoint" SET
   "awayBotNotifiedAt"=CASE WHEN p_delivered THEN NOW() ELSE "awayBotNotifiedAt" END,
   "awayBotNotificationClaimedAt"=CASE WHEN p_delivered THEN NULL ELSE "awayBotNotificationClaimedAt" END,
   "awayBotNotificationLastError"=CASE WHEN p_delivered THEN NULL ELSE left(COALESCE(p_error,'TELEGRAM_SEND_FAILED'),500) END
  WHERE "id"=p_checkpoint_id AND "status"='OPEN' AND "awayBotNotificationClaimedAt" IS NOT NULL;
 ELSE RAISE EXCEPTION 'INVALID_MATCH_CHECKPOINT_NOTIFICATION_SIDE';
 END IF;
 GET DIAGNOSTICS affected=ROW_COUNT;RETURN affected=1;
END; $$;

GRANT SELECT,UPDATE ON TABLE public."MatchLifecycleNotification",public."MatchResultNotification",public."MatchTacticalCheckpoint" TO service_role;
GRANT SELECT ON TABLE public."MatchTacticalDecision",public."FootballMatch",public."Club",public."User",public."PlayerMatchPerformance",public."Player" TO service_role;
REVOKE ALL ON FUNCTION public.claim_due_match_lifecycle_notifications_node_http(integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_due_match_result_notifications_node_http(integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_due_match_checkpoint_notifications_node_http(integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ack_match_checkpoint_notification_node_http(text,text,boolean,text) FROM PUBLIC,anon,authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT EXECUTE ON FUNCTION public.claim_due_match_lifecycle_notifications_node_http(integer,integer) TO service_role;
 GRANT EXECUTE ON FUNCTION public.claim_due_match_result_notifications_node_http(integer,integer) TO service_role;
 GRANT EXECUTE ON FUNCTION public.claim_due_match_checkpoint_notifications_node_http(integer,text) TO service_role;
 GRANT EXECUTE ON FUNCTION public.ack_match_checkpoint_notification_node_http(text,text,boolean,text) TO service_role;
END IF; END $$;
