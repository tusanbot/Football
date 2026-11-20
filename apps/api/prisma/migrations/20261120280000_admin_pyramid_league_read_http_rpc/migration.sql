CREATE OR REPLACE FUNCTION public.get_admin_pyramid_leagues_http(
 p_season integer DEFAULT NULL,p_tier integer DEFAULT NULL,p_status text DEFAULT NULL,
 p_query text DEFAULT NULL,p_limit integer DEFAULT 60
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_leagues jsonb; v_queues jsonb; v_offers jsonb; v_counts jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_LIMIT',ERRCODE='22023';
 END IF;
 IF p_status IS NOT NULL AND p_status NOT IN ('DRAFT','REGISTRATION','ACTIVE','COMPLETED','CANCELLED') THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_STATUS',ERRCODE='22023';
 END IF;
 SELECT COALESCE(jsonb_agg(item ORDER BY item->>'season' DESC,(item->>'tier')::integer,(item->>'groupNumber')::integer),'[]'::jsonb)
 INTO v_leagues FROM (
  SELECT jsonb_build_object(
   'id',l.id,'competitionId',c.id,'tier',l.tier,'season',l.season,'groupNumber',l."groupNumber",
   'promotionProcessedAt',l."promotionProcessedAt",'name',c.name,'status',c.status::text,
   'startsAt',c."startsAt",'completedAt',c."completedAt",
   'matchCount',(SELECT count(*) FROM public."FootballMatch" m WHERE m."competitionId"=c.id),
   'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',cl.id,'name',cl.name,'ownerId',cl."ownerId",'finalPosition',le."finalPosition") ORDER BY cl.name)
    FROM public."PyramidLeagueEntry" le JOIN public."Club" cl ON cl.id=le."clubId" WHERE le."leagueId"=l.id),'[]'::jsonb),
   'standings',COALESCE((SELECT jsonb_agg(jsonb_build_object('position',s.position,'clubId',s."clubId",'clubName',s."clubName",'played',s.played,'won',s.won,'drawn',s.drawn,'lost',s.lost,'goalsFor',s."goalsFor",'goalsAgainst',s."goalsAgainst",'points',s.points) ORDER BY s.position)
    FROM (SELECT row_number() OVER(ORDER BY ce.points DESC,ce."goalsFor" DESC,ce."clubId")::integer position,ce."clubId",cl.name "clubName",ce.played,ce.won,ce.drawn,ce.lost,ce."goalsFor",ce."goalsAgainst",ce.points
     FROM public."CompetitionEntry" ce JOIN public."Club" cl ON cl.id=ce."clubId" WHERE ce."competitionId"=c.id) s),'[]'::jsonb),
   'awards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'placement',a.placement,'awardName',a."awardName",'awardType',a."awardType",'clubName',cl.name) ORDER BY a.placement)
    FROM public."LeagueAward" a JOIN public."Club" cl ON cl.id=a."clubId" WHERE a."leagueId"=l.id),'[]'::jsonb),
   'promotionOffers',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'clubId',o."clubId",'clubName',cl.name,'targetTier',o."targetTier",'finalPosition',o."finalPosition",'status',o.status::text,'expiresAt',o."expiresAt") ORDER BY o."offeredAt" DESC)
    FROM public."LeaguePromotionOffer" o JOIN public."Club" cl ON cl.id=o."clubId" WHERE o."leagueId"=l.id),'[]'::jsonb)
  ) item
  FROM public."PyramidLeague" l JOIN public."Competition" c ON c.id=l."competitionId"
  WHERE (p_season IS NULL OR l.season=p_season) AND (p_tier IS NULL OR l.tier=p_tier)
   AND (p_status IS NULL OR c.status::text=p_status)
   AND (p_query IS NULL OR c.name ILIKE '%'||p_query||'%')
  ORDER BY l.season DESC,l.tier,l."groupNumber" LIMIT p_limit
 ) rows;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'tier',a.tier,'season',a.season,'appliedAt',a."appliedAt",
  'club',jsonb_build_object('id',cl.id,'name',cl.name),
  'user',jsonb_build_object('displayName',u."displayName",'telegramId',u."telegramId")) ORDER BY a."appliedAt",a.id),'[]'::jsonb)
 INTO v_queues FROM public."PyramidLeagueApplication" a
 JOIN public."Club" cl ON cl.id=a."clubId" JOIN public."User" u ON u.id=a."userId"
 WHERE a.status::text='QUEUED' AND (p_season IS NULL OR a.season=p_season) AND (p_tier IS NULL OR a.tier=p_tier)
  AND (p_query IS NULL OR cl.name ILIKE '%'||p_query||'%')
 ORDER BY a."appliedAt",a.id LIMIT p_limit;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',o.id,'club',jsonb_build_object('id',cl.id,'name',cl.name),
  'tier',l.tier,'season',l.season,'groupNumber',l."groupNumber",'leagueName',c.name,
  'targetTier',o."targetTier",'finalPosition',o."finalPosition",'status',o.status::text,
  'offeredAt',o."offeredAt",'expiresAt',o."expiresAt") ORDER BY o."offeredAt" DESC),'[]'::jsonb)
 INTO v_offers FROM public."LeaguePromotionOffer" o
 JOIN public."Club" cl ON cl.id=o."clubId" JOIN public."PyramidLeague" l ON l.id=o."leagueId"
 JOIN public."Competition" c ON c.id=l."competitionId"
 WHERE (p_season IS NULL OR l.season=p_season) AND (p_tier IS NULL OR l.tier=p_tier)
  AND (p_query IS NULL OR cl.name ILIKE '%'||p_query||'%')
 ORDER BY o."offeredAt" DESC LIMIT p_limit;
 SELECT COALESCE(jsonb_object_agg(status,total),'{}'::jsonb) INTO v_counts FROM (
  SELECT status::text status,count(*)::integer total FROM public."PyramidLeagueApplication"
  WHERE (p_season IS NULL OR season=p_season) AND (p_tier IS NULL OR tier=p_tier) GROUP BY status
 ) counts;
 RETURN jsonb_build_object('leagues',v_leagues,'queues',v_queues,'offers',v_offers,'applicationCounts',v_counts);
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_admin_pyramid_leagues_http(integer,integer,text,text,integer) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.get_admin_pyramid_leagues_http(integer,integer,text,text,integer) TO service_role;
 END IF;
END;
$grant$;
