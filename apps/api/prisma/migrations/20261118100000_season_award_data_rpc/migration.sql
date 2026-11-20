-- Server-only read repository for season awards. Keep award selection in TypeScript
-- so the existing position grouping, tie-breaks and locale-aware name ordering stay unchanged.
CREATE OR REPLACE FUNCTION public.get_season_award_data(p_season integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH performances AS (
    SELECT
      p.id AS player_id,
      concat_ws(' ', p."firstName", p."lastName") AS player_name,
      p.position::text AS player_position,
      c.name AS club_name,
      count(*)::integer AS appearances,
      coalesce(sum(pm.goals), 0)::integer AS goals,
      coalesce(sum(pm.assists), 0)::integer AS assists,
      coalesce(sum(pm."minutesPlayed"), 0)::integer AS minutes_played,
      round(coalesce(avg(pm.rating), 0)::numeric, 2) AS average_rating
    FROM "PlayerMatchPerformance" pm
    JOIN "FootballMatch" fm ON fm.id = pm."matchId"
      AND fm.status = 'COMPLETED'
    JOIN "Competition" comp ON comp.id = fm."competitionId"
      AND comp.season = p_season
    JOIN "Player" p ON p.id = pm."playerId"
    JOIN "Club" c ON c.id = p."clubId"
    WHERE pm."minutesPlayed" > 0
    GROUP BY p.id, p."firstName", p."lastName", p.position, c.name
  ),
  manual_awards AS (
    SELECT
      spa.id, spa."awardType", spa."awardName", spa.reason,
      p.id AS player_id,
      concat_ws(' ', p."firstName", p."lastName") AS player_name,
      p.position::text AS player_position,
      c.name AS club_name,
      spa."createdAt"
    FROM "SeasonPlayerAward" spa
    JOIN "Player" p ON p.id = spa."playerId"
    JOIN "Club" c ON c.id = p."clubId"
    WHERE spa.season = p_season
  )
  SELECT jsonb_build_object(
    'matches', (
      SELECT count(*)::integer FROM "FootballMatch" fm
      JOIN "Competition" comp ON comp.id = fm."competitionId"
      WHERE fm.status = 'COMPLETED' AND comp.season = p_season
    ),
    'records', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'playerId', player_id, 'playerName', player_name, 'position', player_position,
        'clubName', club_name, 'appearances', appearances, 'goals', goals,
        'assists', assists, 'minutesPlayed', minutes_played, 'averageRating', average_rating
      ) ORDER BY player_id)
      FROM performances
    ), '[]'::jsonb),
    'manualAwards', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'awardType', "awardType", 'awardName', "awardName", 'reason', reason,
        'playerId', player_id, 'playerName', player_name, 'position', player_position, 'clubName', club_name
      ) ORDER BY "awardType" ASC, "createdAt" ASC)
      FROM manual_awards
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_season_award_data(integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_season_award_data(integer) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_season_award_data(integer) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_season_award_data(integer) TO service_role';
  END IF;
END $$;
