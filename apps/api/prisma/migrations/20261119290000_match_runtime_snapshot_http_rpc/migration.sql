-- Read-only, service-role-only snapshot for the match runtime coordinator.
CREATE OR REPLACE FUNCTION public.get_match_runtime_snapshot_http(p_runtime_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_runtime public."MatchRuntime"%ROWTYPE;
  v_match public."FootballMatch"%ROWTYPE;
  v_home jsonb;
  v_away jsonb;
BEGIN
  IF COALESCE(btrim(p_runtime_id), '') = '' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_MATCH_RUNTIME_ID', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_runtime
  FROM public."MatchRuntime"
  WHERE id = p_runtime_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_match
  FROM public."FootballMatch"
  WHERE id = v_runtime."matchId";
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'id', c.id, 'ownerId', c."ownerId", 'name', c.name,
    'formation', c.formation, 'mentality', c.mentality, 'pressing', c.pressing,
    'tempo', c.tempo, 'passingStyle', c."passingStyle",
    'stadiumLevel', c."stadiumLevel", 'ticketPrice', c."ticketPrice"::text,
    'reputation', c.reputation, 'matchFallbackPlan', c."matchFallbackPlan",
    'owner', jsonb_build_object('id', u.id, 'telegramId', u."telegramId"),
    'coach', CASE WHEN co.id IS NULL THEN NULL ELSE jsonb_build_object('medicalSkill', co."medicalSkill") END,
    'players', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'firstName', p."firstName", 'lastName', p."lastName",
        'position', p.position::text, 'overall', p.overall, 'lineupSlot', p."lineupSlot",
        'morale', p.morale, 'fitness', p.fitness, 'attributes', p.attributes,
        'suspensionMatchesRemaining', p."suspensionMatchesRemaining", 'injuryUntil', p."injuryUntil"
      ) ORDER BY p."lineupSlot" ASC NULLS LAST, p.overall DESC)
      FROM public."Player" p
      WHERE p."clubId" = c.id AND p.status::text = 'ACTIVE'
    ), '[]'::jsonb)
  ) INTO v_home
  FROM public."Club" c
  JOIN public."User" u ON u.id = c."ownerId"
  LEFT JOIN public."Coach" co ON co."clubId" = c.id
  WHERE c.id = v_match."homeClubId";

  SELECT jsonb_build_object(
    'id', c.id, 'ownerId', c."ownerId", 'name', c.name,
    'formation', c.formation, 'mentality', c.mentality, 'pressing', c.pressing,
    'tempo', c.tempo, 'passingStyle', c."passingStyle",
    'stadiumLevel', c."stadiumLevel", 'ticketPrice', c."ticketPrice"::text,
    'reputation', c.reputation, 'matchFallbackPlan', c."matchFallbackPlan",
    'owner', jsonb_build_object('id', u.id, 'telegramId', u."telegramId"),
    'coach', CASE WHEN co.id IS NULL THEN NULL ELSE jsonb_build_object('medicalSkill', co."medicalSkill") END,
    'players', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'firstName', p."firstName", 'lastName', p."lastName",
        'position', p.position::text, 'overall', p.overall, 'lineupSlot', p."lineupSlot",
        'morale', p.morale, 'fitness', p.fitness, 'attributes', p.attributes,
        'suspensionMatchesRemaining', p."suspensionMatchesRemaining", 'injuryUntil', p."injuryUntil"
      ) ORDER BY p."lineupSlot" ASC NULLS LAST, p.overall DESC)
      FROM public."Player" p
      WHERE p."clubId" = c.id AND p.status::text = 'ACTIVE'
    ), '[]'::jsonb)
  ) INTO v_away
  FROM public."Club" c
  JOIN public."User" u ON u.id = c."ownerId"
  LEFT JOIN public."Coach" co ON co."clubId" = c.id
  WHERE c.id = v_match."awayClubId";

  IF v_home IS NULL OR v_away IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'MATCH_RUNTIME_CLUB_SNAPSHOT_MISSING', ERRCODE = 'P0001';
  END IF;

  RETURN to_jsonb(v_runtime) || jsonb_build_object(
    'match', to_jsonb(v_match) || jsonb_build_object('homeClub', v_home, 'awayClub', v_away)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_match_runtime_snapshot_http(text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.get_match_runtime_snapshot_http(text) TO service_role;
  END IF;
END
$grant$;
