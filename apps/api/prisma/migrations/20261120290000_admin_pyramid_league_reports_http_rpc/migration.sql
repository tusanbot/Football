CREATE OR REPLACE FUNCTION public.get_admin_pyramid_league_reports_http(
 p_season integer DEFAULT NULL,p_tier integer DEFAULT NULL,p_query text DEFAULT NULL,p_audit_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_result jsonb;
BEGIN
 IF p_audit_limit IS NULL OR p_audit_limit<1 OR p_audit_limit>100 THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_AUDIT_LIMIT',ERRCODE='22023';
 END IF;
 p_query:=NULLIF(btrim(p_query),'');
 WITH filtered AS (
  SELECT l.id,l.tier,l.season,l."groupNumber",c.name,c.status::text status,c."completedAt",
   (SELECT count(*)::integer FROM public."FootballMatch" m WHERE m."competitionId"=c.id) match_count
  FROM public."PyramidLeague" l JOIN public."Competition" c ON c.id=l."competitionId"
  WHERE (p_season IS NULL OR l.season=p_season) AND (p_tier IS NULL OR l.tier=p_tier)
   AND (p_query IS NULL OR c.name ILIKE '%'||p_query||'%' OR EXISTS(
    SELECT 1 FROM public."PyramidLeagueEntry" e JOIN public."Club" cl ON cl.id=e."clubId"
    WHERE e."leagueId"=l.id AND cl.name ILIKE '%'||p_query||'%'))
  ORDER BY l.season DESC,l.tier,l."groupNumber" LIMIT 1000
 ), entries AS (
  SELECT e."leagueId",jsonb_agg(jsonb_build_object('clubId',e."clubId",'clubName',cl.name,'finalPosition',e."finalPosition") ORDER BY e."finalPosition" NULLS LAST,cl.name) rows
  FROM public."PyramidLeagueEntry" e JOIN filtered f ON f.id=e."leagueId"
  JOIN public."Club" cl ON cl.id=e."clubId" GROUP BY e."leagueId"
 ), awards AS (
  SELECT a."leagueId",jsonb_agg(jsonb_build_object('clubId',a."clubId",'clubName',cl.name,'placement',a.placement,'awardName',a."awardName") ORDER BY a.placement) rows
  FROM public."LeagueAward" a JOIN filtered f ON f.id=a."leagueId"
  JOIN public."Club" cl ON cl.id=a."clubId" GROUP BY a."leagueId"
 ), offers AS (
  SELECT o."leagueId",jsonb_agg(jsonb_build_object('clubId',o."clubId",'clubName',cl.name,'finalPosition',o."finalPosition",'targetTier',o."targetTier",'status',o.status::text) ORDER BY o."offeredAt") rows
  FROM public."LeaguePromotionOffer" o JOIN filtered f ON f.id=o."leagueId"
  JOIN public."Club" cl ON cl.id=o."clubId" GROUP BY o."leagueId"
 ), report_leagues AS (
  SELECT f.*,COALESCE(e.rows,'[]'::jsonb) entries,COALESCE(a.rows,'[]'::jsonb) awards,COALESCE(o.rows,'[]'::jsonb) offers
  FROM filtered f LEFT JOIN entries e ON e."leagueId"=f.id LEFT JOIN awards a ON a."leagueId"=f.id LEFT JOIN offers o ON o."leagueId"=f.id
 ), season_rows AS (
  SELECT season,count(*)::integer leagues,count(*) FILTER(WHERE status='COMPLETED')::integer completed,
   COALESCE(sum(jsonb_array_length(entries)) FILTER(WHERE status='COMPLETED'),0)::integer teams,
   COALESCE(sum(match_count) FILTER(WHERE status='COMPLETED'),0)::integer matches,
   COALESCE(sum(champions) FILTER(WHERE status='COMPLETED'),0)::integer champions,
   COALESCE(sum(promotions),0)::integer promotions,
   COALESCE(sum(relegations) FILTER(WHERE status='COMPLETED'),0)::integer relegations
  FROM (
   SELECT r.*,
    (SELECT count(*) FROM jsonb_array_elements(r.entries) x WHERE (x->>'finalPosition')::integer=1)::integer champions,
    (SELECT count(*) FROM jsonb_array_elements(r.offers) x WHERE x->>'status'='ACCEPTED')::integer promotions,
    (SELECT count(*) FROM jsonb_array_elements(r.entries) x WHERE r.tier>1 AND NULLIF(x->>'finalPosition','') IS NOT NULL AND (x->>'finalPosition')::integer>=7)::integer relegations
   FROM report_leagues r
  ) per_league GROUP BY season
 ), club_entries AS (
  SELECT (x->>'clubId') club_id,x->>'clubName' club_name,r.season,r.tier,r."groupNumber",r.status,
   NULLIF(x->>'finalPosition','')::integer final_position
  FROM report_leagues r CROSS JOIN LATERAL jsonb_array_elements(r.entries) x
 ), club_promotions AS (
  SELECT (x->>'clubId') club_id,x->>'clubName' club_name,count(*)::integer promotions
  FROM report_leagues r CROSS JOIN LATERAL jsonb_array_elements(r.offers) x
  WHERE x->>'status'='ACCEPTED' GROUP BY (x->>'clubId'),(x->>'clubName')
 ), club_rankings AS (
  SELECT ce.club_id,ce.club_name,
   count(*) FILTER(WHERE ce.status='COMPLETED' AND ce.final_position IS NOT NULL)::integer seasons,
   count(*) FILTER(WHERE ce.status='COMPLETED' AND ce.final_position=1)::integer championships,
   count(*) FILTER(WHERE ce.status='COMPLETED' AND ce.final_position<=3 AND ce.final_position IS NOT NULL)::integer podiums,
   COALESCE(cp.promotions,0)::integer promotions,
   count(*) FILTER(WHERE ce.status='COMPLETED' AND ce.tier>1 AND ce.final_position>=7)::integer relegations,
   count(*) FILTER(WHERE ce.status='COMPLETED' AND ce.final_position IS NOT NULL)::integer "leagueEntries"
  FROM club_entries ce LEFT JOIN club_promotions cp ON cp.club_id=ce.club_id
  GROUP BY ce.club_id,ce.club_name,cp.promotions
 ), movements AS (
  SELECT ce.club_id "clubId",ce.club_name "clubName",ce.season,ce.tier,ce."groupNumber",ce.final_position position,'RELEGATION' movement,NULL::text "offerStatus"
  FROM club_entries ce WHERE ce.status='COMPLETED' AND ce.tier>1 AND ce.final_position>=7
  UNION ALL
  SELECT (x->>'clubId'),x->>'clubName',r.season,r.tier,r."groupNumber",(x->>'finalPosition')::integer,'PROMOTION',x->>'status'
  FROM report_leagues r CROSS JOIN LATERAL jsonb_array_elements(r.offers) x WHERE x->>'status'='ACCEPTED'
 ), history AS (
  SELECT jsonb_agg(jsonb_build_object(
   'id',r.id,'name',r.name,'season',r.season,'tier',r.tier,'groupNumber',r."groupNumber",'status',r.status,
   'completedAt',r."completedAt",'champion',(SELECT x->>'clubName' FROM jsonb_array_elements(r.entries) x WHERE (x->>'finalPosition')::integer=1 LIMIT 1),
   'runnerUp',(SELECT x->>'clubName' FROM jsonb_array_elements(r.entries) x WHERE (x->>'finalPosition')::integer=2 LIMIT 1),
   'relegated',COALESCE((SELECT jsonb_agg(x->>'clubName') FROM jsonb_array_elements(r.entries) x WHERE r.tier>1 AND NULLIF(x->>'finalPosition','') IS NOT NULL AND (x->>'finalPosition')::integer>=7),'[]'::jsonb),
   'promotions',COALESCE((SELECT jsonb_agg(jsonb_build_object('clubName',x->>'clubName','position',(x->>'finalPosition')::integer,'targetTier',(x->>'targetTier')::integer,'status',x->>'status') ORDER BY (x->>'finalPosition')::integer) FROM jsonb_array_elements(r.offers) x),'[]'::jsonb),
   'awards',COALESCE((SELECT jsonb_agg(jsonb_build_object('clubName',x->>'clubName','placement',(x->>'placement')::integer,'awardName',x->>'awardName') ORDER BY (x->>'placement')::integer) FROM jsonb_array_elements(r.awards) x),'[]'::jsonb)
  ) ORDER BY r.season DESC,r.tier,r."groupNumber") value FROM report_leagues r
 ), audit AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'actorTelegramId',a."actorTelegramId",'action',a.action,
   'targetType',a."targetType",'targetId',a."targetId",'reason',a.reason,'createdAt',a."createdAt")
   ORDER BY a."createdAt" DESC),'[]'::jsonb) value
  FROM (SELECT * FROM public."AdminAuditLog"
   WHERE "targetType" IN ('pyramid-league','league-application','promotion-offer','league-award')
    AND (p_query IS NULL OR action ILIKE '%'||p_query||'%' OR "targetId" ILIKE '%'||p_query||'%' OR reason ILIKE '%'||p_query||'%')
   ORDER BY "createdAt" DESC LIMIT p_audit_limit) a
 ), app_counts AS (
  SELECT COALESCE(jsonb_object_agg(status,total),'{}'::jsonb) value FROM (
   SELECT status::text status,count(*)::integer total FROM public."PyramidLeagueApplication"
   WHERE (p_season IS NULL OR season=p_season) AND (p_tier IS NULL OR tier=p_tier) GROUP BY status
  ) x
 ), totals AS (
  SELECT count(*)::integer leagues,count(*) FILTER(WHERE status='COMPLETED')::integer "completedLeagues",
   (SELECT count(*)::integer FROM club_rankings) clubs,
   (SELECT count(DISTINCT season)::integer FROM report_leagues) seasons,
   (SELECT count(*)::integer FROM movements WHERE movement='PROMOTION') promotions,
   (SELECT count(*)::integer FROM movements WHERE movement='RELEGATION') relegations
  FROM report_leagues
 )
 SELECT jsonb_build_object(
  'totals',(SELECT to_jsonb(totals) FROM totals),
  'seasons',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY season DESC) FROM season_rows s),'[]'::jsonb),
  'clubRankings',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM (
    SELECT jsonb_build_object('clubId',club_id,'clubName',club_name,'seasons',seasons,'championships',championships,'podiums',podiums,'promotions',promotions,'relegations',relegations,'leagueEntries',"leagueEntries") value
    FROM club_rankings ORDER BY championships DESC,podiums DESC,promotions DESC,relegations,club_name LIMIT 50
   ) r),'[]'::jsonb),
  'movements',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY season DESC,tier,position) FROM (SELECT * FROM movements ORDER BY season DESC,tier,position LIMIT 200) m),'[]'::jsonb),
  'leagueHistory',COALESCE((SELECT value FROM history),'[]'::jsonb),
  'auditLogs',(SELECT value FROM audit),
  'applicationCounts',(SELECT value FROM app_counts)
 ) INTO v_result;
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_admin_pyramid_league_reports_http(integer,integer,text,integer) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.get_admin_pyramid_league_reports_http(integer,integer,text,integer) TO service_role;
 END IF;
END;
$grant$;
