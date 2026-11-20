-- Integration tests for public competition read RPCs; all rows are rolled back.
BEGIN;
SET LOCAL TIME ZONE 'America/Los_Angeles';
DO $test$
DECLARE
 v_now timestamptz:='2026-11-20T12:34:56.789Z';
 v_owner text:='ci-competition-read-owner';v_other text:='ci-competition-read-other';
 v_club text:='ci-competition-read-club';v_other_club text:='ci-competition-read-other-club';
 v_comp text:='ci-competition-read-comp';v_result jsonb;v_message text;
BEGIN
 INSERT INTO public."User"(id,"telegramId","updatedAt") VALUES
  (v_owner,'ci-competition-read-owner-tg',v_now AT TIME ZONE 'UTC'),
  (v_other,'ci-competition-read-other-tg',v_now AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt") VALUES
  (v_club,v_owner,'CI Read Club','ci-competition-read-club',v_now AT TIME ZONE 'UTC'),
  (v_other_club,v_other,'CI Read Away','ci-competition-read-away',v_now AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."Competition"(id,"idempotencyKey",name,season,format,status,"maxTeams","cupLegs","createdByClubId","createdAt","updatedAt")
 VALUES(v_comp,'ci-competition-read-key','CI Read League',2026,'LEAGUE','REGISTRATION',4,1,v_club,v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId",played,won,drawn,lost,"goalsFor","goalsAgainst",points,"joinedAt")
 VALUES('ci-competition-read-entry-1',v_comp,v_club,1,1,0,0,2,0,3,v_now AT TIME ZONE 'UTC'),
       ('ci-competition-read-entry-2',v_comp,v_other_club,1,0,0,1,0,2,0,v_now AT TIME ZONE 'UTC');
 INSERT INTO public."FootballMatch"(id,"idempotencyKey",type,status,"homeClubId","awayClubId","competitionId",round,leg,"scheduledAt",seed,"homeScore","awayScore","createdAt","updatedAt")
 VALUES('ci-competition-read-match','ci-competition-read-match-key','LEAGUE','COMPLETED',v_club,v_other_club,v_comp,1,1,v_now AT TIME ZONE 'UTC','ci-read-seed',2,0,v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');
 v_result:=public.list_open_competitions_http(v_owner);
 IF jsonb_array_length(v_result)<>1 OR v_result->0->>'id'<>v_comp
  OR v_result->0->>'joined'<>'true' OR v_result->0->>'teams'<>'2'
  OR v_result->0->>'creator'<>'CI Read Club' THEN
  RAISE EXCEPTION 'open competition response mismatch: %',v_result;
 END IF;
 v_result:=public.get_competition_http(v_owner,v_comp);
 IF v_result->'competition'->>'id'<>v_comp
  OR jsonb_array_length(v_result->'standings')<>2
  OR v_result->'standings'->0->>'clubId'<>v_club
  OR jsonb_array_length(v_result->'matches')<>1
  OR v_result->'matches'->0->>'id'<>'ci-competition-read-match'
  OR v_result->'matches'->0->'homeClub'->>'name'<>'CI Read Club'
  OR v_result->'nextRound' IS DISTINCT FROM 'null'::jsonb
  OR jsonb_array_length(v_result->'topScorers')<>0 THEN
  RAISE EXCEPTION 'competition detail response mismatch: %',v_result;
 END IF;
 BEGIN
  PERFORM public.get_competition_http(v_other,v_comp);
  RAISE EXCEPTION 'non-member must not read competition detail';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
  IF v_message<>'NOT_COMPETITION_MEMBER' THEN RAISE; END IF;
 END;
END;
$test$;
ROLLBACK;
