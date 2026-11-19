CREATE OR REPLACE FUNCTION public.list_club_matches_http(p_user_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE v_club_id text; v_result jsonb;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN RAISE EXCEPTION USING MESSAGE = 'INVALID_USER', ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId" = p_user_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001'; END IF;
  SELECT jsonb_build_object(
    'clubId', v_club_id,
    'matches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'type', m.type::text, 'status', m.status::text, 'round', m.round, 'leg', m.leg,
        'tieId', m."tieId", 'rulesSnapshot', m."rulesSnapshot", 'simulationVersion', m."simulationVersion",
        'scheduledAt', to_char(m."scheduledAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'homeClubId', m."homeClubId", 'awayClubId', m."awayClubId",
        'homeClub', jsonb_build_object('id', hc.id, 'name', hc.name), 'awayClub', jsonb_build_object('id', ac.id, 'name', ac.name),
        'homeScore', m."homeScore", 'awayScore', m."awayScore", 'attendance', m.attendance,
        'ticketRevenue', m."ticketRevenue"::text, 'homePenalties', m."homePenalties", 'awayPenalties', m."awayPenalties",
        'winnerClubId', m."winnerClubId",
        'runtime', CASE WHEN rt.id IS NULL THEN NULL ELSE jsonb_build_object(
          'status', rt.status::text, 'currentMinute', rt."currentMinute",
          'nextActionAt', CASE WHEN rt."nextActionAt" IS NULL THEN NULL ELSE to_char(rt."nextActionAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'completedAt', CASE WHEN rt."completedAt" IS NULL THEN NULL ELSE to_char(rt."completedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'simulationState', rt."simulationState", 'kickoffSnapshot', rt."kickoffSnapshot"
        ) END,
        'checkpoints', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'checkpointKey', cp."checkpointKey", 'kind', cp.kind::text, 'minute', cp.minute, 'status', cp.status::text,
            'openedAt', to_char(cp."openedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'decisionDeadlineAt', to_char(cp."decisionDeadlineAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'nextSegmentAt', to_char(cp."nextSegmentAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'resolvedAt', CASE WHEN cp."resolvedAt" IS NULL THEN NULL ELSE to_char(cp."resolvedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
            'decisions', COALESCE((SELECT jsonb_agg(jsonb_build_object('clubId', d."clubId",
              'submittedAt', to_char(d."submittedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
              FROM public."MatchTacticalDecision" d WHERE d."checkpointId" = cp.id), '[]'::jsonb)
          ) ORDER BY cp.minute ASC)
          FROM public."MatchTacticalCheckpoint" cp WHERE cp."matchId" = m.id
        ), '[]'::jsonb),
        'events', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'minute', ev.minute, 'type', ev.type::text, 'teamId', ev."teamId", 'playerId', ev."playerId",
            'relatedPlayerId', ev."relatedPlayerId", 'detail', ev.detail,
            'playerName', COALESCE(p."firstName" || ' ' || p."lastName", 'Player'),
            'relatedPlayerName', CASE WHEN ev."relatedPlayerId" IS NULL THEN NULL ELSE rp."firstName" || ' ' || rp."lastName" END
          ) ORDER BY ev.sequence ASC)
          FROM public."MatchEvent" ev
          LEFT JOIN public."Player" p ON p.id = ev."playerId"
          LEFT JOIN public."Player" rp ON rp.id = ev."relatedPlayerId"
          WHERE ev."matchId" = m.id
        ), '[]'::jsonb)
      ) ORDER BY m."scheduledAt" DESC)
      FROM (SELECT * FROM public."FootballMatch"
        WHERE "homeClubId" = v_club_id OR "awayClubId" = v_club_id
        ORDER BY "scheduledAt" DESC LIMIT 50) m
      JOIN public."Club" hc ON hc.id = m."homeClubId"
      JOIN public."Club" ac ON ac.id = m."awayClubId"
      LEFT JOIN public."MatchRuntime" rt ON rt."matchId" = m.id
    ), '[]'::jsonb),
    'competitions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'season', c.season,
        'format', c.format::text, 'cupLegs', c."cupLegs", 'status', c.status::text) ORDER BY c."createdAt" DESC)
      FROM (SELECT c0.id FROM public."Competition" c0
        JOIN public."CompetitionEntry" ce ON ce."competitionId" = c0.id
        WHERE ce."clubId" = v_club_id ORDER BY c0."createdAt" DESC LIMIT 20) selected
      JOIN public."Competition" c ON c.id = selected.id
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_club_matches_http(text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.list_club_matches_http(text) TO service_role;
  END IF;
END;
$grant$;
