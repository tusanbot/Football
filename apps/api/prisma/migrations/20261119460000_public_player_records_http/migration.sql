CREATE OR REPLACE FUNCTION public.get_public_player_records_http(
  p_metric text,
  p_limit integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE result jsonb;
BEGIN
  IF p_metric IS NULL OR p_metric NOT IN ('goals','assists','appearances','rating')
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING MESSAGE='INVALID_PLAYER_RECORD_QUERY', ERRCODE='22023';
  END IF;

  WITH aggregates AS (
    SELECT
      pmp."playerId" AS player_id,
      count(*)::integer AS appearances,
      coalesce(sum(pmp.goals),0)::integer AS goals,
      coalesce(sum(pmp.assists),0)::integer AS assists,
      coalesce(sum(pmp."minutesPlayed"),0)::integer AS minutes_played,
      round(coalesce(avg(pmp.rating),0)::numeric,2) AS average_rating
    FROM public."PlayerMatchPerformance" pmp
    JOIN public."FootballMatch" fm ON fm.id=pmp."matchId" AND fm.status='COMPLETED'
    WHERE pmp."minutesPlayed" > 0
    GROUP BY pmp."playerId"
  ), records AS (
    SELECT
      p.id AS player_id,
      p."firstName" || ' ' || p."lastName" AS player_name,
      p.position::text AS position,
      p.overall,
      c.name AS club_name,
      a.appearances,a.goals,a.assists,a.minutes_played,a.average_rating,
      CASE p_metric
        WHEN 'goals' THEN a.goals::numeric
        WHEN 'assists' THEN a.assists::numeric
        WHEN 'appearances' THEN a.appearances::numeric
        ELSE a.average_rating
      END AS metric_value
    FROM aggregates a
    JOIN public."Player" p ON p.id=a.player_id
    JOIN public."Club" c ON c.id=p."clubId"
    WHERE (p_metric <> 'goals' OR a.goals > 0)
      AND (p_metric <> 'assists' OR a.assists > 0)
      AND (p_metric <> 'rating' OR a.appearances >= 3)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'playerId',player_id,'playerName',player_name,'position',position,
    'overall',overall,'clubName',club_name,'appearances',appearances,
    'goals',goals,'assists',assists,'minutesPlayed',minutes_played,
    'averageRating',average_rating,'value',metric_value
  ) ORDER BY metric_value DESC,appearances DESC,average_rating DESC,player_name ASC),'[]'::jsonb)
  INTO result
  FROM (SELECT * FROM records ORDER BY metric_value DESC,appearances DESC,average_rating DESC,player_name ASC LIMIT p_limit) ranked;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_player_records_http(text,integer) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_public_player_records_http(text,integer) TO service_role';
  END IF;
END;
$grant$;
