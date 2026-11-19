CREATE OR REPLACE FUNCTION public.manage_club_logo_http(
  p_user_id text,
  p_action text,
  p_logo_data text DEFAULT NULL,
  p_logo_mime text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public."Club"%ROWTYPE;
  active_competition jsonb;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) NOT BETWEEN 1 AND 128
     OR p_action NOT IN ('upload', 'delete') THEN
    RAISE EXCEPTION 'INVALID_CLUB_LOGO_COMMAND' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'upload' AND (
    p_logo_data IS NULL OR length(p_logo_data) < 16 OR length(p_logo_data) > 700000
    OR p_logo_mime NOT IN ('image/png', 'image/jpeg', 'image/webp')
  ) THEN
    RAISE EXCEPTION 'INVALID_CLUB_LOGO' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO c FROM public."Club" WHERE "ownerId" = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind', 'NOT_FOUND'); END IF;

  SELECT jsonb_build_object('id', x.id, 'name', x.name) INTO active_competition
  FROM (
    SELECT co.id, co.name
    FROM public."CompetitionEntry" ce
    JOIN public."Competition" co ON co.id = ce."competitionId"
    WHERE ce."clubId" = c.id AND co.status = 'ACTIVE'
    UNION ALL
    SELECT co.id, co.name
    FROM public."PyramidLeagueEntry" ple
    JOIN public."PyramidLeague" pl ON pl.id = ple."leagueId"
    JOIN public."Competition" co ON co.id = pl."competitionId"
    WHERE ple."clubId" = c.id AND co.status = 'ACTIVE'
  ) x
  LIMIT 1;

  IF active_competition IS NOT NULL THEN
    RETURN jsonb_build_object('kind', 'LOCKED', 'activeCompetition', active_competition);
  END IF;

  IF p_action = 'upload' THEN
    UPDATE public."Club"
    SET "logoData" = p_logo_data, "logoMime" = p_logo_mime, "updatedAt" = now()
    WHERE id = c.id;
    RETURN jsonb_build_object('kind', 'UPDATED', 'club', jsonb_build_object('id', c.id, 'name', c.name));
  END IF;

  UPDATE public."Club"
  SET "logoData" = NULL, "logoMime" = NULL, "updatedAt" = now()
  WHERE id = c.id;
  RETURN jsonb_build_object('kind', 'UPDATED', 'removed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.manage_club_logo_http(text, text, text, text) FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.manage_club_logo_http(text, text, text, text) TO service_role';
  END IF;
END
$$;
