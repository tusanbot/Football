BEGIN;
DO $test$
DECLARE
 v_now timestamptz:='2026-11-20T12:34:56.789Z';
 v_list jsonb; v_claim jsonb; v_id text; v_token text; v_failed jsonb; v_done jsonb; v_marked jsonb;
BEGIN
 INSERT INTO public."User"(id,"telegramId","updatedAt") VALUES('ci-pyramid-notice-user','919900003',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."LeagueNotice"(id,"userId",kind,title,body,"createdAt")
 VALUES('ci-pyramid-notice-1','ci-pyramid-notice-user','TEST','Notice 1','Body 1',v_now AT TIME ZONE 'UTC'),
       ('ci-pyramid-notice-2','ci-pyramid-notice-user','TEST','Notice 2','Body 2',(v_now+interval '1 second') AT TIME ZONE 'UTC');
 v_list:=public.list_pyramid_league_notices_http('ci-pyramid-notice-user');
 IF jsonb_array_length(v_list->'notices')<>2 THEN RAISE EXCEPTION 'notice listing mismatch: %',v_list; END IF;
 v_claim:=public.claim_pyramid_league_notices_http(1,v_now);
 IF jsonb_array_length(v_claim->'notices')<>1 THEN RAISE EXCEPTION 'notice claim mismatch: %',v_claim; END IF;
 v_id:=v_claim->'notices'->0->>'id'; v_token:=v_claim->'notices'->0->>'claimToken';
 v_failed:=public.fail_pyramid_league_notice_http(v_id,v_token,'temporary failure',v_now);
 IF v_failed->>'owned' IS DISTINCT FROM 'true' OR v_failed->>'attempts' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'notice fail mismatch: %',v_failed; END IF;
 v_claim:=public.claim_pyramid_league_notices_http(1,v_now+interval '2 hours');
 v_id:=v_claim->'notices'->0->>'id'; v_token:=v_claim->'notices'->0->>'claimToken';
 v_done:=public.complete_pyramid_league_notice_http(v_id,v_token,v_now+interval '2 hours');
 IF v_done->>'completed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'notice completion mismatch: %',v_done; END IF;
 v_marked:=public.mark_pyramid_league_notices_read_http('ci-pyramid-notice-user',v_now+interval '3 hours');
 IF (v_marked->>'markedRead')::integer<>2 THEN RAISE EXCEPTION 'notice mark read mismatch: %',v_marked; END IF;
 v_list:=public.list_pyramid_league_notices_http('ci-pyramid-notice-user');
 IF jsonb_array_length(v_list->'notices')<>0 THEN RAISE EXCEPTION 'read notices still listed: %',v_list; END IF;
END;
$test$;
ROLLBACK;
