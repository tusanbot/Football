-- Atomic pyramid league application, lineup validation, queue assignment and replay safety.
BEGIN;
SET LOCAL TIME ZONE 'Pacific/Auckland';
DO $test$
DECLARE
  v_now timestamptz:='2026-11-20T12:34:56.789Z';
  v_result jsonb;
  v_replay jsonb;
  v_users text[]:=ARRAY['ci-pyramid-user-1','ci-pyramid-user-2','ci-pyramid-user-3','ci-pyramid-user-4','ci-pyramid-user-5','ci-pyramid-user-6','ci-pyramid-user-7','ci-pyramid-user-8'];
  v_clubs text[]:=ARRAY['ci-pyramid-club-1','ci-pyramid-club-2','ci-pyramid-club-3','ci-pyramid-club-4','ci-pyramid-club-5','ci-pyramid-club-6','ci-pyramid-club-7','ci-pyramid-club-8'];
  v_positions text[]:=ARRAY['GK','RB','CB','CB','LB','CDM','CM','CM','RW','LW','ST'];
  v_competition_id text;
  v_details jsonb;
  v_league_id text;
  i integer;n integer;
BEGIN
  FOR i IN 1..8 LOOP
    INSERT INTO public."User"(id,"telegramId","updatedAt")
    VALUES(v_users[i],('91000000'||i)::text,v_now AT TIME ZONE 'UTC');
    INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt")
    VALUES(v_clubs[i],v_users[i],'CI Pyramid Club '||i,'ci-pyramid-club-'||i,v_now AT TIME ZONE 'UTC');
    FOR n IN 1..11 LOOP
      INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,
        attributes,wage,"contractDays","createdAt","updatedAt")
      VALUES('ci-pyramid-player-'||i||'-'||n,v_clubs[i],'Player',''||n,'US',22,
        v_positions[n]::"PlayerPosition",60,70,'{}'::jsonb,10,365,v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');
    END LOOP;
  END LOOP;

  v_result:=public.apply_pyramid_league_http(v_users[1],1,v_now);
  IF v_result->>'status' IS DISTINCT FROM 'QUEUED'
    OR v_result->>'waitingTeams' IS DISTINCT FROM '1'
    OR v_result->>'requiredTeams' IS DISTINCT FROM '8' THEN
    RAISE EXCEPTION 'first application response mismatch: %',v_result;
  END IF;
  v_replay:=public.apply_pyramid_league_http(v_users[1],1,v_now+interval '1 minute');
  IF v_replay->>'replayed' IS DISTINCT FROM 'true'
    OR v_replay->>'status' IS DISTINCT FROM 'QUEUED'
    OR (SELECT count(*) FROM public."PyramidLeagueApplication" WHERE "clubId"=v_clubs[1] AND tier=1 AND season=2027)<>1 THEN
    RAISE EXCEPTION 'application replay was not idempotent: %',v_replay;
  END IF;

  FOR i IN 2..7 LOOP
    PERFORM public.apply_pyramid_league_http(v_users[i],1,v_now);
  END LOOP;
  v_result:=public.apply_pyramid_league_http(v_users[8],1,v_now);
  v_league_id:=v_result->>'leagueId';
  v_competition_id:=v_result->>'competitionId';
  IF v_result->>'status' IS DISTINCT FROM 'ASSIGNED'
    OR v_result->>'replayed' IS DISTINCT FROM 'false'
    OR v_result->>'teams' IS DISTINCT FROM '8'
    OR v_result->>'fixturesCreated' IS DISTINCT FROM '28'
    OR COALESCE(v_league_id,'')='' OR COALESCE(v_competition_id,'')='' THEN
    RAISE EXCEPTION 'eight-team queue did not form a league: %',v_result;
  END IF;
  v_details:=public.get_pyramid_league_details_http(v_users[1],v_league_id);
  IF jsonb_array_length(v_details->'standings')<>8 OR jsonb_array_length(v_details->'matches')<>28
    OR v_details->'league'->>'id' IS DISTINCT FROM v_league_id THEN
    RAISE EXCEPTION 'pyramid league detail read response mismatch: %',v_details;
  END IF;

  IF (SELECT count(*) FROM public."PyramidLeagueEntry" WHERE "leagueId"=v_league_id)<>8
    OR (SELECT count(*) FROM public."CompetitionEntry" WHERE "competitionId"=v_competition_id)<>8
    OR (SELECT count(*) FROM public."FootballMatch" WHERE "competitionId"=v_competition_id)<>28
    OR (SELECT count(*) FROM public."PyramidLeagueApplication" WHERE "assignedLeagueId"=v_league_id AND status::text='ASSIGNED')<>8 THEN
    RAISE EXCEPTION 'league entries, competition entries, fixtures or assignments were not atomic';
  END IF;

  v_replay:=public.apply_pyramid_league_http(v_users[1],1,v_now+interval '2 minutes');
  IF v_replay->>'replayed' IS DISTINCT FROM 'true'
    OR v_replay->>'status' IS DISTINCT FROM 'ASSIGNED'
    OR v_replay->>'leagueId' IS DISTINCT FROM v_league_id THEN
    RAISE EXCEPTION 'assigned application replay did not return original league: %',v_replay;
  END IF;

  INSERT INTO public."User"(id,"telegramId","updatedAt") VALUES('ci-pyramid-bad-user','919999999',v_now AT TIME ZONE 'UTC');
  INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt") VALUES('ci-pyramid-bad-club','ci-pyramid-bad-user','Bad Club','ci-pyramid-bad-club',v_now AT TIME ZONE 'UTC');
  INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,wage,"contractDays","createdAt","updatedAt")
  VALUES('ci-pyramid-bad-player','ci-pyramid-bad-club','No','Keeper','US',22,'ST',60,70,'{}'::jsonb,10,365,v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');
  BEGIN
    PERFORM public.apply_pyramid_league_http('ci-pyramid-bad-user',1,v_now);
    RAISE EXCEPTION 'invalid lineup unexpectedly accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM IS DISTINCT FROM 'ALL_TEAMS_NEED_VALID_LINEUPS' THEN RAISE; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public."PyramidLeagueApplication" WHERE "clubId"='ci-pyramid-bad-club') THEN
    RAISE EXCEPTION 'invalid lineup created an application';
  END IF;

  BEGIN
    PERFORM public.apply_pyramid_league_http(v_users[1],2,v_now);
    RAISE EXCEPTION 'direct tier entry unexpectedly accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM IS DISTINCT FROM 'DIRECT_TIER_ENTRY_NOT_ALLOWED' THEN RAISE; END IF;
  END;
END;
$test$;
ROLLBACK;
