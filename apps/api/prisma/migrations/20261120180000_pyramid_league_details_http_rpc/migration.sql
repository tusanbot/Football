CREATE OR REPLACE FUNCTION public.get_pyramid_league_details_http(p_user_id text,p_league_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE
 v_club_id text;
 v_league jsonb;
 v_standings jsonb;
 v_matches jsonb;
 v_scorers jsonb;
 v_assists jsonb;
 v_awards jsonb;
 v_next_round integer;
 v_next_matches jsonb;
 v_competition_id text;
BEGIN
 SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId"=p_user_id;
 IF v_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE='CLUB_NOT_FOUND',ERRCODE='P0001'; END IF;
 SELECT jsonb_build_object(
  'id',l.id,'tier',l.tier,'tierName',public.pyramid_tier_name_http(l.tier),
  'season',l.season,'groupNumber',l."groupNumber",'name',c.name,
  'status',c.status::text,'startsAt',c."startsAt"
 ),l."competitionId"
 INTO v_league,v_competition_id
 FROM public."PyramidLeague" l JOIN public."Competition" c ON c.id=l."competitionId"
 WHERE l.id=p_league_id;
 IF v_league IS NULL THEN RAISE EXCEPTION USING MESSAGE='PYRAMID_LEAGUE_NOT_FOUND',ERRCODE='P0001'; END IF;

 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.position),'[]'::jsonb)
 INTO v_standings
 FROM (
  SELECT row_number() OVER(ORDER BY e.points DESC,(e."goalsFor"-e."goalsAgainst") DESC,e."goalsFor" DESC,e.won DESC,e."clubId" ASC)::integer AS position,
   e."clubId" AS "clubId",cl.name AS "clubName",e.played,e.won,e.drawn,e.lost,
   e."goalsFor",e."goalsAgainst",(e."goalsFor"-e."goalsAgainst") AS "goalDifference",
   e.points,e.won AS wins
  FROM public."CompetitionEntry" e JOIN public."Club" cl ON cl.id=e."clubId"
  WHERE e."competitionId"=v_competition_id
 ) r;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id',m.id,'round',m.round,'scheduledAt',m."scheduledAt",'status',m.status::text,
  'homeClub',jsonb_build_object('id',hc.id,'name',hc.name),
  'awayClub',jsonb_build_object('id',ac.id,'name',ac.name),
  'homeScore',m."homeScore",'awayScore',m."awayScore"
 ) ORDER BY m.round NULLS LAST,m."scheduledAt"),'[]'::jsonb)
 INTO v_matches
 FROM public."FootballMatch" m
 JOIN public."Club" hc ON hc.id=m."homeClubId"
 JOIN public."Club" ac ON ac.id=m."awayClubId"
 WHERE m."competitionId"=v_competition_id;

 SELECT min(round) INTO v_next_round FROM public."FootballMatch"
 WHERE "competitionId"=v_competition_id AND status::text<>'COMPLETED' AND round IS NOT NULL;
 SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'scheduledAt')),'[]'::jsonb)
 INTO v_next_matches
 FROM jsonb_array_elements(v_matches) item
 WHERE v_next_round IS NOT NULL AND (item->>'round')::integer=v_next_round;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'playerId',p."playerId",'playerName',p."firstName"||' '||p."lastName",
  'clubId',p."clubId",'clubName',cl.name,'goals',p.total
 ) ORDER BY p.total DESC),'[]'::jsonb)
 INTO v_scorers
 FROM (
  SELECT perf."playerId",perf."clubId",pl."firstName",pl."lastName",sum(perf.goals)::integer AS total
  FROM public."PlayerMatchPerformance" perf
  JOIN public."Player" pl ON pl.id=perf."playerId"
  WHERE perf."matchId" IN (SELECT id FROM public."FootballMatch" WHERE "competitionId"=v_competition_id)
  GROUP BY perf."playerId",perf."clubId",pl."firstName",pl."lastName"
  ORDER BY sum(perf.goals) DESC LIMIT 20
 ) p JOIN public."Club" cl ON cl.id=p."clubId";

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'playerId',p."playerId",'playerName',p."firstName"||' '||p."lastName",
  'clubId',p."clubId",'clubName',cl.name,'assists',p.total
 ) ORDER BY p.total DESC),'[]'::jsonb)
 INTO v_assists
 FROM (
  SELECT perf."playerId",perf."clubId",pl."firstName",pl."lastName",sum(perf.assists)::integer AS total
  FROM public."PlayerMatchPerformance" perf
  JOIN public."Player" pl ON pl.id=perf."playerId"
  WHERE perf."matchId" IN (SELECT id FROM public."FootballMatch" WHERE "competitionId"=v_competition_id)
  GROUP BY perf."playerId",perf."clubId",pl."firstName",pl."lastName"
  ORDER BY sum(perf.assists) DESC LIMIT 20
 ) p JOIN public."Club" cl ON cl.id=p."clubId";

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'placement',a.placement,'awardName',a."awardName",'awardType',a."awardType",'clubName',cl.name
 ) ORDER BY a.placement),'[]'::jsonb)
 INTO v_awards
 FROM public."LeagueAward" a JOIN public."Club" cl ON cl.id=a."clubId"
 WHERE a."leagueId"=p_league_id;

 RETURN jsonb_build_object(
  'league',v_league,'standings',v_standings,'topScorers',v_scorers,'topAssists',v_assists,
  'matches',v_matches,'nextRound',v_next_round,'nextRoundMatches',v_next_matches,'awards',v_awards
 );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_pyramid_league_details_http(text,text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.get_pyramid_league_details_http(text,text) TO service_role;
 END IF;
END;
$grant$;
