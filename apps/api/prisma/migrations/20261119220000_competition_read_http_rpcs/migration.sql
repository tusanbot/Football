CREATE OR REPLACE FUNCTION public.list_open_competitions_http(p_user_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE v_club_id text; v_result jsonb;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN RAISE EXCEPTION USING MESSAGE = 'INVALID_USER', ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId" = p_user_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'season', c.season, 'format', c.format::text, 'cupLegs', c."cupLegs",
    'rules', c.rules, 'status', c.status::text, 'maxTeams', c."maxTeams",
    'teams', COALESCE(e.team_count, 0), 'joined', EXISTS (SELECT 1 FROM public."CompetitionEntry" mine WHERE mine."competitionId" = c.id AND mine."clubId" = v_club_id),
    'isCreator', c."createdByClubId" = v_club_id,
    'creator', COALESCE((SELECT creator_club.name FROM public."Club" creator_club WHERE creator_club.id = c."createdByClubId"), 'Club')
  ) ORDER BY c."createdAt" DESC), '[]'::jsonb)
  INTO v_result
  FROM (SELECT * FROM public."Competition" WHERE status::text = 'REGISTRATION' ORDER BY "createdAt" DESC LIMIT 30) c
  LEFT JOIN LATERAL (SELECT count(*)::integer AS team_count FROM public."CompetitionEntry" ce WHERE ce."competitionId" = c.id) e ON true;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_open_competitions_http(text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.list_open_competitions_http(text) TO service_role'; END IF;
END;
$grant$;

CREATE OR REPLACE FUNCTION public.get_competition_http(p_user_id text, p_competition_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE v_club_id text; v_comp public."Competition"%ROWTYPE; v_result jsonb;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' OR p_competition_id IS NULL OR btrim(p_competition_id) = '' THEN RAISE EXCEPTION USING MESSAGE = 'INVALID_COMPETITION', ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId" = p_user_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_comp FROM public."Competition" WHERE id = p_competition_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'COMPETITION_NOT_FOUND', ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."CompetitionEntry" WHERE "competitionId" = p_competition_id AND "clubId" = v_club_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'NOT_COMPETITION_MEMBER', ERRCODE = 'P0001';
  END IF;
  SELECT jsonb_build_object(
    'competition', jsonb_build_object('id', v_comp.id, 'name', v_comp.name, 'season', v_comp.season, 'format', v_comp.format::text,
      'cupLegs', v_comp."cupLegs", 'rules', v_comp.rules, 'status', v_comp.status::text,
      'startsAt', CASE WHEN v_comp."startsAt" IS NULL THEN NULL ELSE to_jsonb(v_comp."startsAt" AT TIME ZONE 'UTC') END),
    'standings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('position', ranked.position, 'clubId', ranked.club_id, 'clubName', ranked.club_name,
        'played', ranked.played, 'won', ranked.won, 'drawn', ranked.drawn, 'lost', ranked.lost,
        'goalsFor', ranked.goals_for, 'goalsAgainst', ranked.goals_against, 'goalDifference', ranked.goals_for-ranked.goals_against, 'points', ranked.points)
        ORDER BY ranked.position)
      FROM (SELECT row_number() OVER (ORDER BY ce.points DESC, ce."goalsFor"-ce."goalsAgainst" DESC, ce."goalsFor" DESC, cl.name ASC)::integer AS position,
        ce."clubId" AS club_id, cl.name AS club_name, ce.played, ce.won, ce.drawn, ce.lost, ce."goalsFor" AS goals_for,
        ce."goalsAgainst" AS goals_against, ce.points
        FROM public."CompetitionEntry" ce JOIN public."Club" AS cl ON cl.id = ce."clubId" WHERE ce."competitionId" = p_competition_id) ranked
    ), '[]'::jsonb),
    'matches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'round', m.round, 'leg', m.leg, 'tieId', m."tieId",
        'scheduledAt', to_jsonb(m."scheduledAt" AT TIME ZONE 'UTC'), 'status', m.status::text,
        'homeClub', jsonb_build_object('id', hc.id, 'name', hc.name), 'awayClub', jsonb_build_object('id', ac.id, 'name', ac.name),
        'homeScore', m."homeScore", 'awayScore', m."awayScore", 'aggregateHomeScore', CASE WHEN m."tieId" IS NOT NULL AND m.leg = 2 AND m."homeScore" IS NOT NULL AND m."awayScore" IS NOT NULL AND first_leg.id IS NOT NULL AND first_leg."homeScore" IS NOT NULL AND first_leg."awayScore" IS NOT NULL THEN m."homeScore" + first_leg."awayScore" ELSE NULL END,
        'aggregateAwayScore', CASE WHEN m."tieId" IS NOT NULL AND m.leg = 2 AND m."homeScore" IS NOT NULL AND m."awayScore" IS NOT NULL AND first_leg.id IS NOT NULL AND first_leg."homeScore" IS NOT NULL AND first_leg."awayScore" IS NOT NULL THEN m."awayScore" + first_leg."homeScore" ELSE NULL END,
        'rules', m."rulesSnapshot", 'type', m.type::text, 'homePenalties', m."homePenalties", 'awayPenalties', m."awayPenalties", 'winnerClubId', m."winnerClubId")
        ORDER BY m.round ASC NULLS LAST, m."scheduledAt" ASC)
      FROM public."FootballMatch" m JOIN public."Club" hc ON hc.id = m."homeClubId" JOIN public."Club" ac ON ac.id = m."awayClubId"
      LEFT JOIN public."FootballMatch" first_leg ON first_leg."tieId" = m."tieId" AND first_leg.leg = 1
      WHERE m."competitionId" = p_competition_id
    ), '[]'::jsonb),
    'nextRound', (SELECT min(m.round) FROM public."FootballMatch" m WHERE m."competitionId" = p_competition_id AND m.status::text <> 'COMPLETED' AND m.round IS NOT NULL),
    'nextRoundMatches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'round', m.round, 'scheduledAt', to_jsonb(m."scheduledAt" AT TIME ZONE 'UTC'),
        'status', m.status::text, 'homeClub', jsonb_build_object('id', hc.id, 'name', hc.name),
        'awayClub', jsonb_build_object('id', ac.id, 'name', ac.name), 'homeScore', m."homeScore", 'awayScore', m."awayScore')
        ORDER BY m."scheduledAt" ASC)
      FROM public."FootballMatch" m JOIN public."Club" hc ON hc.id = m."homeClubId" JOIN public."Club" ac ON ac.id = m."awayClubId"
      WHERE m."competitionId" = p_competition_id AND m.round = (SELECT min(n.round) FROM public."FootballMatch" n WHERE n."competitionId" = p_competition_id AND n.status::text <> 'COMPLETED' AND n.round IS NOT NULL)
    ), '[]'::jsonb),
    'topScorers', '[]'::jsonb
)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_competition_http(text, text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_competition_http(text, text) TO service_role'; END IF;
END;
$grant$;
