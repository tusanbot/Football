-- Invalid-lineup forfeits must advance the cup/league in the same transaction.
CREATE OR REPLACE FUNCTION public.settle_invalid_match_fixture_and_advance_http(
 p_match_id text,p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $function$
DECLARE
 v_settlement jsonb;
 v_advancement jsonb:=NULL;
 v_competition_id text;
 v_round integer;
BEGIN
 IF p_now IS NULL THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_MATCH_FORFEIT_INPUT',ERRCODE='P0001';
 END IF;
 v_settlement:=public.settle_invalid_match_fixture_http(p_match_id,(p_now AT TIME ZONE 'UTC'));
 v_competition_id:=NULLIF(v_settlement->>'competitionId','');
 v_round:=NULLIF(v_settlement->>'round','')::integer;
 IF (COALESCE((v_settlement->>'settled')::boolean,false)
   OR COALESCE((v_settlement->>'replayed')::boolean,false))
  AND v_competition_id IS NOT NULL AND v_round IS NOT NULL THEN
  v_advancement:=public.advance_competition_after_match_http(v_competition_id,v_round,p_now);
 END IF;
 RETURN v_settlement||jsonb_build_object('advancement',v_advancement);
END;
$function$;
REVOKE ALL ON FUNCTION public.settle_invalid_match_fixture_and_advance_http(text,timestamptz) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.settle_invalid_match_fixture_and_advance_http(text,timestamptz) TO service_role;
 END IF;
END $grant$;
