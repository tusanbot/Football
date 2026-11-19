-- Multi-alliance competitions: each alliance keeps its own season and treasury.
CREATE TABLE public."AllianceCompetition" (
 id text PRIMARY KEY,
 "competitionId" text NOT NULL UNIQUE REFERENCES public."Competition"(id) ON DELETE CASCADE,
 "hostAllianceId" text NOT NULL REFERENCES public."Alliance"(id) ON DELETE RESTRICT,
 "createdAt" timestamp(3) NOT NULL DEFAULT now(),
 "startedAt" timestamp(3),
 "completedAt" timestamp(3)
);
CREATE INDEX "AllianceCompetition_hostAllianceId_idx" ON public."AllianceCompetition"("hostAllianceId");

CREATE TABLE public."AllianceCompetitionParticipant" (
 id text PRIMARY KEY,
 "allianceCompetitionId" text NOT NULL REFERENCES public."AllianceCompetition"(id) ON DELETE CASCADE,
 "allianceId" text NOT NULL REFERENCES public."Alliance"(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED','ACCEPTED','DECLINED','WITHDRAWN')),
 "seasonId" text REFERENCES public."AllianceSeason"(id) ON DELETE RESTRICT,
 "invitedByGroupId" text REFERENCES public."TelegramGroup"(id) ON DELETE SET NULL,
 "invitedAt" timestamp(3) NOT NULL DEFAULT now(),
 "respondedAt" timestamp(3),
 "createdAt" timestamp(3) NOT NULL DEFAULT now(),
 CONSTRAINT "AllianceCompetitionParticipant_competition_alliance_key" UNIQUE ("allianceCompetitionId","allianceId")
);
CREATE INDEX "AllianceCompetitionParticipant_alliance_status_idx" ON public."AllianceCompetitionParticipant"("allianceId",status);
CREATE INDEX "AllianceCompetitionParticipant_seasonId_idx" ON public."AllianceCompetitionParticipant"("seasonId");

CREATE OR REPLACE FUNCTION public.create_cross_alliance_competition_http(
 p_telegram_user_id text,p_telegram_group_id text,p_name text,p_max_teams integer,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; ag public."AllianceGroup"%ROWTYPE;
 a public."Alliance"%ROWTYPE; s public."AllianceSeason"%ROWTYPE; c public."Competition"%ROWTYPE;
 ac_id text; club_id text; old public."Competition"%ROWTYPE;
BEGIN
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 3 AND 60 OR p_max_teams IS NULL OR p_max_teams NOT BETWEEN 4 AND 20
  OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{12,64}$' THEN RETURN jsonb_build_object('error','INVALID_CHAMPIONSHIP'); END IF;
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF u."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 SELECT id INTO club_id FROM public."Club" WHERE "ownerId"=u.id;
 IF club_id IS NULL THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL OR NOT g."isActive" OR g."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id AND role<>'MEMBER') THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO ag FROM public."AllianceGroup" WHERE "groupId"=g.id;
 IF ag.id IS NULL OR ag.role<>'FOUNDER' THEN RETURN jsonb_build_object('error','ALLIANCE_FOUNDER_REQUIRED'); END IF;
 SELECT * INTO a FROM public."Alliance" WHERE id=ag."allianceId" FOR UPDATE;
 IF a.status<>'ACTIVE' THEN RETURN jsonb_build_object('error','ALLIANCE_INACTIVE'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cross-alliance-create:'||p_idempotency_key,0));
 SELECT * INTO old FROM public."Competition" WHERE "idempotencyKey"=p_idempotency_key;
 IF old.id IS NOT NULL THEN
  IF old."createdByClubId"<>club_id OR old.name<>btrim(p_name) OR old."maxTeams"<>p_max_teams
   OR NOT EXISTS(SELECT 1 FROM public."AllianceCompetition" WHERE "competitionId"=old.id AND "hostAllianceId"=a.id)
  THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN jsonb_build_object('competition',to_jsonb(old),'replayed',true);
 END IF;
 SELECT * INTO s FROM public."AllianceSeason" WHERE "allianceId"=a.id AND status='ACTIVE' AND "endsAt">now() ORDER BY number DESC LIMIT 1 FOR UPDATE;
 IF s.id IS NULL THEN RETURN jsonb_build_object('error','SEASON_REVIEW_REQUIRED'); END IF;
 INSERT INTO public."Competition"(id,"idempotencyKey",name,season,format,status,"maxTeams","cupLegs","createdByClubId","createdAt","updatedAt")
 VALUES('competition_'||replace(gen_random_uuid()::text,'-',''),p_idempotency_key,btrim(p_name),s.number,'LEAGUE','REGISTRATION',p_max_teams,1,club_id,now(),now()) RETURNING * INTO c;
 ac_id:='alliance_competition_'||replace(gen_random_uuid()::text,'-','');
 INSERT INTO public."AllianceCompetition"(id,"competitionId","hostAllianceId","createdAt") VALUES(ac_id,c.id,a.id,now());
 INSERT INTO public."AllianceCompetitionParticipant"(id,"allianceCompetitionId","allianceId",status,"seasonId","invitedByGroupId","respondedAt")
 VALUES(gen_random_uuid()::text,ac_id,a.id,'ACCEPTED',s.id,g.id,now());
 INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId","allianceGroupId","joinedAt")
 VALUES('competition_entry_'||replace(gen_random_uuid()::text,'-',''),c.id,club_id,ag.id,now());
 INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt")
 VALUES(gen_random_uuid()::text,a.id,p_telegram_user_id,p_telegram_group_id,'CROSS_ALLIANCE_COMPETITION_CREATED',jsonb_build_object('competitionId',c.id),now());
 RETURN jsonb_build_object('competition',to_jsonb(c),'allianceCompetitionId',ac_id,'replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.invite_cross_alliance_competition_http(
 p_telegram_user_id text,p_telegram_group_id text,p_competition_id text,p_target_alliance_slug text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; host public."AllianceGroup"%ROWTYPE;
 target public."Alliance"%ROWTYPE; ac public."AllianceCompetition"%ROWTYPE; c public."Competition"%ROWTYPE;
 season_id text; item public."AllianceCompetitionParticipant"%ROWTYPE;
BEGIN
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL OR NOT g."isActive" OR g."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id AND role<>'MEMBER') THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO host FROM public."AllianceGroup" WHERE "groupId"=g.id;
 IF host.id IS NULL OR host.role<>'FOUNDER' THEN RETURN jsonb_build_object('error','ALLIANCE_FOUNDER_REQUIRED'); END IF;
 SELECT * INTO ac FROM public."AllianceCompetition" WHERE "competitionId"=p_competition_id FOR UPDATE;
 SELECT * INTO c FROM public."Competition" WHERE id=p_competition_id;
 IF ac.id IS NULL OR c.status::text<>'REGISTRATION' OR ac."hostAllianceId"<>host."allianceId" THEN RETURN jsonb_build_object('error','COMPETITION_NOT_FOUND'); END IF;
 SELECT * INTO target FROM public."Alliance" WHERE slug=p_target_alliance_slug AND status='ACTIVE';
 IF target.id IS NULL THEN RETURN jsonb_build_object('error','TARGET_ALLIANCE_NOT_FOUND'); END IF;
 IF target.id=host."allianceId" THEN RETURN jsonb_build_object('error','CANNOT_INVITE_SELF'); END IF;
 SELECT id INTO season_id FROM public."AllianceSeason" WHERE "allianceId"=target.id AND status='ACTIVE' AND "endsAt">now() ORDER BY number DESC LIMIT 1;
 IF season_id IS NULL THEN RETURN jsonb_build_object('error','TARGET_SEASON_UNAVAILABLE'); END IF;
 INSERT INTO public."AllianceCompetitionParticipant"(id,"allianceCompetitionId","allianceId",status,"seasonId","invitedByGroupId","invitedAt")
 VALUES(gen_random_uuid()::text,ac.id,target.id,'INVITED',NULL,g.id,now())
 ON CONFLICT ("allianceCompetitionId","allianceId") DO UPDATE SET status='INVITED',"seasonId"=NULL,"invitedByGroupId"=EXCLUDED."invitedByGroupId","invitedAt"=now(),"respondedAt"=NULL
 WHERE public."AllianceCompetitionParticipant".status IN ('DECLINED','WITHDRAWN')
 RETURNING * INTO item;
 IF item.id IS NULL THEN SELECT * INTO item FROM public."AllianceCompetitionParticipant" WHERE "allianceCompetitionId"=ac.id AND "allianceId"=target.id; END IF;
 INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt")
 VALUES(gen_random_uuid()::text,host."allianceId",p_telegram_user_id,p_telegram_group_id,'CROSS_ALLIANCE_COMPETITION_INVITED',jsonb_build_object('competitionId',c.id,'targetAllianceId',target.id),now());
 RETURN jsonb_build_object('participant',to_jsonb(item),'replayed',item.status='INVITED');
END $$;

CREATE OR REPLACE FUNCTION public.respond_cross_alliance_competition_invitation_http(
 p_telegram_user_id text,p_telegram_group_id text,p_competition_id text,p_accept boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; ag public."AllianceGroup"%ROWTYPE;
 ac public."AllianceCompetition"%ROWTYPE; c public."Competition"%ROWTYPE; p public."AllianceCompetitionParticipant"%ROWTYPE; s public."AllianceSeason"%ROWTYPE;
BEGIN
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL OR NOT g."isActive" OR g."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id AND role<>'MEMBER') THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO ag FROM public."AllianceGroup" WHERE "groupId"=g.id;
 IF ag.id IS NULL OR ag.role<>'FOUNDER' THEN RETURN jsonb_build_object('error','ALLIANCE_FOUNDER_REQUIRED'); END IF;
 SELECT * INTO ac FROM public."AllianceCompetition" WHERE "competitionId"=p_competition_id FOR UPDATE;
 SELECT * INTO c FROM public."Competition" WHERE id=p_competition_id;
 SELECT * INTO p FROM public."AllianceCompetitionParticipant" WHERE "allianceCompetitionId"=ac.id AND "allianceId"=ag."allianceId" FOR UPDATE;
 IF ac.id IS NULL OR p.id IS NULL OR p.status NOT IN ('INVITED','ACCEPTED') THEN RETURN jsonb_build_object('error','INVITATION_NOT_FOUND'); END IF;
 IF c.status::text<>'REGISTRATION' THEN RETURN jsonb_build_object('error','COMPETITION_NOT_OPEN'); END IF;
 IF p.status='ACCEPTED' THEN RETURN jsonb_build_object('accepted',true,'replayed',true); END IF;
 IF p_accept THEN
  SELECT * INTO s FROM public."AllianceSeason" WHERE "allianceId"=ag."allianceId" AND status='ACTIVE' AND "endsAt">now() ORDER BY number DESC LIMIT 1 FOR UPDATE;
  IF s.id IS NULL THEN RETURN jsonb_build_object('error','SEASON_REVIEW_REQUIRED'); END IF;
 END IF;
 UPDATE public."AllianceCompetitionParticipant" SET status=CASE WHEN p_accept THEN 'ACCEPTED' ELSE 'DECLINED' END,"respondedAt"=now()
 WHERE id=p.id;
 INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt")
 VALUES(gen_random_uuid()::text,ag."allianceId",p_telegram_user_id,p_telegram_group_id,CASE WHEN p_accept THEN 'CROSS_ALLIANCE_COMPETITION_ACCEPTED' ELSE 'CROSS_ALLIANCE_COMPETITION_DECLINED' END,jsonb_build_object('competitionId',c.id),now());
 RETURN jsonb_build_object('accepted',p_accept,'replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.join_cross_alliance_competition_http(
 p_telegram_user_id text,p_telegram_group_id text,p_competition_id text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; ag public."AllianceGroup"%ROWTYPE;
 ac public."AllianceCompetition"%ROWTYPE; c public."Competition"%ROWTYPE; club_id text; n integer;
BEGIN
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF u."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 SELECT id INTO club_id FROM public."Club" WHERE "ownerId"=u.id;
 IF club_id IS NULL THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL OR NOT g."isActive" OR g."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id) THEN RETURN jsonb_build_object('error','NOT_GROUP_MEMBER'); END IF;
 SELECT * INTO ag FROM public."AllianceGroup" WHERE "groupId"=g.id;
 IF ag.id IS NULL THEN RETURN jsonb_build_object('error','ALLIANCE_NOT_FOUND'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('competition-lifecycle:'||p_competition_id,0));
 SELECT * INTO ac FROM public."AllianceCompetition" WHERE "competitionId"=p_competition_id;
 SELECT * INTO c FROM public."Competition" WHERE id=p_competition_id FOR UPDATE;
 IF ac.id IS NULL OR c.id IS NULL THEN RETURN jsonb_build_object('error','COMPETITION_NOT_FOUND'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."AllianceCompetitionParticipant" WHERE "allianceCompetitionId"=ac.id AND "allianceId"=ag."allianceId" AND status='ACCEPTED') THEN RETURN jsonb_build_object('error','ALLIANCE_NOT_INVITED'); END IF;
 SELECT count(*) INTO n FROM public."CompetitionEntry" WHERE "competitionId"=c.id;
 IF EXISTS(SELECT 1 FROM public."CompetitionEntry" WHERE "competitionId"=c.id AND "clubId"=club_id) THEN RETURN jsonb_build_object('joined',true,'replayed',true,'teams',n); END IF;
 IF c.status::text<>'REGISTRATION' THEN RETURN jsonb_build_object('error','COMPETITION_NOT_OPEN'); END IF;
 IF n>=c."maxTeams" THEN RETURN jsonb_build_object('error','COMPETITION_FULL'); END IF;
 INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId","allianceGroupId","joinedAt")
 VALUES('competition_entry_'||replace(gen_random_uuid()::text,'-',''),c.id,club_id,ag.id,now());
 RETURN jsonb_build_object('joined',true,'replayed',false,'teams',n+1);
END $$;

CREATE OR REPLACE FUNCTION public.start_cross_alliance_competition_http(
 p_telegram_user_id text,p_telegram_group_id text,p_competition_id text,p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; ag public."AllianceGroup"%ROWTYPE;
 ac public."AllianceCompetition"%ROWTYPE; c public."Competition"%ROWTYPE; club_id text; n integer; v_alliance_count integer; p record; s record; result jsonb;
BEGIN
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 SELECT id INTO club_id FROM public."Club" WHERE "ownerId"=u.id;
 IF club_id IS NULL THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL OR NOT g."isActive" OR g."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id AND role<>'MEMBER') THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO ag FROM public."AllianceGroup" WHERE "groupId"=g.id;
 IF ag.id IS NULL OR ag.role<>'FOUNDER' THEN RETURN jsonb_build_object('error','ALLIANCE_FOUNDER_REQUIRED'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('competition-lifecycle:'||p_competition_id,0));
 SELECT * INTO ac FROM public."AllianceCompetition" WHERE "competitionId"=p_competition_id FOR UPDATE;
 SELECT * INTO c FROM public."Competition" WHERE id=p_competition_id FOR UPDATE;
 IF ac.id IS NULL OR c.id IS NULL OR ac."hostAllianceId"<>ag."allianceId" THEN RETURN jsonb_build_object('error','COMPETITION_NOT_FOUND'); END IF;
 IF c."createdByClubId"<>club_id THEN RETURN jsonb_build_object('error','ONLY_CREATOR_CAN_START'); END IF;
 IF c.status::text='ACTIVE' THEN RETURN jsonb_build_object('competitionId',c.id,'replayed',true); END IF;
 IF c.status::text<>'REGISTRATION' THEN RETURN jsonb_build_object('error','COMPETITION_NOT_OPEN'); END IF;
 SELECT count(*) INTO v_alliance_count FROM public."AllianceCompetitionParticipant" WHERE "allianceCompetitionId"=ac.id AND status='ACCEPTED';
 IF v_alliance_count<2 THEN RETURN jsonb_build_object('error','CROSS_ALLIANCE_NEEDS_TWO_ALLIANCES'); END IF;
 FOR p IN SELECT * FROM public."AllianceCompetitionParticipant" WHERE "allianceCompetitionId"=ac.id AND status='ACCEPTED' ORDER BY "allianceId" FOR UPDATE LOOP
  SELECT id INTO s FROM public."AllianceSeason" WHERE "allianceId"=p."allianceId" AND status='ACTIVE' AND "endsAt">coalesce(p_now,now()) ORDER BY number DESC LIMIT 1 FOR UPDATE;
  IF s.id IS NULL THEN RETURN jsonb_build_object('error','PARTICIPANT_SEASON_UNAVAILABLE'); END IF;
  UPDATE public."AllianceCompetitionParticipant" SET "seasonId"=s.id WHERE id=p.id;
 END LOOP;
 SELECT count(*) INTO n FROM public."CompetitionEntry" WHERE "competitionId"=c.id;
 IF n<>c."maxTeams" THEN RETURN jsonb_build_object('error','COMPETITION_WAITING_FOR_TEAMS','teams',n,'requiredTeams',c."maxTeams"); END IF;
 result:=public._start_competition_locked(c.id,coalesce(p_now,now()),false);
 UPDATE public."AllianceCompetition" SET "startedAt"=coalesce(p_now,now())::timestamp(3) WHERE id=ac.id;
 INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt")
 VALUES(gen_random_uuid()::text,ag."allianceId",p_telegram_user_id,p_telegram_group_id,'CROSS_ALLIANCE_COMPETITION_STARTED',jsonb_build_object('competitionId',c.id,'alliances',n),now());
 RETURN result||jsonb_build_object('competitionId',c.id,'allianceCount',v_alliance_count);
END $$;

CREATE OR REPLACE FUNCTION public.record_alliance_competition_match_points()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_alliance_id text; v_season_status text; v_season_starts timestamp without time zone; v_season_ends timestamp without time zone;
 v_home_points integer; v_away_points integer; v_entry record; v_key text; v_inserted integer; v_ac_id text;
BEGIN
 IF OLD.status::text='COMPLETED' OR NEW.status::text<>'COMPLETED' OR NEW."competitionId" IS NULL
  OR NEW."homeScore" IS NULL OR NEW."awayScore" IS NULL OR NEW."completedAt" IS NULL THEN RETURN NEW; END IF;
 SELECT id INTO v_ac_id FROM public."AllianceCompetition" WHERE "competitionId"=NEW."competitionId";
 v_home_points:=CASE WHEN NEW."homeScore">NEW."awayScore" THEN 3 WHEN NEW."homeScore"=NEW."awayScore" THEN 1 ELSE 0 END;
 v_away_points:=CASE WHEN NEW."awayScore">NEW."homeScore" THEN 3 WHEN NEW."awayScore"=NEW."homeScore" THEN 1 ELSE 0 END;
 IF v_ac_id IS NOT NULL THEN
  FOR v_entry IN
   SELECT ce."clubId" club_id,ag."groupId" group_id,cl."ownerId" user_id,
    CASE WHEN ce."clubId"=NEW."homeClubId" THEN v_home_points ELSE v_away_points END points,
    p."seasonId" season_id,s.status::text season_status,s."startsAt" season_starts,s."endsAt" season_ends
   FROM public."CompetitionEntry" ce JOIN public."Club" cl ON cl.id=ce."clubId"
   JOIN public."AllianceGroup" ag ON ag.id=ce."allianceGroupId"
   JOIN public."AllianceCompetitionParticipant" p ON p."allianceCompetitionId"=v_ac_id AND p."allianceId"=ag."allianceId" AND p.status='ACCEPTED'
   JOIN public."AllianceSeason" s ON s.id=p."seasonId" AND s."allianceId"=p."allianceId"
   WHERE ce."competitionId"=NEW."competitionId" AND ce."clubId" IN (NEW."homeClubId",NEW."awayClubId")
  LOOP
   IF v_entry.points>0 AND v_entry.season_status='ACTIVE' AND NEW."completedAt">=v_entry.season_starts AND NEW."completedAt"<v_entry.season_ends THEN
    v_key:='alliance-cross-match:'||NEW.id||':'||v_entry.club_id;
    INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt")
    VALUES(gen_random_uuid()::text,v_key,v_entry.group_id,v_entry.user_id,v_entry.points,'LEAGUE_REWARD','Cross-alliance competition match reward: '||NEW.id,NEW."completedAt")
    ON CONFLICT ("idempotencyKey") DO NOTHING;
    GET DIAGNOSTICS v_inserted=ROW_COUNT;
    IF v_inserted=1 THEN UPDATE public."TelegramGroup" SET points=points+v_entry.points WHERE id=v_entry.group_id; END IF;
   END IF;
  END LOOP;
  RETURN NEW;
 END IF;
 -- Preserve the original single-alliance championship behavior.
 SELECT cp."allianceId",s.status::text,s."startsAt",s."endsAt"
 INTO v_alliance_id,v_season_status,v_season_starts,v_season_ends
 FROM public."Competition" cp JOIN public."AllianceSeason" s ON s.id=cp."allianceSeasonId" AND s."allianceId"=cp."allianceId"
 WHERE cp.id=NEW."competitionId" AND cp."format"::text='LEAGUE' AND cp.status::text='ACTIVE';
 IF NOT FOUND OR v_alliance_id IS NULL OR v_season_status<>'ACTIVE' OR NEW."completedAt"<v_season_starts OR NEW."completedAt">=v_season_ends THEN RETURN NEW; END IF;
 FOR v_entry IN
  SELECT ce."clubId" club_id,ag."groupId" group_id,cl."ownerId" user_id,
   CASE WHEN ce."clubId"=NEW."homeClubId" THEN v_home_points ELSE v_away_points END points
  FROM public."CompetitionEntry" ce JOIN public."Club" cl ON cl.id=ce."clubId"
  JOIN public."AllianceGroup" ag ON ag.id=ce."allianceGroupId" AND ag."allianceId"=v_alliance_id
  WHERE ce."competitionId"=NEW."competitionId" AND ce."clubId" IN (NEW."homeClubId",NEW."awayClubId")
 LOOP
  IF v_entry.points>0 THEN
   v_key:='alliance-match:'||NEW.id||':'||v_entry.club_id;
   INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt")
   VALUES(gen_random_uuid()::text,v_key,v_entry.group_id,v_entry.user_id,v_entry.points,'LEAGUE_REWARD','Alliance competition match reward: '||NEW.id,NEW."completedAt")
   ON CONFLICT ("idempotencyKey") DO NOTHING;
   GET DIAGNOSTICS v_inserted=ROW_COUNT;
   IF v_inserted=1 THEN UPDATE public."TelegramGroup" SET points=points+v_entry.points WHERE id=v_entry.group_id; END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.create_cross_alliance_competition_http(text,text,text,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.invite_cross_alliance_competition_http(text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.respond_cross_alliance_competition_invitation_http(text,text,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.join_cross_alliance_competition_http(text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.start_cross_alliance_competition_http(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_cross_alliance_competition_http(text,text,text,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.invite_cross_alliance_competition_http(text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.respond_cross_alliance_competition_invitation_http(text,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_cross_alliance_competition_http(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_cross_alliance_competition_http(text,text,text,timestamptz) TO service_role;
