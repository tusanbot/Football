CREATE OR REPLACE FUNCTION public.create_alliance_championship_http(p_telegram_user_id text,p_telegram_group_id text,p_name text,p_max_teams integer,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; m public."AllianceGroup"%ROWTYPE; a public."Alliance"%ROWTYPE; s public."AllianceSeason"%ROWTYPE; v_club_id text; old public."Competition"%ROWTYPE; c public."Competition"%ROWTYPE;
BEGIN
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 3 AND 60 OR p_max_teams IS NULL OR p_max_teams NOT BETWEEN 4 AND 20 OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{12,64}$' THEN RETURN jsonb_build_object('error','INVALID_CHAMPIONSHIP'); END IF;
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF u."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId"=u.id;
 IF v_club_id IS NULL THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF NOT g."isActive" OR g."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id AND role<>'MEMBER') THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO m FROM public."AllianceGroup" WHERE "groupId"=g.id;
 IF m.id IS NULL THEN RETURN jsonb_build_object('error','ALLIANCE_NOT_FOUND'); END IF;
 SELECT * INTO a FROM public."Alliance" WHERE id=m."allianceId" FOR UPDATE;
 IF a.status<>'ACTIVE' THEN RETURN jsonb_build_object('error','ALLIANCE_INACTIVE'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('alliance-championship-create:'||p_idempotency_key,0));
 SELECT * INTO old FROM public."Competition" WHERE "idempotencyKey"=p_idempotency_key;
 IF old.id IS NOT NULL THEN
  IF old."allianceId"<>a.id OR old."createdByClubId"<>v_club_id OR old.name<>btrim(p_name) OR old."maxTeams"<>p_max_teams OR old.format::text<>'LEAGUE' THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN jsonb_build_object('competition',to_jsonb(old),'replayed',true);
 END IF;
 SELECT * INTO s FROM public."AllianceSeason" WHERE "allianceId"=a.id AND status='ACTIVE' ORDER BY number DESC LIMIT 1 FOR UPDATE;
 IF s.id IS NULL THEN RETURN jsonb_build_object('error','SEASON_REVIEW_REQUIRED'); END IF;
 INSERT INTO public."Competition"(id,"idempotencyKey",name,season,format,status,"maxTeams","cupLegs","createdByClubId","allianceId","allianceSeasonId","createdAt","updatedAt")
 VALUES('competition_'||replace(gen_random_uuid()::text,'-',''),p_idempotency_key,btrim(p_name),s.number,'LEAGUE','REGISTRATION',p_max_teams,1,v_club_id,a.id,s.id,now(),now()) RETURNING * INTO c;
 INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId","joinedAt") VALUES('competition_entry_'||replace(gen_random_uuid()::text,'-',''),c.id,v_club_id,now());
 INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt") VALUES(gen_random_uuid()::text,a.id,p_telegram_user_id,p_telegram_group_id,'CHAMPIONSHIP_CREATED',jsonb_build_object('competitionId',c.id,'name',c.name,'maxTeams',c."maxTeams"),now());
 RETURN jsonb_build_object('competition',to_jsonb(c),'replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.join_alliance_championship_http(p_telegram_user_id text,p_telegram_group_id text,p_competition_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; m public."AllianceGroup"%ROWTYPE; c public."Competition"%ROWTYPE; v_club_id text; n integer;
BEGIN
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId"=u.id;
 IF v_club_id IS NULL THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF NOT g."isActive" OR g."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id) THEN RETURN jsonb_build_object('error','NOT_GROUP_MEMBER'); END IF;
 SELECT * INTO m FROM public."AllianceGroup" WHERE "groupId"=g.id;
 IF m.id IS NULL THEN RETURN jsonb_build_object('error','ALLIANCE_NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('competition-lifecycle:'||p_competition_id,0));
 SELECT * INTO c FROM public."Competition" WHERE id=p_competition_id AND "allianceId"=m."allianceId" FOR UPDATE;
 IF c.id IS NULL THEN RETURN jsonb_build_object('error','COMPETITION_NOT_FOUND'); END IF;
 SELECT count(*) INTO n FROM public."CompetitionEntry" WHERE "competitionId"=c.id;
 IF EXISTS(SELECT 1 FROM public."CompetitionEntry" WHERE "competitionId"=c.id AND "clubId"=v_club_id) THEN RETURN jsonb_build_object('joined',true,'replayed',true,'teams',n); END IF;
 IF c.status::text<>'REGISTRATION' THEN RETURN jsonb_build_object('error','COMPETITION_NOT_OPEN'); END IF;
 IF n>=c."maxTeams" THEN RETURN jsonb_build_object('error','COMPETITION_FULL'); END IF;
 INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId","joinedAt") VALUES('competition_entry_'||replace(gen_random_uuid()::text,'-',''),c.id,v_club_id,now());
 n:=n+1;
 INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt") VALUES(gen_random_uuid()::text,m."allianceId",p_telegram_user_id,p_telegram_group_id,'CHAMPIONSHIP_JOINED',jsonb_build_object('competitionId',c.id,'clubId',v_club_id),now());
 RETURN jsonb_build_object('joined',true,'replayed',false,'teams',n);
END $$;

CREATE OR REPLACE FUNCTION public.start_alliance_championship_http(p_telegram_user_id text,p_telegram_group_id text,p_competition_id text,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; m public."AllianceGroup"%ROWTYPE; c public."Competition"%ROWTYPE; v_club_id text; result jsonb;
BEGIN
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId"=u.id;
 IF v_club_id IS NULL THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF NOT g."isActive" OR g."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id AND role<>'MEMBER') THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO m FROM public."AllianceGroup" WHERE "groupId"=g.id;
 IF m.id IS NULL THEN RETURN jsonb_build_object('error','ALLIANCE_NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('competition-lifecycle:'||p_competition_id,0));
 SELECT * INTO c FROM public."Competition" WHERE id=p_competition_id AND "allianceId"=m."allianceId" FOR UPDATE;
 IF c.id IS NULL THEN RETURN jsonb_build_object('error','COMPETITION_NOT_FOUND'); END IF;
 IF c."createdByClubId"<>v_club_id THEN RETURN jsonb_build_object('error','ONLY_CREATOR_CAN_START'); END IF;
 result:=public.start_competition_http(u.id,c.id,coalesce(p_now,now()));
 IF coalesce((result->>'replayed')::boolean,false)=false THEN
  INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt") VALUES(gen_random_uuid()::text,m."allianceId",p_telegram_user_id,p_telegram_group_id,'CHAMPIONSHIP_STARTED',jsonb_build_object('competitionId',c.id,'fixturesCreated',result->'fixturesCreated','rounds',result->'rounds'),now());
 END IF;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.create_alliance_championship_http(text,text,text,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.join_alliance_championship_http(text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.start_alliance_championship_http(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_alliance_championship_http(text,text,text,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_alliance_championship_http(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_alliance_championship_http(text,text,text,timestamptz) TO service_role;
