CREATE OR REPLACE FUNCTION public.get_pyramid_league_history_http(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_club public."Club"%ROWTYPE;
  v_stats jsonb;
  v_tiers jsonb;
  v_movements jsonb;
  v_leagues jsonb;
BEGIN
  SELECT * INTO v_club FROM public."Club" WHERE "ownerId"=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='CLUB_NOT_FOUND',ERRCODE='P0001'; END IF;

  WITH completed AS (
    SELECT e."leagueId",e."finalPosition",l.tier,l.season,l."groupNumber",c.name,c."completedAt"
    FROM public."PyramidLeagueEntry" e
    JOIN public."PyramidLeague" l ON l.id=e."leagueId"
    JOIN public."Competition" c ON c.id=l."competitionId"
    WHERE e."clubId"=v_club.id AND c.status::text='COMPLETED' AND e."finalPosition" IS NOT NULL
  )
  SELECT jsonb_build_object(
    'seasons',count(DISTINCT season),
    'appearances',count(*),
    'championships',count(*) FILTER(WHERE "finalPosition"=1),
    'podiums',count(*) FILTER(WHERE "finalPosition"<=3),
    'promotions',(SELECT count(*) FROM public."LeaguePromotionOffer" o JOIN public."PyramidLeague" l ON l.id=o."leagueId" WHERE o."clubId"=v_club.id AND o.status::text='ACCEPTED' AND l.id IN (SELECT "leagueId" FROM completed)),
    'relegations',count(*) FILTER(WHERE tier>1 AND "finalPosition">=7)
  ) INTO v_stats FROM completed;

  WITH completed AS (
    SELECT e."leagueId",e."finalPosition",l.tier,l.season
    FROM public."PyramidLeagueEntry" e JOIN public."PyramidLeague" l ON l.id=e."leagueId"
    JOIN public."Competition" c ON c.id=l."competitionId"
    WHERE e."clubId"=v_club.id AND c.status::text='COMPLETED' AND e."finalPosition" IS NOT NULL
  ), tier_rows AS (
    SELECT tier,count(*)::integer AS appearances,
      count(*) FILTER(WHERE "finalPosition"=1)::integer AS championships,
      count(*) FILTER(WHERE "finalPosition"<=3)::integer AS podiums,
      count(*) FILTER(WHERE tier>1 AND "finalPosition">=7)::integer AS relegations
    FROM completed GROUP BY tier
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tier',t.tier,'tierName',public.pyramid_tier_name_http(t.tier),
    'appearances',t.appearances,'championships',t.championships,'podiums',t.podiums,
    'promotions',(SELECT count(*)::integer FROM public."LeaguePromotionOffer" o JOIN public."PyramidLeague" l ON l.id=o."leagueId" WHERE o."clubId"=v_club.id AND o.status::text='ACCEPTED' AND l.tier=t.tier AND l.id IN (SELECT "leagueId" FROM completed)),
    'relegations',t.relegations
  ) ORDER BY t.tier),'[]'::jsonb) INTO v_tiers FROM tier_rows t;

  WITH completed AS (
    SELECT e."leagueId",e."finalPosition",l.tier,l.season
    FROM public."PyramidLeagueEntry" e JOIN public."PyramidLeague" l ON l.id=e."leagueId"
    JOIN public."Competition" c ON c.id=l."competitionId"
    WHERE e."clubId"=v_club.id AND c.status::text='COMPLETED' AND e."finalPosition" IS NOT NULL
  ), movements AS (
    SELECT l.season,l.tier,public.pyramid_tier_name_http(l.tier) AS "tierName",
      o."finalPosition" AS position,o."targetTier",'ACCEPTED'::text AS status,
      COALESCE(o."resolvedAt",o."offeredAt") AS movement_date,'PROMOTION'::text AS movement
    FROM public."LeaguePromotionOffer" o JOIN public."PyramidLeague" l ON l.id=o."leagueId"
    WHERE o."clubId"=v_club.id AND o.status::text='ACCEPTED'
    UNION ALL
    SELECT c.season,c.tier,public.pyramid_tier_name_http(c.tier),c."finalPosition",
      c.tier-1,'RELEGATED'::text,NULL::timestamptz,'RELEGATION'::text
    FROM completed c WHERE c.tier>1 AND c."finalPosition">=7
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'season',season,'tier',tier,'tierName',"tierName",'position',position,
    'targetTier',"targetTier",'status',status,
    'date',CASE WHEN movement_date IS NULL THEN NULL ELSE to_jsonb(to_char(movement_date,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END,
    'movement',movement
  ) ORDER BY season DESC,tier,position),'[]'::jsonb) INTO v_movements FROM movements;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',l.id,'name',c.name,'season',l.season,'tier',l.tier,
    'tierName',public.pyramid_tier_name_http(l.tier),'groupNumber',l."groupNumber",
    'finalPosition',e."finalPosition",'completedAt',CASE WHEN c."completedAt" IS NULL THEN NULL ELSE to_char(c."completedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'awards',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'placement',a.placement,'awardName',a."awardName",'awardType',a."awardType"
    ) ORDER BY a.placement) FROM public."LeagueAward" a WHERE a."leagueId"=l.id AND a."clubId"=v_club.id),'[]'::jsonb),
    'promotionOffers',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'targetTier',o."targetTier",'finalPosition',o."finalPosition",'status',o.status::text,
      'offeredAt',to_char(o."offeredAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'resolvedAt',CASE WHEN o."resolvedAt" IS NULL THEN NULL ELSE to_char(o."resolvedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
    ) ORDER BY o."offeredAt") FROM public."LeaguePromotionOffer" o WHERE o."leagueId"=l.id AND o."clubId"=v_club.id),'[]'::jsonb)
  ) ORDER BY l.season DESC,l.tier,l."groupNumber"),'[]'::jsonb)
  INTO v_leagues
  FROM public."PyramidLeagueEntry" e
  JOIN public."PyramidLeague" l ON l.id=e."leagueId"
  JOIN public."Competition" c ON c.id=l."competitionId"
  WHERE e."clubId"=v_club.id AND c.status::text='COMPLETED' AND e."finalPosition" IS NOT NULL;

  RETURN jsonb_build_object(
    'club',jsonb_build_object('id',v_club.id,'name',v_club.name),
    'stats',COALESCE(v_stats,'{"seasons":0,"appearances":0,"championships":0,"podiums":0,"promotions":0,"relegations":0}'::jsonb),
    'tiers',v_tiers,'movements',v_movements,'leagues',v_leagues
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_pyramid_league_history_http(text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.get_pyramid_league_history_http(text) TO service_role;
 END IF;
END;
$grant$;
