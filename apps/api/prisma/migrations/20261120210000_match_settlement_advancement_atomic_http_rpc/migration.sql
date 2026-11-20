-- Match result, wallet/ledger/club-finance writes and competition progression
-- must commit or roll back together. This wrapper is intentionally the only
-- settlement entry point used by the leased Supabase runtime worker.
CREATE OR REPLACE FUNCTION public.settle_and_advance_match_runtime_http(
 p_match_id text,
 p_runtime_id text,
 p_lease_token text,
 p_now timestamptz,
 p_result jsonb,
 p_injury_duration_days integer,
 p_red_card_suspension_matches integer,
 p_yellow_cards_to_suspend integer,
 p_yellow_card_suspension_matches integer,
 p_home_reward bigint,
 p_away_reward bigint
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
 v_settlement jsonb;
 v_advancement jsonb := NULL;
 v_competition_id text;
 v_round integer;
 v_pyramid_finalization jsonb:=NULL;
 v_event_finalization jsonb:=NULL;
BEGIN
 IF p_now IS NULL THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_MATCH_RUNTIME_SETTLEMENT',ERRCODE='P0001';
 END IF;

 -- Both calls execute in this function's transaction. If competition
 -- advancement fails, the match result, rewards, ledger entries and runtime
 -- completion are rolled back, leaving the leased runtime retryable.
 v_settlement := public.settle_match_runtime_result(
  p_match_id,p_runtime_id,p_lease_token,(p_now AT TIME ZONE 'UTC'),p_result,
  p_injury_duration_days,p_red_card_suspension_matches,p_yellow_cards_to_suspend,
  p_yellow_card_suspension_matches,p_home_reward,p_away_reward
 );
 v_competition_id := NULLIF(v_settlement->>'competitionId','');
 v_round := NULLIF(v_settlement->>'round','')::integer;
 IF v_competition_id IS NOT NULL AND v_round IS NOT NULL THEN
  v_advancement := public.advance_competition_after_match_http(v_competition_id,v_round,p_now);
  IF COALESCE((v_advancement->>'completed')::boolean,false) THEN
   v_pyramid_finalization:=public.finalize_pyramid_league_http(v_competition_id,p_now);
   v_event_finalization:=public.finalize_event_tournament_http(v_competition_id,p_now);
  END IF;
 END IF;

 RETURN v_settlement || jsonb_build_object('advancement',v_advancement,
  'pyramidFinalization',v_pyramid_finalization,'eventTournamentFinalization',v_event_finalization);
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_and_advance_match_runtime_http(
 text,text,text,timestamptz,jsonb,integer,integer,integer,integer,bigint,bigint
) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.settle_and_advance_match_runtime_http(
   text,text,text,timestamptz,jsonb,integer,integer,integer,integer,bigint,bigint
  ) TO service_role;
 END IF;
END $grant$;
