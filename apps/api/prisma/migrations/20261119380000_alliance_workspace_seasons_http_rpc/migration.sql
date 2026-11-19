
CREATE OR REPLACE FUNCTION public.get_alliance_workspace_http(p_telegram_user_id text,p_telegram_group_id text,p_is_reviewer boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; m public."AllianceGroup"%ROWTYPE; a public."Alliance"%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id;
 IF g.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id) THEN RETURN jsonb_build_object('error','NOT_GROUP_MEMBER'); END IF;
 SELECT * INTO m FROM public."AllianceGroup" WHERE "groupId"=g.id;
 IF m.id IS NULL THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'allianceId',i."allianceId",'groupId',i."groupId",'invitedByGroupId',i."invitedByGroupId",'status',i.status,'createdAt',i."createdAt",'respondedAt',i."respondedAt",'alliance',jsonb_build_object('name',a2.name,'description',a2.description)) ORDER BY i."createdAt" DESC),'[]'::jsonb)
  INTO result FROM public."AllianceInvitation" i JOIN public."Alliance" a2 ON a2.id=i."allianceId" WHERE i."groupId"=g.id AND i.status='PENDING';
  RETURN jsonb_build_object('alliance',NULL,'invitations',result);
 END IF;
 SELECT * INTO a FROM public."Alliance" WHERE id=m."allianceId";
 SELECT jsonb_build_object(
  'id',a.id,'name',a.name,'description',a.description,'treasuryPoints',a."treasuryPoints"::text,
  'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('title',tg.title,'telegramGroupId',tg."telegramId",'memberCount',tg."memberCount",'points',tg.points::text,'role',ag.role) ORDER BY ag."joinedAt") FROM public."AllianceGroup" ag JOIN public."TelegramGroup" tg ON tg.id=ag."groupId" WHERE ag."allianceId"=a.id),'[]'::jsonb),
  'canReview',(m.role='FOUNDER' AND coalesce(p_is_reviewer,false)),
  'seasons',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.number DESC) FROM (SELECT * FROM public."AllianceSeason" WHERE "allianceId"=a.id ORDER BY number DESC LIMIT 5) s),'[]'::jsonb),
  'auditLogs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'actorTelegramId',l."actorTelegramId",'groupTelegramId',l."groupTelegramId",'action',l.action,'metadata',l.metadata,'createdAt',l."createdAt") ORDER BY l."createdAt" DESC) FROM (SELECT * FROM public."AllianceAuditLog" WHERE "allianceId"=a.id ORDER BY "createdAt" DESC LIMIT 50) l),'[]'::jsonb),
  'competitions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'status',c.status,'teams',c.teams,'standings',c.standings) ORDER BY c."createdAt" DESC) FROM (
   SELECT cp.id,cp.name,cp.status::text status,cp."createdAt",
    (SELECT count(*)::int FROM public."CompetitionEntry" ce WHERE ce."competitionId"=cp.id) teams,
    coalesce((SELECT jsonb_agg(jsonb_build_object('rank',ranked.rank,'club',ranked.club,'played',ranked.played,'points',ranked.points,'goalsFor',ranked."goalsFor",'goalsAgainst',ranked."goalsAgainst") ORDER BY ranked.rank) FROM (
      SELECT row_number() OVER(ORDER BY ce.points DESC,ce."goalsFor" DESC,ce."goalsAgainst" ASC)::int rank,cl.name club,ce.played,ce.points,ce."goalsFor",ce."goalsAgainst"
      FROM public."CompetitionEntry" ce JOIN public."Club" cl ON cl.id=ce."clubId" WHERE ce."competitionId"=cp.id
    ) ranked),'[]'::jsonb) standings
   FROM public."Competition" cp WHERE cp."allianceId"=a.id AND cp.status::text IN ('REGISTRATION','ACTIVE','COMPLETED')
   ORDER BY cp."createdAt" DESC LIMIT 20
  ) c),'[]'::jsonb)
 ) INTO result;
 RETURN jsonb_build_object('alliance',result,'invitations','[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.start_alliance_season_http(p_telegram_user_id text,p_telegram_group_id text,p_duration_days integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; m public."AllianceGroup"%ROWTYPE; a public."Alliance"%ROWTYPE; prev public."AllianceSeason"%ROWTYPE; s public."AllianceSeason"%ROWTYPE; days integer;
BEGIN
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF u."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Club" WHERE "ownerId"=u.id) THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF NOT g."isActive" OR g."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id AND role<>'MEMBER') THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO m FROM public."AllianceGroup" WHERE "groupId"=g.id;
 IF m.id IS NULL OR m.role<>'FOUNDER' THEN RETURN jsonb_build_object('error','ALLIANCE_FOUNDER_REQUIRED'); END IF;
 SELECT * INTO a FROM public."Alliance" WHERE id=m."allianceId" FOR UPDATE;
 IF a.status<>'ACTIVE' THEN RETURN jsonb_build_object('error','ALLIANCE_INACTIVE'); END IF;
 SELECT * INTO prev FROM public."AllianceSeason" WHERE "allianceId"=a.id ORDER BY number DESC LIMIT 1 FOR UPDATE;
 IF prev.status='ACTIVE' THEN RETURN jsonb_build_object('error','SEASON_ALREADY_ACTIVE'); END IF;
 IF prev."reviewStatus"='FLAGGED' THEN RETURN jsonb_build_object('error','SEASON_REVIEW_REQUIRED'); END IF;
 days:=p_duration_days;
 IF days IS NULL THEN SELECT CASE WHEN jsonb_typeof(value)='number' THEN (value#>>'{}')::integer ELSE 30 END INTO days FROM public."GameSetting" WHERE key='alliances.defaultSeasonDurationDays'; END IF;
 IF days IS NULL OR days<7 OR days>90 THEN days:=30; END IF;
 IF p_duration_days IS NOT NULL AND (p_duration_days<7 OR p_duration_days>90) THEN RETURN jsonb_build_object('error','INVALID_SEASON_DURATION'); END IF;
 INSERT INTO public."AllianceSeason"(id,"allianceId",number,status,"startsAt","endsAt","createdAt","reviewStatus") VALUES(gen_random_uuid()::text,a.id,coalesce(prev.number,0)+1,'ACTIVE',now(),now()+make_interval(days=>days),now(),'PENDING') RETURNING * INTO s;
 INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt") VALUES(gen_random_uuid()::text,a.id,p_telegram_user_id,p_telegram_group_id,'SEASON_STARTED',jsonb_build_object('seasonId',s.id,'number',s.number,'durationDays',days),now());
 RETURN jsonb_build_object('season',to_jsonb(s),'replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.close_alliance_season_http(p_telegram_user_id text,p_telegram_group_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; m public."AllianceGroup"%ROWTYPE; a public."Alliance"%ROWTYPE; s public."AllianceSeason"%ROWTYPE;
 v_standings jsonb; v_flags jsonb:='[]'::jsonb; v_review text; v_winner record; v_prize bigint:=0; v_key text; v_changed integer;
BEGIN
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id AND role<>'MEMBER') THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO m FROM public."AllianceGroup" WHERE "groupId"=g.id;
 IF m.id IS NULL OR m.role<>'FOUNDER' THEN RETURN jsonb_build_object('error','ALLIANCE_FOUNDER_REQUIRED'); END IF;
 SELECT * INTO a FROM public."Alliance" WHERE id=m."allianceId" FOR UPDATE;
 SELECT * INTO s FROM public."AllianceSeason" WHERE "allianceId"=a.id ORDER BY number DESC LIMIT 1 FOR UPDATE;
 IF s.id IS NULL THEN RETURN jsonb_build_object('error','NO_ACTIVE_SEASON'); END IF;
 IF s.status='COMPLETED' THEN RETURN jsonb_build_object('season',to_jsonb(s),'standings',s.standings,'replayed',true,'reviewStatus',s."reviewStatus",'securityFlags',coalesce(s."securityFlags",'[]'::jsonb)); END IF;
 IF s.status<>'ACTIVE' THEN RETURN jsonb_build_object('error','NO_ACTIVE_SEASON'); END IF;
 IF s."endsAt">now() THEN RETURN jsonb_build_object('error','SEASON_NOT_ENDED'); END IF;
 WITH base AS (
  SELECT ag."groupId",tg.title,ag."joinedAt",greatest(coalesce(sum(l.amount),0),0)::bigint points
  FROM public."AllianceGroup" ag JOIN public."TelegramGroup" tg ON tg.id=ag."groupId"
  LEFT JOIN public."GroupPointLedger" l ON l."groupId"=ag."groupId" AND l."createdAt">=s."startsAt" AND l."createdAt"<s."endsAt" AND l."createdAt">=ag."joinedAt" AND l.source::text IN ('DAILY_ACTIVITY','GAME_ACTIVITY','CHALLENGE_REWARD','LEAGUE_REWARD')
  WHERE ag."allianceId"=a.id GROUP BY ag."groupId",tg.title,ag."joinedAt"
 ), ranked AS (
  SELECT row_number() OVER(ORDER BY points DESC,title ASC)::int rank,"groupId",title,points FROM base
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('rank',rank,'groupId',"groupId",'group',title,'points',points::text) ORDER BY rank),'[]'::jsonb) INTO v_standings FROM ranked;
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
 ), overlaps AS (
  SELECT "userId",sum(points)::bigint total,count(*)::int n,jsonb_agg(jsonb_build_object('groupId',"groupId",'group',title,'points',points::text) ORDER BY title) groups
  FROM user_groups GROUP BY "userId" HAVING count(*)>=2 AND sum(points)>=100
 )
 SELECT v_flags||coalesce(jsonb_agg(jsonb_build_object('code','CROSS_GROUP_MEMBER_OVERLAP','memberPoints',total::text,'groupCount',n,'groups',groups)),'[]'::jsonb) INTO v_flags FROM overlaps;
 v_review:=CASE WHEN jsonb_array_length(v_flags)>0 THEN 'FLAGGED' ELSE 'APPROVED' END;
 UPDATE public."AllianceSeason" SET status='COMPLETED',"closedAt"=now(),standings=v_standings,"securityFlags"=v_flags,"reviewStatus"=v_review WHERE id=s.id AND status='ACTIVE';
 GET DIAGNOSTICS v_changed=ROW_COUNT;
 IF v_changed=0 THEN RETURN jsonb_build_object('error','SEASON_ALREADY_SETTLED'); END IF;
 INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt") VALUES(gen_random_uuid()::text,a.id,p_telegram_user_id,p_telegram_group_id,'SEASON_CLOSED',jsonb_build_object('seasonId',s.id,'reviewStatus',v_review,'securityFlags',jsonb_array_length(v_flags)),now());
 IF v_review='APPROVED' THEN
  SELECT (x->>'groupId') group_id,(x->>'group') group_name,(x->>'points')::bigint points INTO v_winner FROM jsonb_array_elements(v_standings) x ORDER BY (x->>'rank')::int LIMIT 1;
  IF v_winner.group_id IS NOT NULL AND v_winner.points>0 AND a."treasuryPoints">0 THEN
   v_key:='alliance-season-payout:'||s.id;
   SELECT -amount INTO v_prize FROM public."AllianceLedger" WHERE "idempotencyKey"=v_key;
   IF NOT FOUND THEN
    v_prize:=a."treasuryPoints";
    UPDATE public."TelegramGroup" SET points=points+v_prize WHERE id=v_winner.group_id;
    UPDATE public."Alliance" SET "treasuryPoints"=0,"updatedAt"=now() WHERE id=a.id;
    INSERT INTO public."AllianceLedger"(id,"allianceId","idempotencyKey",amount,source,description,"createdAt") VALUES(gen_random_uuid()::text,a.id,v_key,-v_prize,'SEASON_CHAMPION_REWARD','Season '||s.number||' champion payout to '||v_winner.group_name,now());
    INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt") VALUES(gen_random_uuid()::text,v_key,v_winner.group_id,NULL,v_prize,'ADMIN_ADJUSTMENT','Alliance season champion reward',now());
   END IF;
   INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt") VALUES(gen_random_uuid()::text,a.id,p_telegram_user_id,p_telegram_group_id,'SEASON_PRIZE_PAID',jsonb_build_object('seasonId',s.id,'winner',v_winner.group_name,'prize',v_prize::text),now());
  END IF;
 END IF;
 SELECT current_season.* INTO s FROM public."AllianceSeason" current_season WHERE current_season.id=s.id;
 RETURN jsonb_build_object('season',to_jsonb(s),'standings',v_standings,'replayed',false,'reviewStatus',v_review,'securityFlags',v_flags,'winner',CASE WHEN v_review='APPROVED' THEN v_winner.group_name ELSE NULL END,'prize',v_prize::text);
END $$;

CREATE OR REPLACE FUNCTION public.review_alliance_season_http(p_telegram_user_id text,p_telegram_group_id text,p_season_id text,p_decision text,p_is_reviewer boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; m public."AllianceGroup"%ROWTYPE; a public."Alliance"%ROWTYPE; s public."AllianceSeason"%ROWTYPE; v_prize bigint:=0; v_winner record; v_key text; v_treasury bigint;
BEGIN
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id AND role<>'MEMBER') THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO m FROM public."AllianceGroup" WHERE "groupId"=g.id;
 IF m.id IS NULL OR m.role<>'FOUNDER' THEN RETURN jsonb_build_object('error','ALLIANCE_FOUNDER_REQUIRED'); END IF;
 IF NOT coalesce(p_is_reviewer,false) THEN RETURN jsonb_build_object('error','ALLIANCE_REVIEWER_REQUIRED'); END IF;
 SELECT * INTO a FROM public."Alliance" WHERE id=m."allianceId" FOR UPDATE;
 SELECT * INTO s FROM public."AllianceSeason" WHERE id=p_season_id AND "allianceId"=a.id FOR UPDATE;
 IF s.id IS NULL THEN RETURN jsonb_build_object('error','SEASON_NOT_FOUND'); END IF;
 IF s."reviewStatus" IN ('APPROVED','REJECTED') THEN RETURN jsonb_build_object('reviewStatus',s."reviewStatus",'replayed',true,'prize','0'); END IF;
 IF s.status<>'COMPLETED' OR s."reviewStatus"<>'FLAGGED' THEN RETURN jsonb_build_object('error','SEASON_NOT_FLAGGED'); END IF;
 IF p_decision NOT IN ('APPROVE','REJECT') THEN RETURN jsonb_build_object('error','INVALID_SEASON_DECISION'); END IF;
 UPDATE public."AllianceSeason" SET "reviewStatus"=CASE WHEN p_decision='APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,"reviewedAt"=now(),"reviewedByUserId"=u.id WHERE id=s.id RETURNING * INTO s;
 IF p_decision='APPROVE' THEN
  SELECT (x->>'groupId') group_id,(x->>'group') group_name,(x->>'points')::bigint points INTO v_winner FROM jsonb_array_elements(coalesce(s.standings,'[]'::jsonb)) x ORDER BY (x->>'rank')::int LIMIT 1;
  SELECT "treasuryPoints" INTO v_treasury FROM public."Alliance" WHERE id=a.id FOR UPDATE;
  IF v_winner.group_id IS NOT NULL AND v_winner.points>0 AND v_treasury>0 THEN
   v_key:='alliance-season-payout:'||s.id;
   SELECT -amount INTO v_prize FROM public."AllianceLedger" WHERE "idempotencyKey"=v_key;
   IF NOT FOUND THEN
    v_prize:=v_treasury;
    UPDATE public."TelegramGroup" SET points=points+v_prize WHERE id=v_winner.group_id;
    UPDATE public."Alliance" SET "treasuryPoints"=0,"updatedAt"=now() WHERE id=a.id;
    INSERT INTO public."AllianceLedger"(id,"allianceId","idempotencyKey",amount,source,description,"createdAt") VALUES(gen_random_uuid()::text,a.id,v_key,-v_prize,'SEASON_CHAMPION_REWARD','Season '||s.number||' champion payout to '||v_winner.group_name,now());
    INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt") VALUES(gen_random_uuid()::text,v_key,v_winner.group_id,NULL,v_prize,'ADMIN_ADJUSTMENT','Alliance season champion reward',now());
   END IF;
  END IF;
 END IF;
 INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt") VALUES(gen_random_uuid()::text,a.id,p_telegram_user_id,p_telegram_group_id,'SEASON_SECURITY_REVIEW',jsonb_build_object('seasonId',s.id,'decision',p_decision,'prize',v_prize::text),now());
 RETURN jsonb_build_object('season',to_jsonb(s),'reviewStatus',s."reviewStatus",'replayed',false,'winner',CASE WHEN p_decision='APPROVE' THEN v_winner.group_name ELSE NULL END,'prize',v_prize::text);
END $$;

REVOKE ALL ON FUNCTION public.get_alliance_workspace_http(text,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.start_alliance_season_http(text,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.close_alliance_season_http(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.review_alliance_season_http(text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_alliance_workspace_http(text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_alliance_season_http(text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_alliance_season_http(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_alliance_season_http(text,text,text,text,boolean) TO service_role;
