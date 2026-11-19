CREATE OR REPLACE FUNCTION public.rename_club_http(p_user_id text, p_name text)
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
     OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 32
     OR p_name !~ '^[[:alnum:] .''-]+$' THEN
    RAISE EXCEPTION 'INVALID_CLUB_NAME' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public."Club" WHERE "ownerId" = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind','NOT_FOUND'); END IF;

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
  ) x LIMIT 1;
  IF active_competition IS NOT NULL THEN
    RETURN jsonb_build_object('kind','LOCKED','activeCompetition',active_competition);
  END IF;

  UPDATE public."Club" SET name = btrim(p_name), "updatedAt" = now()
  WHERE id = c.id
  RETURNING jsonb_build_object('id',id,'name',name,'level',level,'reputation',reputation) INTO active_competition;
  RETURN jsonb_build_object('kind','UPDATED','club',active_competition);
END;
$$;
REVOKE ALL ON FUNCTION public.rename_club_http(text,text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.rename_club_http(text,text) TO service_role';
  END IF;
END $$;
