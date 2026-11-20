-- Read-only pyramid league overview over direct Supabase RPC.
CREATE OR REPLACE FUNCTION public.get_pyramid_league_overview_http(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_club public."Club"%ROWTYPE;
  v_season integer;
  v_tiers jsonb:='[]'::jsonb;
  v_history jsonb;
  v_offers jsonb;
  v_current_league_id text;
  v_waiting integer;
  v_leagues jsonb;
  v_applications jsonb;
  v_tier integer;
  v_level_name text;
  v_level_key text;
  v_my_application text;
BEGIN
  IF COALESCE(btrim(p_user_id),'')='' THEN
    RAISE EXCEPTION USING MESSAGE='CLUB_NOT_FOUND',ERRCODE='P0001';
  END IF;
  SELECT * INTO v_club FROM public."Club" WHERE "ownerId"=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='CLUB_NOT_FOUND',ERRCODE='P0001'; END IF;
  v_season:=EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))::integer+1;

  FOR v_tier IN 1..7 LOOP
    v_level_name:=public.pyramid_tier_name_http(v_tier);
    v_level_key:=CASE v_tier WHEN 1 THEN 'BASE' WHEN 2 THEN 'AMATEUR' WHEN 3 THEN 'REGIONAL'
      WHEN 4 THEN 'SEMI_PRO' WHEN 5 THEN 'PRO' WHEN 6 THEN 'ELITE' ELSE 'CHAMPIONS' END;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',l.id,'competitionId',c.id,'name',c.name,'status',c.status::text,
      'startsAt',CASE WHEN c."startsAt" IS NULL THEN NULL ELSE to_char(c."startsAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,'teams',COALESCE(ec.team_count,0),
      'clubs',COALESCE(ec.clubs,'[]'::jsonb),'isMyLeague',COALESCE(ec.is_mine,false)
    ) ORDER BY l."groupNumber"),'[]'::jsonb)
    INTO v_leagues
    FROM public."PyramidLeague" l
    JOIN public."Competition" c ON c.id=l."competitionId"
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS team_count,
        COALESCE(jsonb_agg(cl.name ORDER BY cl.name),'[]'::jsonb) AS clubs,
        bool_or(e."clubId"=v_club.id) AS is_mine
      FROM public."PyramidLeagueEntry" e
      JOIN public."Club" cl ON cl.id=e."clubId"
      WHERE e."leagueId"=l.id
    ) ec ON true
    WHERE l.tier=v_tier AND l.season=v_season;
    SELECT count(*)::integer INTO v_waiting
    FROM public."PyramidLeagueApplication"
    WHERE tier=v_tier AND season=v_season AND status::text='QUEUED';
    SELECT status::text INTO v_my_application
    FROM public."PyramidLeagueApplication"
    WHERE "clubId"=v_club.id AND tier=v_tier AND season=v_season
    ORDER BY "appliedAt" DESC LIMIT 1;
    v_tiers:=v_tiers||jsonb_build_array(jsonb_build_object(
      'tier',v_tier,'key',v_level_key,'name',v_level_name,
      'waitingTeams',v_waiting,'leagues',v_leagues,'myApplication',v_my_application
    ));
  END LOOP;

  SELECT e."leagueId" INTO v_current_league_id
  FROM public."PyramidLeagueEntry" e
  JOIN public."PyramidLeague" l ON l.id=e."leagueId"
  WHERE e."clubId"=v_club.id AND l.season=v_season
  ORDER BY e."joinedAt" DESC LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',o.id,'fromTier',l.tier,'targetTier',o."targetTier",
    'season',l.season,'finalPosition',o."finalPosition"
  ) ORDER BY o."offeredAt" DESC),'[]'::jsonb)
  INTO v_offers
  FROM public."LeaguePromotionOffer" o
  JOIN public."PyramidLeague" l ON l.id=o."leagueId"
  WHERE o."clubId"=v_club.id AND o.status::text='PENDING';

  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.season DESC,x.tier,x.group_number),'[]'::jsonb)
  INTO v_history
  FROM (
    SELECT jsonb_build_object(
      'id',l.id,'tier',l.tier,'tierName',public.pyramid_tier_name_http(l.tier),
      'season',l.season,'groupNumber',l."groupNumber",'name',c.name,
      'status',c.status::text,'teams',COALESCE(ec.team_count,0)
    ) AS item,l.season,l.tier,l."groupNumber" AS group_number
    FROM public."PyramidLeague" l
    JOIN public."Competition" c ON c.id=l."competitionId"
    LEFT JOIN LATERAL (SELECT count(*)::integer AS team_count FROM public."PyramidLeagueEntry" e WHERE e."leagueId"=l.id) ec ON true
    WHERE l.season<v_season
    ORDER BY l.season DESC,l.tier ASC,l."groupNumber" ASC
    LIMIT 100
  ) x;

  RETURN jsonb_build_object(
    'season',v_season,'tiers',v_tiers,'currentLeagueId',v_current_league_id,
    'promotionOffers',v_offers,'history',v_history
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_pyramid_league_overview_http(text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT EXECUTE ON FUNCTION public.get_pyramid_league_overview_http(text) TO service_role;
  END IF;
END;
$grant$;
