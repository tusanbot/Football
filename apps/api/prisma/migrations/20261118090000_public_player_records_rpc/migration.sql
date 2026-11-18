-- Read-only, server-side aggregate for the first Cloudflare -> Supabase HTTP route.
-- Qualify every output field because PL/pgSQL RETURNS TABLE names are variables.
CREATE OR REPLACE FUNCTION public.get_public_player_records(
  p_metric text DEFAULT 'goals',
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  rank integer,
  "playerId" text,
  "playerName" text,
  "position" text,
  overall integer,
  "clubName" text,
  appearances integer,
  goals integer,
  assists integer,
  "minutesPlayed" integer,
  "averageRating" numeric,
  value numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_metric NOT IN ('goals', 'assists', 'appearances', 'rating') THEN
    RAISE EXCEPTION 'Unsupported player record metric' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'Player record limit must be between 1 and 50' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH aggregated AS (
    SELECT
      p.id AS player_id,
      p."firstName" || ' ' || p."lastName" AS player_name,
      p.position::text AS player_position,
      p.overall AS player_overall,
      c.name AS club_name,
      count(*)::integer AS appearances,
      coalesce(sum(pm.goals), 0)::integer AS goals,
      coalesce(sum(pm.assists), 0)::integer AS assists,
      coalesce(sum(pm."minutesPlayed"), 0)::integer AS minutes_played,
      round(coalesce(avg(pm.rating), 0)::numeric, 2) AS average_rating
    FROM "PlayerMatchPerformance" pm
    JOIN "FootballMatch" fm ON fm.id = pm."matchId" AND fm.status = 'COMPLETED'
    JOIN "Player" p ON p.id = pm."playerId"
    JOIN "Club" c ON c.id = p."clubId"
    WHERE pm."minutesPlayed" > 0
      AND (p_metric <> 'goals' OR pm.goals > 0)
      AND (p_metric <> 'assists' OR pm.assists > 0)
    GROUP BY p.id, p."firstName", p."lastName", p.position, p.overall, c.name
    HAVING p_metric <> 'rating' OR count(*) >= 3
  ),
  valued AS (
    SELECT a.*,
      CASE p_metric
        WHEN 'goals' THEN a.goals::numeric
        WHEN 'assists' THEN a.assists::numeric
        WHEN 'appearances' THEN a.appearances::numeric
        ELSE a.average_rating
      END AS metric_value
    FROM aggregated a
  )
  SELECT
    row_number() OVER (ORDER BY v.metric_value DESC, v.appearances DESC, v.average_rating DESC, v.player_name ASC)::integer,
    v.player_id,
    v.player_name,
    v.player_position,
    v.player_overall,
    v.club_name,
    v.appearances,
    v.goals,
    v.assists,
    v.minutes_played,
    v.average_rating,
    v.metric_value
  FROM valued v
  ORDER BY v.metric_value DESC, v.appearances DESC, v.average_rating DESC, v.player_name ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_player_records(text, integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_public_player_records(text, integer) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_public_player_records(text, integer) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_public_player_records(text, integer) TO service_role';
  END IF;
END $$;
