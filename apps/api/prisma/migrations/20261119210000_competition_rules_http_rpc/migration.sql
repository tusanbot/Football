CREATE OR REPLACE FUNCTION public.update_competition_rules_http(p_user_id text, p_competition_id text, p_rules jsonb, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE v_club_id text; v_comp public."Competition"%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' OR p_competition_id IS NULL OR btrim(p_competition_id) = '' OR p_now IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'INVALID_COMPETITION', ERRCODE = 'P0001'; END IF;
  IF p_rules IS NULL OR jsonb_typeof(p_rules) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_rules->'maxSubstitutions') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_rules->'maxInPlayWindows') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_rules->'injuriesEnabled') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_rules->'injuryDurationDays') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_rules->'redCardSuspensionMatches') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_rules->'yellowCardsToSuspend') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_rules->'yellowCardSuspensionMatches') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_rules->'penaltiesOnDraw') IS DISTINCT FROM 'boolean'
    OR (p_rules->>'maxSubstitutions')::integer NOT BETWEEN 0 AND 5
    OR (p_rules->>'maxInPlayWindows')::integer NOT BETWEEN 0 AND 3
    OR (p_rules->>'injuryDurationDays')::integer NOT BETWEEN 1 AND 14
    OR (p_rules->>'redCardSuspensionMatches')::integer NOT BETWEEN 0 AND 5
    OR (p_rules->>'yellowCardsToSuspend')::integer NOT BETWEEN 0 AND 10
    OR (p_rules->>'yellowCardSuspensionMatches')::integer NOT BETWEEN 0 AND 5
    OR (p_rules->>'maxInPlayWindows')::integer > (p_rules->>'maxSubstitutions')::integer THEN RAISE EXCEPTION USING MESSAGE = 'INVALID_COMPETITION_RULES', ERRCODE = 'P0001'; END IF;
  SELECT c.id INTO v_club_id FROM public."Club" c WHERE c."ownerId" = p_user_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('competition-lifecycle:' || p_competition_id, 0));
  SELECT * INTO v_comp FROM public."Competition" WHERE id = p_competition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'COMPETITION_NOT_FOUND', ERRCODE = 'P0001'; END IF;
  IF v_comp."createdByClubId" <> v_club_id THEN RAISE EXCEPTION USING MESSAGE = 'ONLY_CREATOR_CAN_START', ERRCODE = 'P0001'; END IF;
  IF v_comp.status::text <> 'REGISTRATION' THEN RAISE EXCEPTION USING MESSAGE = 'COMPETITION_RULES_LOCKED', ERRCODE = 'P0001'; END IF;
  IF v_comp.format::text <> 'CUP' AND (p_rules->>'penaltiesOnDraw')::boolean THEN RAISE EXCEPTION USING MESSAGE = 'PENALTIES_NOT_ALLOWED_FOR_LEAGUE', ERRCODE = 'P0001'; END IF;
  IF v_comp.format::text = 'CUP' AND NOT (p_rules->>'penaltiesOnDraw')::boolean THEN RAISE EXCEPTION USING MESSAGE = 'CUP_REQUIRES_PENALTIES', ERRCODE = 'P0001'; END IF;
  UPDATE public."Competition" SET rules = p_rules, "updatedAt" = (p_now AT TIME ZONE 'UTC') WHERE id = p_competition_id;
  RETURN jsonb_build_object('competitionId', p_competition_id, 'rules', p_rules);
END;
$function$;
REVOKE ALL ON FUNCTION public.update_competition_rules_http(text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_competition_rules_http(text, text, jsonb, timestamptz) TO service_role'; END IF;
END;
$grant$;
