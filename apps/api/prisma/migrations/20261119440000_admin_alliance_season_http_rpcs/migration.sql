-- Dedicated service-role RPCs for superadmin alliance-season actions.
-- The API performs the superadmin authorization; these functions preserve the
-- authenticated admin Telegram identity and atomically write both audit trails.
CREATE OR REPLACE FUNCTION public.admin_start_alliance_season_http(
 p_actor_telegram_id text,p_alliance_id text,p_duration_days integer,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor public."User"%ROWTYPE; a public."Alliance"%ROWTYPE; founder public."AllianceGroup"%ROWTYPE;
 prev public."AllianceSeason"%ROWTYPE; s public."AllianceSeason"%ROWTYPE; days integer; prior public."AdminAuditLog"%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO prior FROM public."AdminAuditLog" WHERE "idempotencyKey"=p_idempotency_key FOR UPDATE;
 IF prior.id IS NOT NULL THEN
  IF prior."actorTelegramId"<>p_actor_telegram_id OR prior.action<>'start-alliance-season' OR prior."targetType"<>'alliance-season' THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN coalesce(prior.metadata->'result',jsonb_build_object('replayed',true,'targetId',prior."targetId"));
 END IF;
 SELECT * INTO actor FROM public."User" WHERE "telegramId"=p_actor_telegram_id;
 IF actor.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 SELECT * INTO a FROM public."Alliance" WHERE id=p_alliance_id FOR UPDATE;
 IF a.id IS NULL THEN RETURN jsonb_build_object('error','ALLIANCE_NOT_FOUND'); END IF;
 IF a.status<>'ACTIVE' THEN RETURN jsonb_build_object('error','ALLIANCE_INACTIVE'); END IF;
 SELECT * INTO founder FROM public."AllianceGroup" WHERE "allianceId"=a.id AND role='FOUNDER';
 IF founder.id IS NULL THEN RETURN jsonb_build_object('error','ALLIANCE_FOUNDER_REQUIRED'); END IF;
 SELECT * INTO prev FROM public."AllianceSeason" WHERE "allianceId"=a.id ORDER BY number DESC LIMIT 1 FOR UPDATE;
 IF prev.status='ACTIVE' THEN RETURN jsonb_build_object('error','SEASON_ALREADY_ACTIVE'); END IF;
 IF prev."reviewStatus"='FLAGGED' THEN RETURN jsonb_build_object('error','SEASON_REVIEW_REQUIRED'); END IF;
 days:=p_duration_days;
 IF days IS NULL THEN
  SELECT CASE WHEN jsonb_typeof(value)='number' THEN (value#>>'{}')::integer ELSE 30 END INTO days FROM public."GameSetting" WHERE key='alliances.defaultSeasonDurationDays';
 END IF;
 IF days IS NULL THEN days:=30; END IF;
 IF days<7 OR days>90 THEN RETURN jsonb_build_object('error','INVALID_SEASON_DURATION'); END IF;
 INSERT INTO public."AllianceSeason"(id,"allianceId",number,status,"startsAt","endsAt","createdAt","reviewStatus")
 VALUES(gen_random_uuid()::text,a.id,coalesce(prev.number,0)+1,'ACTIVE',now(),now()+make_interval(days=>days),now(),'PENDING') RETURNING * INTO s;
 INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt")
 VALUES(gen_random_uuid()::text,a.id,p_actor_telegram_id,(SELECT "telegramId" FROM public."TelegramGroup" WHERE id=founder."groupId"),'ADMIN_SEASON_STARTED',jsonb_build_object('seasonId',s.id,'number',s.number,'durationDays',days),now());
 result:=jsonb_build_object('season',to_jsonb(s),'replayed',false);
 INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId","idempotencyKey",metadata,"createdAt")
 VALUES(gen_random_uuid()::text,p_actor_telegram_id,'start-alliance-season','alliance-season',s.id,p_idempotency_key,jsonb_build_object('allianceId',a.id,'result',result),now());
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.admin_close_alliance_season_http(
 p_actor_telegram_id text,p_season_id text,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor public."User"%ROWTYPE; s public."AllianceSeason"%ROWTYPE; a public."Alliance"%ROWTYPE;
 founder public."AllianceGroup"%ROWTYPE; founder_telegram_id text; prior public."AdminAuditLog"%ROWTYPE;
 v_standings jsonb; v_flags jsonb:='[]'::jsonb; review text; winner record; prize bigint:=0; payout_key text; changed integer; result jsonb;
BEGIN
 SELECT * INTO prior FROM public."AdminAuditLog" WHERE "idempotencyKey"=p_idempotency_key FOR UPDATE;
 IF prior.id IS NOT NULL THEN
  IF prior."actorTelegramId"<>p_actor_telegram_id OR prior.action<>'close-alliance-season' OR prior."targetType"<>'alliance-season' OR prior."targetId"<>p_season_id THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN coalesce(prior.metadata->'result',jsonb_build_object('replayed',true));
 END IF;
 SELECT * INTO actor FROM public."User" WHERE "telegramId"=p_actor_telegram_id;
 IF actor.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 SELECT * INTO s FROM public."AllianceSeason" WHERE id=p_season_id FOR UPDATE;
 IF s.id IS NULL THEN RETURN jsonb_build_object('error','SEASON_NOT_FOUND'); END IF;
 SELECT * INTO a FROM public."Alliance" WHERE id=s."allianceId" FOR UPDATE;
 SELECT * INTO founder FROM public."AllianceGroup" WHERE "allianceId"=a.id AND role='FOUNDER';
 IF founder.id IS NULL THEN RETURN jsonb_build_object('error','ALLIANCE_FOUNDER_REQUIRED'); END IF;
 SELECT "telegramId" INTO founder_telegram_id FROM public."TelegramGroup" WHERE id=founder."groupId";
 IF s.status='COMPLETED' THEN
  result:=jsonb_build_object('season',to_jsonb(s),'standings',s.standings,'replayed',true,'reviewStatus',s."reviewStatus",'securityFlags',coalesce(s."securityFlags",'[]'::jsonb),'alertGroupTelegramId',founder_telegram_id);
 ELSE
  IF s.status<>'ACTIVE' THEN RETURN jsonb_build_object('error','NO_ACTIVE_SEASON'); END IF;
  IF s."endsAt">now() THEN RETURN jsonb_build_object('error','SEASON_NOT_ENDED'); END IF;
  WITH base AS (
   SELECT ag."groupId",tg.title,ag."joinedAt",greatest(coalesce(sum(l.amount),0),0)::bigint points
   FROM public."AllianceGroup" ag JOIN public."TelegramGroup" tg ON tg.id=ag."groupId"
   LEFT JOIN public."GroupPointLedger" l ON l."groupId"=ag."groupId" AND l."createdAt">=s."startsAt" AND l."createdAt"<s."endsAt" AND l."createdAt">=ag."joinedAt" AND l.source::text IN ('DAILY_ACTIVITY','GAME_ACTIVITY','CHALLENGE_REWARD','LEAGUE_REWARD')
   WHERE ag."allianceId"=a.id GROUP BY ag."groupId",tg.title,ag."joinedAt"
  ), ranked AS (
   SELECT row_number() OVER(ORDER BY points DESC,title ASC)::int rank,"groupId",title,points FROM base
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('rank',rank,'groupId',"groupId",'group',title,'points',points::text) ORDER BY rank),'[]'::jsonb) INTO v_standings FROM ranked;

  WITH group_totals AS (
   SELECT l."groupId",l."userId",sum(l.amount)::bigint points
   FROM public."GroupPointLedger" l JOIN public."AllianceGroup" ag ON ag."groupId"=l."groupId"
   WHERE ag."allianceId"=a.id AND l."createdAt">=ag."joinedAt" AND l."createdAt">=s."startsAt" AND l."createdAt"<s."endsAt" AND l.source::text IN ('DAILY_ACTIVITY','GAME_ACTIVITY','CHALLENGE_REWARD','LEAGUE_REWARD') AND l."userId" IS NOT NULL
   GROUP BY l."groupId",l."userId"
  ), group_scores AS (
   SELECT ag."groupId",tg.title,greatest(coalesce(sum(l.amount),0),0)::bigint total
   FROM public."AllianceGroup" ag JOIN public."TelegramGroup" tg ON tg.id=ag."groupId"
   LEFT JOIN public."GroupPointLedger" l ON l."groupId"=ag."groupId" AND l."createdAt">=s."startsAt" AND l."createdAt"<s."endsAt" AND l."createdAt">=ag."joinedAt" AND l.source::text IN ('DAILY_ACTIVITY','GAME_ACTIVITY','CHALLENGE_REWARD','LEAGUE_REWARD')
   WHERE ag."allianceId"=a.id GROUP BY ag."groupId",tg.title
  ), top_members AS (
   SELECT gs."groupId",gs.title,gs.total,max(greatest(coalesce(gt.points,0),0)) top_points
   FROM group_scores gs LEFT JOIN group_totals gt ON gt."groupId"=gs."groupId"
   GROUP BY gs."groupId",gs.title,gs.total
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('code','SINGLE_MEMBER_CONCENTRATION','groupId',"groupId",'group',title,'memberPoints',top_points::text,'totalPoints',total::text,'sharePercent',floor(top_points*10000.0/NULLIF(total,0))/100) ORDER BY title),'[]'::jsonb)
  INTO v_flags FROM top_members WHERE total>=30 AND top_points>=30 AND top_points*100>=total*80;

  WITH user_groups AS (
   SELECT l."userId",l."groupId",tg.title,sum(l.amount)::bigint points
   FROM public."GroupPointLedger" l JOIN public."AllianceGroup" ag ON ag."groupId"=l."groupId" JOIN public."TelegramGroup" tg ON tg.id=ag."groupId"
   WHERE ag."allianceId"=a.id AND l."createdAt">=ag."joinedAt" AND l."userId" IS NOT NULL AND l."createdAt">=s."startsAt" AND l."createdAt"<s."endsAt" AND l.source::text IN ('DAILY_ACTIVITY','GAME_ACTIVITY','CHALLENGE_REWARD','LEAGUE_REWARD')
   GROUP BY l."userId",l."groupId",tg.title HAVING sum(l.amount)>=50
  ), overlap_rows AS (
   SELECT "userId",sum(points)::bigint total,count(*)::int n,jsonb_agg(jsonb_build_object('groupId',"groupId",'group',title,'points',points::text) ORDER BY title) groups
   FROM user_groups GROUP BY "userId" HAVING count(*)>=2 AND sum(points)>=100
  )
  SELECT v_flags||coalesce(jsonb_agg(jsonb_build_object('code','CROSS_GROUP_MEMBER_OVERLAP','memberPoints',total::text,'groupCount',n,'groups',groups)),'[]'::jsonb) INTO v_flags FROM overlap_rows;
  review:=CASE WHEN jsonb_array_length(v_flags)>0 THEN 'FLAGGED' ELSE 'APPROVED' END;
  UPDATE public."AllianceSeason" SET status='COMPLETED',"closedAt"=now(),standings=v_standings,"securityFlags"=v_flags,"reviewStatus"=review::"AllianceSeasonReviewStatus" WHERE id=p_season_id AND status='ACTIVE' RETURNING * INTO s;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed=0 THEN RETURN jsonb_build_object('error','SEASON_ALREADY_SETTLED'); END IF;
  INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt")
  VALUES(gen_random_uuid()::text,a.id,p_actor_telegram_id,founder_telegram_id,'ADMIN_SEASON_CLOSED',jsonb_build_object('seasonId',s.id,'reviewStatus',review,'securityFlags',jsonb_array_length(v_flags)),now());
  IF review='APPROVED' THEN
   SELECT (x->>'groupId') group_id,(x->>'group') group_name,(x->>'points')::bigint points INTO winner FROM jsonb_array_elements(v_standings) x ORDER BY (x->>'rank')::int LIMIT 1;
   IF winner.group_id IS NOT NULL AND winner.points>0 AND a."treasuryPoints">0 THEN
    payout_key:='alliance-season-payout:'||s.id;
    SELECT -amount INTO prize FROM public."AllianceLedger" WHERE "idempotencyKey"=payout_key;
    IF NOT FOUND THEN
     prize:=a."treasuryPoints";
     UPDATE public."TelegramGroup" SET points=points+prize WHERE id=winner.group_id;
     UPDATE public."Alliance" SET "treasuryPoints"=0,"updatedAt"=now() WHERE id=a.id;
     INSERT INTO public."AllianceLedger"(id,"allianceId","idempotencyKey",amount,source,description,"createdAt") VALUES(gen_random_uuid()::text,a.id,payout_key,-prize,'SEASON_CHAMPION_REWARD','Season '||s.number||' champion payout to '||winner.group_name,now());
     INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt") VALUES(gen_random_uuid()::text,payout_key,winner.group_id,NULL,prize,'ADMIN_ADJUSTMENT','Alliance season champion reward',now());
    END IF;
    INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt") VALUES(gen_random_uuid()::text,a.id,p_actor_telegram_id,founder_telegram_id,'SEASON_PRIZE_PAID',jsonb_build_object('seasonId',s.id,'winner',winner.group_name,'prize',prize::text),now());
   END IF;
  END IF;
  result:=jsonb_build_object('season',to_jsonb(s),'standings',v_standings,'replayed',false,'reviewStatus',review,'securityFlags',v_flags,'winner',CASE WHEN review='APPROVED' THEN winner.group_name ELSE NULL END,'prize',prize::text,'alertGroupTelegramId',founder_telegram_id);
 END IF;
 INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId","idempotencyKey",metadata,"createdAt")
 VALUES(gen_random_uuid()::text,p_actor_telegram_id,'close-alliance-season','alliance-season',p_season_id,p_idempotency_key,jsonb_build_object('result',result),now());
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.admin_review_alliance_season_http(
 p_actor_telegram_id text,p_season_id text,p_decision text,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor public."User"%ROWTYPE; s public."AllianceSeason"%ROWTYPE; a public."Alliance"%ROWTYPE;
 founder public."AllianceGroup"%ROWTYPE; founder_telegram_id text; prior public."AdminAuditLog"%ROWTYPE;
 winner record; prize bigint:=0; treasury bigint; payout_key text; result jsonb;
BEGIN
 SELECT * INTO prior FROM public."AdminAuditLog" WHERE "idempotencyKey"=p_idempotency_key FOR UPDATE;
 IF prior.id IS NOT NULL THEN
  IF prior."actorTelegramId"<>p_actor_telegram_id OR prior.action<>'review-alliance-season' OR prior."targetType"<>'alliance-season' OR prior."targetId"<>p_season_id THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN coalesce(prior.metadata->'result',jsonb_build_object('replayed',true));
 END IF;
 SELECT * INTO actor FROM public."User" WHERE "telegramId"=p_actor_telegram_id;
 IF actor.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF p_decision NOT IN ('APPROVE','REJECT') THEN RETURN jsonb_build_object('error','INVALID_SEASON_DECISION'); END IF;
 SELECT * INTO s FROM public."AllianceSeason" WHERE id=p_season_id FOR UPDATE;
 IF s.id IS NULL THEN RETURN jsonb_build_object('error','SEASON_NOT_FOUND'); END IF;
 SELECT * INTO a FROM public."Alliance" WHERE id=s."allianceId" FOR UPDATE;
 SELECT * INTO founder FROM public."AllianceGroup" WHERE "allianceId"=a.id AND role='FOUNDER';
 IF founder.id IS NULL THEN RETURN jsonb_build_object('error','ALLIANCE_FOUNDER_REQUIRED'); END IF;
 SELECT "telegramId" INTO founder_telegram_id FROM public."TelegramGroup" WHERE id=founder."groupId";
 IF s."reviewStatus" IN ('APPROVED','REJECTED') THEN
  result:=jsonb_build_object('season',to_jsonb(s),'reviewStatus',s."reviewStatus",'replayed',true,'prize','0');
 ELSE
  IF s.status<>'COMPLETED' OR s."reviewStatus"<>'FLAGGED' THEN RETURN jsonb_build_object('error','SEASON_NOT_FLAGGED'); END IF;
  UPDATE public."AllianceSeason" SET "reviewStatus"=(CASE WHEN p_decision='APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END)::"AllianceSeasonReviewStatus","reviewedAt"=now(),"reviewedByUserId"=actor.id WHERE id=s.id RETURNING * INTO s;
  IF p_decision='APPROVE' THEN
   SELECT (x->>'groupId') group_id,(x->>'group') group_name,(x->>'points')::bigint points INTO winner FROM jsonb_array_elements(coalesce(s.standings,'[]'::jsonb)) x ORDER BY (x->>'rank')::int LIMIT 1;
   SELECT "treasuryPoints" INTO treasury FROM public."Alliance" WHERE id=a.id FOR UPDATE;
   IF winner.group_id IS NOT NULL AND winner.points>0 AND treasury>0 THEN
    payout_key:='alliance-season-payout:'||s.id;
    SELECT -amount INTO prize FROM public."AllianceLedger" WHERE "idempotencyKey"=payout_key;
    IF NOT FOUND THEN
     prize:=treasury;
     UPDATE public."TelegramGroup" SET points=points+prize WHERE id=winner.group_id;
     UPDATE public."Alliance" SET "treasuryPoints"=0,"updatedAt"=now() WHERE id=a.id;
     INSERT INTO public."AllianceLedger"(id,"allianceId","idempotencyKey",amount,source,description,"createdAt") VALUES(gen_random_uuid()::text,a.id,payout_key,-prize,'SEASON_CHAMPION_REWARD','Season '||s.number||' champion payout to '||winner.group_name,now());
     INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt") VALUES(gen_random_uuid()::text,payout_key,winner.group_id,NULL,prize,'ADMIN_ADJUSTMENT','Alliance season champion reward',now());
    END IF;
   END IF;
  END IF;
  INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt")
  VALUES(gen_random_uuid()::text,a.id,p_actor_telegram_id,founder_telegram_id,'ADMIN_SEASON_REVIEWED',jsonb_build_object('seasonId',s.id,'decision',p_decision,'prize',prize::text),now());
  result:=jsonb_build_object('season',to_jsonb(s),'reviewStatus',s."reviewStatus",'replayed',false,'winner',CASE WHEN p_decision='APPROVE' THEN winner.group_name ELSE NULL END,'prize',prize::text);
 END IF;
 INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId","idempotencyKey",metadata,"createdAt")
 VALUES(gen_random_uuid()::text,p_actor_telegram_id,'review-alliance-season','alliance-season',p_season_id,p_idempotency_key,jsonb_build_object('decision',p_decision,'result',result),now());
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.admin_start_alliance_season_http(text,text,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_close_alliance_season_http(text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_review_alliance_season_http(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_start_alliance_season_http(text,text,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_close_alliance_season_http(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_alliance_season_http(text,text,text,text) TO service_role;
