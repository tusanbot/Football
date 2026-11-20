-- Atomic Supabase HTTP operations for Telegram-group leagues.
-- Existing competition lifecycle RPCs are reused inside the same database transaction.
CREATE OR REPLACE FUNCTION public.create_group_league_http(
  p_telegram_user_id text, p_telegram_group_id text, p_name text,
  p_max_teams integer, p_idempotency_key text, p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user public."User"%ROWTYPE;
  v_group public."TelegramGroup"%ROWTYPE;
  v_club_id text;
  v_existing public."Competition"%ROWTYPE;
  v_comp public."Competition"%ROWTYPE;
  v_rules jsonb := '{"maxSubstitutions":5,"maxInPlayWindows":3,"injuriesEnabled":true,"injuryDurationDays":5,"redCardSuspensionMatches":1,"yellowCardsToSuspend":3,"yellowCardSuspensionMatches":1,"penaltiesOnDraw":false}'::jsonb;
BEGIN
  IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$'
    OR p_telegram_group_id IS NULL OR p_telegram_group_id !~ '^-?[0-9]{1,20}$'
    OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 3 AND 40
    OR p_max_teams IS NULL OR p_max_teams NOT BETWEEN 4 AND 10
    OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$'
    OR p_now IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='INVALID_GROUP_LEAGUE', ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('competition-create:' || p_idempotency_key, 0));
  SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='ACCOUNT_NOT_FOUND', ERRCODE='P0001'; END IF;
  IF v_user."isSuspended" THEN RAISE EXCEPTION USING MESSAGE='ACCOUNT_SUSPENDED', ERRCODE='P0001'; END IF;
  SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='GROUP_NOT_REGISTERED', ERRCODE='P0001'; END IF;
  IF v_user."isSuspended" THEN RAISE EXCEPTION USING MESSAGE='ACCOUNT_SUSPENDED', ERRCODE='P0001'; END IF;
  IF v_group."isSuspended" THEN RAISE EXCEPTION USING MESSAGE='GROUP_SUSPENDED', ERRCODE='P0001'; END IF;
  IF NOT v_group."isActive" THEN RAISE EXCEPTION USING MESSAGE='GROUP_INACTIVE', ERRCODE='P0001'; END IF;
  PERFORM 1 FROM public."GroupMembership" gm WHERE gm."groupId"=v_group.id AND gm."userId"=v_user.id AND gm.role IN ('OWNER'::"GroupRole",'ADMIN'::"GroupRole") FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='GROUP_MANAGER_REQUIRED', ERRCODE='P0001'; END IF;
  SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId"=v_user.id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE='CLUB_NOT_FOUND', ERRCODE='P0001'; END IF;

  SELECT * INTO v_existing FROM public."Competition" WHERE "idempotencyKey"=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing."groupId" IS DISTINCT FROM v_group.id OR v_existing."createdByClubId" IS DISTINCT FROM v_club_id
      OR v_existing.name IS DISTINCT FROM btrim(p_name) OR v_existing."maxTeams" IS DISTINCT FROM p_max_teams
      OR v_existing.format::text <> 'LEAGUE' THEN
      RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_CONFLICT', ERRCODE='P0001';
    END IF;
    RETURN jsonb_build_object('competition',to_jsonb(v_existing),'replayed',true);
  END IF;

  INSERT INTO public."Competition"(
    id,"idempotencyKey",name,season,format,status,"maxTeams","cupLegs",rules,
    "createdByClubId","groupId","createdAt","updatedAt"
  ) VALUES (
    'competition_' || replace(gen_random_uuid()::text,'-',''),p_idempotency_key,btrim(p_name),
    extract(year FROM (p_now AT TIME ZONE 'UTC'))::integer,'LEAGUE'::"CompetitionFormat",
    'REGISTRATION'::"CompetitionStatus",p_max_teams,1,v_rules,v_club_id,v_group.id,
    p_now AT TIME ZONE 'UTC',p_now AT TIME ZONE 'UTC'
  ) RETURNING * INTO v_comp;

  INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId","joinedAt")
  VALUES('competition_entry_' || replace(gen_random_uuid()::text,'-',''),v_comp.id,v_club_id,p_now AT TIME ZONE 'UTC');
  RETURN jsonb_build_object('competition',to_jsonb(v_comp),'replayed',false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.join_group_league_http(
  p_telegram_user_id text,p_telegram_group_id text,p_competition_id text,p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE; v_comp public."Competition"%ROWTYPE;
BEGIN
  IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$'
    OR p_telegram_group_id IS NULL OR p_telegram_group_id !~ '^-?[0-9]{1,20}$'
    OR p_competition_id IS NULL OR btrim(p_competition_id)='' OR p_now IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='INVALID_COMPETITION', ERRCODE='22023';
  END IF;
  SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='ACCOUNT_NOT_FOUND', ERRCODE='P0001'; END IF;
  IF v_user."isSuspended" THEN RAISE EXCEPTION USING MESSAGE='ACCOUNT_SUSPENDED', ERRCODE='P0001'; END IF;
  SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='GROUP_NOT_REGISTERED', ERRCODE='P0001'; END IF;
  IF v_group."isSuspended" THEN RAISE EXCEPTION USING MESSAGE='GROUP_SUSPENDED', ERRCODE='P0001'; END IF;
  IF NOT v_group."isActive" THEN RAISE EXCEPTION USING MESSAGE='GROUP_INACTIVE', ERRCODE='P0001'; END IF;
  PERFORM 1 FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='NOT_GROUP_MEMBER', ERRCODE='P0001'; END IF;
  SELECT * INTO v_comp FROM public."Competition" WHERE id=p_competition_id AND "groupId"=v_group.id;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='COMPETITION_NOT_FOUND', ERRCODE='P0001'; END IF;
  RETURN public.join_competition_http(v_user.id,p_competition_id,p_now);
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_group_league_http(
  p_telegram_user_id text,p_telegram_group_id text,p_competition_id text,p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE; v_comp public."Competition"%ROWTYPE; v_club_id text;
BEGIN
  IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$'
    OR p_telegram_group_id IS NULL OR p_telegram_group_id !~ '^-?[0-9]{1,20}$'
    OR p_competition_id IS NULL OR btrim(p_competition_id)='' OR p_now IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='INVALID_COMPETITION', ERRCODE='22023';
  END IF;
  SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='ACCOUNT_NOT_FOUND', ERRCODE='P0001'; END IF;
  IF v_user."isSuspended" THEN RAISE EXCEPTION USING MESSAGE='ACCOUNT_SUSPENDED', ERRCODE='P0001'; END IF;
  SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='GROUP_NOT_REGISTERED', ERRCODE='P0001'; END IF;
  IF v_group."isSuspended" THEN RAISE EXCEPTION USING MESSAGE='GROUP_SUSPENDED', ERRCODE='P0001'; END IF;
  IF NOT v_group."isActive" THEN RAISE EXCEPTION USING MESSAGE='GROUP_INACTIVE', ERRCODE='P0001'; END IF;
  PERFORM 1 FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id AND role IN ('OWNER'::"GroupRole",'ADMIN'::"GroupRole") FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='GROUP_MANAGER_REQUIRED', ERRCODE='P0001'; END IF;
  SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId"=v_user.id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE='CLUB_NOT_FOUND', ERRCODE='P0001'; END IF;
  SELECT * INTO v_comp FROM public."Competition" WHERE id=p_competition_id AND "groupId"=v_group.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='COMPETITION_NOT_FOUND', ERRCODE='P0001'; END IF;
  IF v_comp."createdByClubId" IS DISTINCT FROM v_club_id THEN RAISE EXCEPTION USING MESSAGE='ONLY_CREATOR_CAN_START', ERRCODE='P0001'; END IF;
  RETURN public.start_competition_http(v_user.id,p_competition_id,p_now);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_group_league_table_http(
  p_telegram_user_id text,p_telegram_group_id text,p_competition_id text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE; v_comp public."Competition"%ROWTYPE; v_result jsonb;
BEGIN
  IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$'
    OR p_telegram_group_id IS NULL OR p_telegram_group_id !~ '^-?[0-9]{1,20}$'
    OR p_competition_id IS NULL OR btrim(p_competition_id)='' THEN
    RAISE EXCEPTION USING MESSAGE='INVALID_COMPETITION', ERRCODE='22023';
  END IF;
  SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='ACCOUNT_NOT_FOUND', ERRCODE='P0001'; END IF;
  SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='GROUP_NOT_REGISTERED', ERRCODE='P0001'; END IF;
  IF v_user."isSuspended" THEN RAISE EXCEPTION USING MESSAGE='ACCOUNT_SUSPENDED', ERRCODE='P0001'; END IF;
  IF v_group."isSuspended" THEN RAISE EXCEPTION USING MESSAGE='GROUP_SUSPENDED', ERRCODE='P0001'; END IF;
  IF NOT v_group."isActive" THEN RAISE EXCEPTION USING MESSAGE='GROUP_INACTIVE', ERRCODE='P0001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id) THEN RAISE EXCEPTION USING MESSAGE='NOT_GROUP_MEMBER', ERRCODE='P0001'; END IF;
  SELECT * INTO v_comp FROM public."Competition" WHERE id=p_competition_id AND "groupId"=v_group.id;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='COMPETITION_NOT_FOUND', ERRCODE='P0001'; END IF;
  SELECT jsonb_build_object('competition',jsonb_build_object(
    'id',v_comp.id,'name',v_comp.name,'status',v_comp.status::text,
    'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'rank',ranked.rank,'club',ranked.club_name,'played',ranked.played,'won',ranked.won,
      'drawn',ranked.drawn,'lost',ranked.lost,'goalsFor',ranked.goals_for,
      'goalsAgainst',ranked.goals_against,'points',ranked.points
    ) ORDER BY ranked.rank) FROM (
      SELECT row_number() OVER(ORDER BY ce.points DESC,ce."goalsFor" DESC,ce."goalsAgainst" ASC,cl.name ASC)::integer AS rank,
        cl.name AS club_name,ce.played,ce.won,ce.drawn,ce.lost,ce."goalsFor" AS goals_for,
        ce."goalsAgainst" AS goals_against,ce.points
      FROM public."CompetitionEntry" ce JOIN public."Club" cl ON cl.id=ce."clubId"
      WHERE ce."competitionId"=v_comp.id
    ) ranked),'[]'::jsonb)
  )) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_group_leagues_http(
  p_telegram_user_id text,p_telegram_group_id text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE; v_club_id text; v_result jsonb;
BEGIN
  IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$'
    OR p_telegram_group_id IS NULL OR p_telegram_group_id !~ '^-?[0-9]{1,20}$' THEN
    RAISE EXCEPTION USING MESSAGE='INVALID_GROUP_ACTOR_LOOKUP', ERRCODE='22023';
  END IF;
  SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='ACCOUNT_NOT_FOUND', ERRCODE='P0001'; END IF;
  SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='GROUP_NOT_REGISTERED', ERRCODE='P0001'; END IF;
  IF v_group."isSuspended" THEN RAISE EXCEPTION USING MESSAGE='GROUP_SUSPENDED', ERRCODE='P0001'; END IF;
  IF NOT v_group."isActive" THEN RAISE EXCEPTION USING MESSAGE='GROUP_INACTIVE', ERRCODE='P0001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id) THEN RAISE EXCEPTION USING MESSAGE='NOT_GROUP_MEMBER', ERRCODE='P0001'; END IF;
  SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId"=v_user.id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE='CLUB_NOT_FOUND', ERRCODE='P0001'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.name,'status',c.status::text,'maxTeams',c."maxTeams",
    'teams',counts.team_count,
    'joined',EXISTS(SELECT 1 FROM public."CompetitionEntry" mine WHERE mine."competitionId"=c.id AND mine."clubId"=v_club_id),
    'createdByMe',c."createdByClubId"=v_club_id
  ) ORDER BY c."createdAt" DESC),'[]'::jsonb)
  INTO v_result
  FROM (SELECT * FROM public."Competition" WHERE "groupId"=v_group.id ORDER BY "createdAt" DESC LIMIT 30) c
  CROSS JOIN LATERAL (SELECT count(*)::integer AS team_count FROM public."CompetitionEntry" ce WHERE ce."competitionId"=c.id) counts;
  RETURN jsonb_build_object('leagues',v_result);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_group_league_http(text,text,text,integer,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.join_group_league_http(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.start_group_league_http(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_group_league_table_http(text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_group_leagues_http(text,text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_group_league_http(text,text,text,integer,text,timestamptz) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.join_group_league_http(text,text,text,timestamptz) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.start_group_league_http(text,text,text,timestamptz) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_group_league_table_http(text,text,text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.list_group_leagues_http(text,text) TO service_role';
  END IF;
END;
$grant$;
