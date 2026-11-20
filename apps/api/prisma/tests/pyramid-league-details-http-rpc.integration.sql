-- Verify the pyramid league details RPC returns standings, fixtures, next round and awards.
BEGIN;
DO $test$
DECLARE
  v_now timestamptz:=CURRENT_TIMESTAMP;
  v_result jsonb;
BEGIN
  INSERT INTO public."User"(id,"telegramId","updatedAt") VALUES
    ('ci-pyramid-details-user-a','919900011',v_now AT TIME ZONE 'UTC'),
    ('ci-pyramid-details-user-b','919900012',v_now AT TIME ZONE 'UTC');
  INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt") VALUES
    ('ci-pyramid-details-club-a','ci-pyramid-details-user-a','Details Club A','ci-pyramid-details-club-a',v_now AT TIME ZONE 'UTC'),
    ('ci-pyramid-details-club-b','ci-pyramid-details-user-b','Details Club B','ci-pyramid-details-club-b',v_now AT TIME ZONE 'UTC');
  INSERT INTO public."Competition"(id,"idempotencyKey",name,season,format,status,"maxTeams","createdByClubId","startsAt","createdAt","updatedAt")
  VALUES('ci-pyramid-details-competition','ci-pyramid-details-key','Details League',2027,'LEAGUE','ACTIVE',8,
    'ci-pyramid-details-club-a',v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');
  INSERT INTO public."PyramidLeague"(id,"competitionId",tier,season,"groupNumber")
  VALUES('ci-pyramid-details-league','ci-pyramid-details-competition',1,2027,1);
  INSERT INTO public."CompetitionEntry"("id","competitionId","clubId",played,won,drawn,lost,"goalsFor","goalsAgainst",points)
  VALUES
    ('ci-pyramid-details-entry-a','ci-pyramid-details-competition','ci-pyramid-details-club-a',1,1,0,0,2,0,3),
    ('ci-pyramid-details-entry-b','ci-pyramid-details-competition','ci-pyramid-details-club-b',1,0,0,1,0,2,0);
  INSERT INTO public."PyramidLeagueEntry"(id,"leagueId","clubId")
  VALUES
    ('ci-pyramid-details-pyramid-entry-a','ci-pyramid-details-league','ci-pyramid-details-club-a'),
    ('ci-pyramid-details-pyramid-entry-b','ci-pyramid-details-league','ci-pyramid-details-club-b');
  INSERT INTO public."FootballMatch"(id,"idempotencyKey",type,status,"homeClubId","awayClubId","competitionId",round,"scheduledAt",seed,"homeScore","awayScore")
  VALUES('ci-pyramid-details-match','ci-pyramid-details-match-key','LEAGUE','SCHEDULED',
    'ci-pyramid-details-club-a','ci-pyramid-details-club-b','ci-pyramid-details-competition',1,
    v_now AT TIME ZONE 'UTC','ci-pyramid-details-seed',2,0);
  INSERT INTO public."LeagueAward"(id,"leagueId","clubId",season,tier,placement,"awardName","awardType")
  VALUES('ci-pyramid-details-award','ci-pyramid-details-league','ci-pyramid-details-club-a',2027,1,1,'Details Champion','TROPHY_GOLD');

  v_result:=public.get_pyramid_league_details_http('ci-pyramid-details-user-a','ci-pyramid-details-league');
  IF v_result->'league'->>'id' IS DISTINCT FROM 'ci-pyramid-details-league'
    OR v_result->'league'->>'tierName' IS NULL
    OR jsonb_array_length(v_result->'standings')<>2
    OR v_result->'standings'->0->>'clubId' IS DISTINCT FROM 'ci-pyramid-details-club-a'
    OR jsonb_array_length(v_result->'matches')<>1
    OR jsonb_array_length(v_result->'nextRoundMatches')<>1
    OR (v_result->>'nextRound')::integer<>1
    OR jsonb_array_length(v_result->'awards')<>1
    OR jsonb_array_length(v_result->'topScorers')<>0
    OR jsonb_array_length(v_result->'topAssists')<>0 THEN
    RAISE EXCEPTION 'pyramid league details response mismatch: %',v_result;
  END IF;
END;
$test$;
ROLLBACK;
