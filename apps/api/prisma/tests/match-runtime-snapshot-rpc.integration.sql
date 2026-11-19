-- Runtime snapshot RPC contract, nested relation parity, and access controls.
BEGIN;
DO $test$
DECLARE
  v_user_home text := 'ci-runtime-snapshot-home-user';
  v_user_away text := 'ci-runtime-snapshot-away-user';
  v_club_home text := 'ci-runtime-snapshot-home-club';
  v_club_away text := 'ci-runtime-snapshot-away-club';
  v_match text := 'ci-runtime-snapshot-match';
  v_runtime text := 'ci-runtime-snapshot-runtime';
  v_snapshot jsonb;
BEGIN
  INSERT INTO public."User"(id,"telegramId","updatedAt") VALUES
    (v_user_home,'ci-runtime-home-tg',now()),(v_user_away,'ci-runtime-away-tg',now())
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt") VALUES
    (v_club_home,v_user_home,'Runtime Home','ci-runtime-home',now()),
    (v_club_away,v_user_away,'Runtime Away','ci-runtime-away',now())
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,wage,"contractDays","lineupSlot","updatedAt")
  SELECT 'ci-runtime-home-player-'||n,v_club_home,'Home',n::text,'IR',25,
    CASE WHEN n=1 THEN 'GK'::"PlayerPosition" ELSE 'CB'::"PlayerPosition" END,60,65,'{}'::jsonb,10,365,n,now()
  FROM generate_series(1,11) n ON CONFLICT(id) DO NOTHING;
  INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,wage,"contractDays","lineupSlot","updatedAt")
  SELECT 'ci-runtime-away-player-'||n,v_club_away,'Away',n::text,'IR',25,
    CASE WHEN n=1 THEN 'GK'::"PlayerPosition" ELSE 'CB'::"PlayerPosition" END,60,65,'{}'::jsonb,10,365,n,now()
  FROM generate_series(1,11) n ON CONFLICT(id) DO NOTHING;
  INSERT INTO public."FootballMatch"(id,"idempotencyKey",type,status,"homeClubId","awayClubId","scheduledAt",seed,"updatedAt")
  VALUES(v_match,'ci-runtime-snapshot-idempotency','FRIENDLY','IN_PROGRESS',v_club_home,v_club_away,now()-interval '1 minute','ci-runtime-seed',now())
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO public."MatchRuntime"(id,"matchId",status,"currentMinute","stateVersion","nextActionAt","kickoffSnapshot","simulationState","fallbackPlan","leaseToken","updatedAt")
  VALUES(v_runtime,v_match,'RUNNING',45,7,now(), '{"home":{"ticketPrice":"50"},"away":{"ticketPrice":"50"}}'::jsonb,
    '{"segment":{"currentMinute":45}}'::jsonb,'{"home":null,"away":null}'::jsonb,'ci-runtime-lease-token',now())
  ON CONFLICT(id) DO NOTHING;

  v_snapshot := public.get_match_runtime_snapshot_http(v_runtime);
  IF v_snapshot->>'id' <> v_runtime OR v_snapshot->>'stateVersion' <> '7'
    OR v_snapshot->'match'->>'id' <> v_match
    OR v_snapshot->'match'->'homeClub'->>'ownerId' <> v_user_home
    OR v_snapshot->'match'->'homeClub'->'owner'->>'telegramId' <> 'ci-runtime-home-tg'
    OR jsonb_array_length(v_snapshot->'match'->'homeClub'->'players') <> 11
    OR v_snapshot->'match'->'awayClub'->>'name' <> 'Runtime Away'
    OR v_snapshot->'match'->'homeClub'->>'ticketPrice' <> '50' THEN
    RAISE EXCEPTION 'runtime snapshot did not preserve expected worker data: %', v_snapshot;
  END IF;

  IF public.get_match_runtime_snapshot_http('ci-runtime-snapshot-missing') IS NOT NULL THEN
    RAISE EXCEPTION 'missing runtime should return null';
  END IF;

  IF has_function_privilege('anon','public.get_match_runtime_snapshot_http(text)','EXECUTE')
    OR has_function_privilege('authenticated','public.get_match_runtime_snapshot_http(text)','EXECUTE') THEN
    RAISE EXCEPTION 'untrusted roles must not execute runtime snapshot RPC';
  END IF;
  IF NOT has_function_privilege('service_role','public.get_match_runtime_snapshot_http(text)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute runtime snapshot RPC';
  END IF;
END;
$test$;
ROLLBACK;
