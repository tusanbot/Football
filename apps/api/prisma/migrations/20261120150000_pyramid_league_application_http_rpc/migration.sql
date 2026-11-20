CREATE OR REPLACE FUNCTION public.apply_pyramid_league_http(p_user_id text,p_tier integer,p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_club public."Club"%ROWTYPE;
  v_existing public."PyramidLeagueApplication"%ROWTYPE;
  v_application_id text;
  v_season integer;
  v_waiting integer;
  v_queue jsonb;
  v_players integer;
  v_has_goalkeeper boolean;
BEGIN
  IF COALESCE(btrim(p_user_id),'')='' OR p_now IS NULL OR p_tier<>1
     OR public.pyramid_tier_name_http(p_tier) IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='DIRECT_TIER_ENTRY_NOT_ALLOWED',ERRCODE='P0001';
  END IF;

  v_season:=EXTRACT(YEAR FROM (p_now AT TIME ZONE 'UTC'))::integer+1;
  SELECT * INTO v_club
  FROM public."Club"
  WHERE "ownerId"=p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='CLUB_NOT_FOUND',ERRCODE='P0001';
  END IF;

  SELECT count(*)::integer,COALESCE(bool_or(position::text='GK'),false)
  INTO v_players,v_has_goalkeeper
  FROM public."Player"
  WHERE "clubId"=v_club.id AND status::text='ACTIVE' AND "suspensionMatchesRemaining"=0;
  IF v_players<11 OR NOT v_has_goalkeeper THEN
    RAISE EXCEPTION USING MESSAGE='ALL_TEAMS_NEED_VALID_LINEUPS',ERRCODE='P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('pyramid-application:'||v_club.id||':1:'||v_season,0));
  SELECT * INTO v_existing
  FROM public."PyramidLeagueApplication"
  WHERE "clubId"=v_club.id AND tier=p_tier AND season=v_season
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.status::text='WITHDRAWN' THEN
      RAISE EXCEPTION USING MESSAGE='APPLICATION_ALREADY_WITHDRAWN',ERRCODE='P0001';
    END IF;
    SELECT count(*)::integer INTO v_waiting
    FROM public."PyramidLeagueApplication"
    WHERE tier=p_tier AND season=v_season AND status::text='QUEUED';
    RETURN jsonb_build_object(
      'applied',true,'replayed',true,'status',v_existing.status::text,
      'leagueId',v_existing."assignedLeagueId",'waitingTeams',v_waiting
    );
  END IF;

  IF EXISTS(
    SELECT 1
    FROM public."PyramidLeagueEntry" e
    JOIN public."PyramidLeague" l ON l.id=e."leagueId"
    JOIN public."Competition" c ON c.id=l."competitionId"
    WHERE e."clubId"=v_club.id AND c.status::text='ACTIVE'
  ) THEN
    RAISE EXCEPTION USING MESSAGE='CLUB_ALREADY_IN_ACTIVE_PYRAMID_LEAGUE',ERRCODE='P0001';
  END IF;

  v_application_id:='pyramid_application_'||replace(gen_random_uuid()::text,'-','');
  INSERT INTO public."PyramidLeagueApplication"(id,"userId","clubId",tier,season,status,"appliedAt")
  VALUES(v_application_id,p_user_id,v_club.id,p_tier,v_season,'QUEUED',(p_now AT TIME ZONE 'UTC'));

  v_queue:=public.assign_pyramid_queue_http(p_tier,v_season,p_now);
  IF COALESCE((v_queue->>'created')::boolean,false) THEN
    SELECT count(*)::integer INTO v_waiting
    FROM public."PyramidLeagueApplication"
    WHERE tier=p_tier AND season=v_season AND status::text='QUEUED';
    RETURN jsonb_build_object(
      'applied',true,'replayed',false,'status','ASSIGNED',
      'leagueId',v_queue->>'leagueId','tier',v_queue->'tier','tierName',public.pyramid_tier_name_http(p_tier),
      'season',v_season,'groupNumber',v_queue->'groupNumber','teams',v_queue->'teams',
      'fixturesCreated',v_queue->'fixturesCreated','competitionId',v_queue->>'competitionId',
      'waitingTeams',v_waiting
    );
  END IF;

  SELECT count(*)::integer INTO v_waiting
  FROM public."PyramidLeagueApplication"
  WHERE tier=p_tier AND season=v_season AND status::text='QUEUED';
  RETURN jsonb_build_object(
    'applied',true,'replayed',false,'status','QUEUED','leagueId',NULL,
    'waitingTeams',v_waiting,'requiredTeams',8
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.apply_pyramid_league_http(text,integer,timestamptz) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT EXECUTE ON FUNCTION public.pyramid_tier_name_http(integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.pyramid_tier_bps_http(integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.adjust_pyramid_club_values_http(text,integer,integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.assign_pyramid_queue_http(integer,integer,timestamptz) TO service_role;
    GRANT EXECUTE ON FUNCTION public.apply_pyramid_league_http(text,integer,timestamptz) TO service_role;
  END IF;
END;
$grant$;
