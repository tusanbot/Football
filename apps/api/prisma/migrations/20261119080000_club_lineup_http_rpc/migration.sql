CREATE OR REPLACE FUNCTION public.p_player_formation_slot_allowed(p_formation TEXT, p_slot INTEGER, p_position TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE p_formation
    WHEN '4-3-3' THEN CASE p_slot
      WHEN 1 THEN p_position = 'GK' WHEN 2 THEN p_position = 'RB' WHEN 3 THEN p_position = 'CB'
      WHEN 4 THEN p_position = 'CB' WHEN 5 THEN p_position = 'LB' WHEN 6 THEN p_position = 'CDM'
      WHEN 7 THEN p_position = 'CM' WHEN 8 THEN p_position = 'CAM' WHEN 9 THEN p_position = 'RW'
      WHEN 10 THEN p_position = 'ST' WHEN 11 THEN p_position = 'LW' ELSE FALSE END
    WHEN '4-4-2' THEN CASE p_slot
      WHEN 1 THEN p_position = 'GK' WHEN 2 THEN p_position = 'RB' WHEN 3 THEN p_position = 'CB'
      WHEN 4 THEN p_position = 'CB' WHEN 5 THEN p_position = 'LB' WHEN 6 THEN p_position IN ('CM','CDM')
      WHEN 7 THEN p_position IN ('CM','CDM') WHEN 8 THEN p_position IN ('RW','RB') WHEN 9 THEN p_position IN ('LW','LB')
      WHEN 10 THEN p_position = 'ST' WHEN 11 THEN p_position = 'ST' ELSE FALSE END
    WHEN '3-5-2' THEN CASE p_slot
      WHEN 1 THEN p_position = 'GK' WHEN 2 THEN p_position = 'CB' WHEN 3 THEN p_position = 'CB'
      WHEN 4 THEN p_position = 'CB' WHEN 5 THEN p_position IN ('CDM','RB') WHEN 6 THEN p_position IN ('CM','CDM')
      WHEN 7 THEN p_position = 'CM' WHEN 8 THEN p_position IN ('CAM','CM') WHEN 9 THEN p_position IN ('RW','RB')
      WHEN 10 THEN p_position = 'ST' WHEN 11 THEN p_position IN ('ST','LW') ELSE FALSE END
    WHEN '4-2-3-1' THEN CASE p_slot
      WHEN 1 THEN p_position = 'GK' WHEN 2 THEN p_position = 'RB' WHEN 3 THEN p_position = 'CB'
      WHEN 4 THEN p_position = 'CB' WHEN 5 THEN p_position = 'LB' WHEN 6 THEN p_position IN ('CDM','CM')
      WHEN 7 THEN p_position IN ('CDM','CM') WHEN 8 THEN p_position IN ('CAM','CM') WHEN 9 THEN p_position IN ('RW','LW')
      WHEN 10 THEN p_position IN ('LW','RW') WHEN 11 THEN p_position = 'ST' ELSE FALSE END
    ELSE FALSE END;
$$;
CREATE OR REPLACE FUNCTION public.update_club_lineup_http(
  p_user_id TEXT, p_formation TEXT, p_player_ids JSONB, p_expected_version INTEGER,
  p_tactics JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_club "Club"%ROWTYPE; v_count INTEGER; v_invalid INTEGER;
BEGIN
  IF p_formation IS NULL OR p_formation NOT IN ('4-3-3','4-4-2','3-5-2','4-2-3-1')
    OR p_expected_version IS NULL OR p_expected_version < 0
    OR jsonb_typeof(COALESCE(p_tactics,'{}'::jsonb)) IS DISTINCT FROM 'object'
    OR (p_tactics ? 'mentality' AND (p_tactics->>'mentality') NOT IN ('DEFENSIVE','BALANCED','ATTACKING'))
    OR (p_tactics ? 'pressing' AND (p_tactics->>'pressing') NOT IN ('LOW_BLOCK','MID_BLOCK','HIGH_PRESS'))
    OR (p_tactics ? 'tempo' AND (p_tactics->>'tempo') NOT IN ('SLOW','NORMAL','FAST'))
    OR (p_tactics ? 'passingStyle' AND (p_tactics->>'passingStyle') NOT IN ('SHORT','MIXED','DIRECT')) THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_LINEUP_REQUEST');
  END IF;
  IF p_player_ids IS NULL OR jsonb_typeof(p_player_ids) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_LINEUP_REQUEST');
  END IF;
  IF jsonb_array_length(p_player_ids) <> 11 THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_LINEUP_REQUEST');
  END IF;
  SELECT * INTO v_club FROM public."Club" WHERE "ownerId"=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','CLUB_NOT_FOUND'); END IF;
  IF v_club."lineupVersion" <> p_expected_version THEN
    RETURN jsonb_build_object('ok',false,'error','LINEUP_VERSION_CONFLICT','currentVersion',v_club."lineupVersion");
  END IF;
  SELECT count(DISTINCT value) INTO v_count FROM jsonb_array_elements_text(p_player_ids);
  IF v_count <> 11 THEN RETURN jsonb_build_object('ok',false,'error','LINEUP_PLAYERS_INVALID'); END IF;
  WITH selected AS (SELECT value player_id, ordinality::INTEGER slot FROM jsonb_array_elements_text(p_player_ids) WITH ORDINALITY)
  SELECT count(*) INTO v_count FROM selected s JOIN public."Player" p ON p.id=s.player_id
   WHERE p."clubId"=v_club.id AND p.status::text='ACTIVE' AND p."suspensionMatchesRemaining"=0;
  IF v_count <> 11 THEN RETURN jsonb_build_object('ok',false,'error','LINEUP_PLAYERS_INVALID'); END IF;
  WITH selected AS (SELECT value player_id, ordinality::INTEGER slot FROM jsonb_array_elements_text(p_player_ids) WITH ORDINALITY)
  SELECT count(*) INTO v_invalid FROM selected s JOIN public."Player" p ON p.id=s.player_id
   WHERE NOT public.p_player_formation_slot_allowed(p_formation,s.slot,p.position::text);
  IF v_invalid > 0 THEN RETURN jsonb_build_object('ok',false,'error','LINEUP_INVALID'); END IF;
  UPDATE public."Club" SET formation=p_formation,
    mentality=COALESCE(p_tactics->>'mentality',mentality), pressing=COALESCE(p_tactics->>'pressing',pressing),
    tempo=COALESCE(p_tactics->>'tempo',tempo), "passingStyle"=COALESCE(p_tactics->>'passingStyle',"passingStyle"),
    "lineupVersion"="lineupVersion"+1
   WHERE id=v_club.id AND "ownerId"=p_user_id AND "lineupVersion"=p_expected_version;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','LINEUP_VERSION_CONFLICT'); END IF;
  UPDATE public."Player" SET "lineupSlot"=NULL WHERE "clubId"=v_club.id AND "lineupSlot" IS NOT NULL;
  WITH selected AS (SELECT value player_id, ordinality::INTEGER slot FROM jsonb_array_elements_text(p_player_ids) WITH ORDINALITY)
  UPDATE public."Player" p SET "lineupSlot"=s.slot FROM selected s
   WHERE p.id=s.player_id AND p."clubId"=v_club.id AND p.status::text='ACTIVE' AND p."suspensionMatchesRemaining"=0;
  RETURN jsonb_build_object('ok',true,'lineupVersion',p_expected_version+1);
END;
$$;
REVOKE ALL ON FUNCTION public.update_club_lineup_http(TEXT,TEXT,JSONB,INTEGER,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p_player_formation_slot_allowed(TEXT,INTEGER,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_club_lineup_http(TEXT,TEXT,JSONB,INTEGER,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.p_player_formation_slot_allowed(TEXT,INTEGER,TEXT) TO service_role;
