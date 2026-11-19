CREATE OR REPLACE FUNCTION public.advance_competition_after_match_http(p_competition_id text,p_round integer,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp
AS $function$
DECLARE
 v_comp public."Competition"%ROWTYPE; v_total integer; v_completed integer; v_next integer;
 v_created integer:=0; v_notices integer:=0; v_ties integer:=0; v_winners text[]:=ARRAY[]::text[];
 v_tie record; v_pair integer; v_leg integer; v_tie_id text; v_key text; v_home text; v_away text;
 v_rules jsonb; v_schedule timestamptz; v_results text; v_table text; v_title text; v_body text;
 v_round_complete boolean:=false; v_comp_completed boolean:=false;
BEGIN
 IF COALESCE(btrim(p_competition_id),'')='' OR p_round IS NULL OR p_round<1 OR p_now IS NULL THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_COMPETITION_ADVANCEMENT',ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('competition-advancement:'||p_competition_id,0));
 SELECT * INTO v_comp FROM public."Competition" WHERE id=p_competition_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='COMPETITION_NOT_FOUND',ERRCODE='P0001'; END IF;
 IF v_comp.status::text='COMPLETED' THEN
  RETURN jsonb_build_object('competitionId',v_comp.id,'format',v_comp.format::text,'completed',true,
   'roundComplete',true,'nextRound',NULL,'fixturesCreated',0,'noticesCreated',0,'replayed',true); END IF;
 IF v_comp.status::text<>'ACTIVE' OR v_comp.format::text NOT IN('LEAGUE','CUP') THEN
  RAISE EXCEPTION USING MESSAGE='COMPETITION_NOT_ACTIVE',ERRCODE='P0001'; END IF;
 SELECT count(*),count(*) FILTER(WHERE status::text='COMPLETED') INTO v_total,v_completed
 FROM public."FootballMatch" WHERE "competitionId"=p_competition_id AND round=p_round;
 v_round_complete:=v_total>0 AND v_total=v_completed;
 IF NOT v_round_complete THEN
  RETURN jsonb_build_object('competitionId',v_comp.id,'format',v_comp.format::text,'completed',false,
   'roundComplete',false,'nextRound',NULL,'fixturesCreated',0,'noticesCreated',0,'replayed',false); END IF;
 IF v_comp.format::text='CUP' THEN
  FOR v_tie IN
   SELECT min(COALESCE("tieId",'legacy:'||id)) AS tie_key,count(*) AS fixture_count,
    count(*) FILTER(WHERE status::text='COMPLETED') AS completed_count,
    max("winnerClubId") FILTER(WHERE leg=2) AS second_winner,
    max("winnerClubId") FILTER(WHERE leg=1) AS first_winner
   FROM public."FootballMatch" WHERE "competitionId"=p_competition_id AND round=p_round
   GROUP BY COALESCE("tieId",'legacy:'||id) ORDER BY min(COALESCE("tieId",'legacy:'||id))
  LOOP
   v_ties:=v_ties+1;
   IF v_comp."cupLegs"=2 THEN
    IF v_tie.fixture_count<>2 OR v_tie.completed_count<>2 OR v_tie.second_winner IS NULL THEN
     RAISE EXCEPTION USING MESSAGE='CUP_TIE_NOT_RESOLVED',ERRCODE='P0001'; END IF;
    v_winners:=array_append(v_winners,v_tie.second_winner);
   ELSE
    IF v_tie.fixture_count<>1 OR v_tie.completed_count<>1 OR v_tie.first_winner IS NULL THEN
     RAISE EXCEPTION USING MESSAGE='CUP_TIE_NOT_RESOLVED',ERRCODE='P0001'; END IF;
    v_winners:=array_append(v_winners,v_tie.first_winner);
   END IF;
  END LOOP;
  IF v_ties=0 THEN
   RETURN jsonb_build_object('competitionId',v_comp.id,'format','CUP','completed',false,
    'roundComplete',false,'nextRound',NULL,'fixturesCreated',0,'noticesCreated',0,'replayed',false); END IF;
  IF cardinality(v_winners)=1 THEN
   UPDATE public."Competition" SET status='COMPLETED',"completedAt"=COALESCE("completedAt",p_now),
    "updatedAt"=(p_now AT TIME ZONE 'UTC') WHERE id=p_competition_id AND status='ACTIVE';
   v_comp_completed:=true;
  ELSE
   IF cardinality(v_winners)%2<>0 THEN RAISE EXCEPTION USING MESSAGE='CUP_BRACKET_INVALID',ERRCODE='P0001'; END IF;
   v_next:=p_round+1;
   IF EXISTS(SELECT 1 FROM public."FootballMatch" WHERE "competitionId"=p_competition_id AND round=v_next) THEN
    RETURN jsonb_build_object('competitionId',v_comp.id,'format','CUP','completed',false,
     'roundComplete',true,'nextRound',v_next,'fixturesCreated',0,'noticesCreated',0,'replayed',true); END IF;
   v_rules:=COALESCE(v_comp.rules,'{"maxSubstitutions":5,"maxInPlayWindows":3,"injuriesEnabled":true,"injuryDurationDays":5,"redCardSuspensionMatches":1,"yellowCardsToSuspend":3,"yellowCardSuspensionMatches":1,"penaltiesOnDraw":true}'::jsonb);
   FOR v_pair IN 1..(cardinality(v_winners)/2) LOOP
    v_home:=v_winners[v_pair*2-1]; v_away:=v_winners[v_pair*2];
    v_tie_id:='cup:'||p_competition_id||':r'||v_next||':t'||v_pair;
    FOR v_leg IN 1..v_comp."cupLegs" LOOP
     v_key:=v_tie_id||':leg'||v_leg;
     v_schedule:=date_trunc('hour',(p_now+make_interval(days=>v_leg*3)) AT TIME ZONE 'Asia/Tehran')
      +CASE WHEN date_part('minute',(p_now+make_interval(days=>v_leg*3)) AT TIME ZONE 'Asia/Tehran')>0
       OR date_part('second',(p_now+make_interval(days=>v_leg*3)) AT TIME ZONE 'Asia/Tehran')>0
       THEN interval '1 hour' ELSE interval '0 hour' END;
     v_schedule:=v_schedule AT TIME ZONE 'Asia/Tehran';
     INSERT INTO public."FootballMatch"(id,"idempotencyKey",type,status,"homeClubId","awayClubId","competitionId",
      "rulesSnapshot","tieId",leg,round,"scheduledAt",seed,"createdAt","updatedAt")
     VALUES('match_'||replace(gen_random_uuid()::text,'-',''),v_key,'CUP','SCHEDULED',
      CASE WHEN v_leg=1 THEN v_home ELSE v_away END,CASE WHEN v_leg=1 THEN v_away ELSE v_home END,
      p_competition_id,v_rules,CASE WHEN v_comp."cupLegs"=2 THEN v_tie_id ELSE NULL END,
      v_leg,v_next,v_schedule,v_key,(p_now AT TIME ZONE 'UTC'),(p_now AT TIME ZONE 'UTC'));
     v_created:=v_created+1;
    END LOOP;
   END LOOP;
  END IF;
 ELSE
  SELECT count(*),count(*) FILTER(WHERE status::text='COMPLETED') INTO v_total,v_completed
  FROM public."FootballMatch" WHERE "competitionId"=p_competition_id;
  IF v_total>0 AND v_total=v_completed THEN
   UPDATE public."Competition" SET status='COMPLETED',"completedAt"=COALESCE("completedAt",p_now),
    "updatedAt"=(p_now AT TIME ZONE 'UTC') WHERE id=p_competition_id AND status='ACTIVE';
   v_comp_completed:=true;
  END IF;
  SELECT string_agg(h.name||' '||fm."homeScore"||' : '||fm."awayScore"||' '||a.name,E'\n' ORDER BY fm."scheduledAt",fm.id)
   INTO v_results FROM public."FootballMatch" fm JOIN public."Club" h ON h.id=fm."homeClubId"
   JOIN public."Club" a ON a.id=fm."awayClubId" WHERE fm."competitionId"=p_competition_id AND fm.round=p_round;
  SELECT string_agg((r.position||'. '||r.name||' · '||r.points||' امتیاز · تفاضل '||(r.gf-r.ga)),E'\n' ORDER BY r.position)
   INTO v_table FROM(SELECT row_number() OVER(ORDER BY e.points DESC,(e."goalsFor"-e."goalsAgainst") DESC,
    e."goalsFor" DESC,c.name ASC) position,c.name,e.points,e."goalsFor" gf,e."goalsAgainst" ga
    FROM public."CompetitionEntry" e JOIN public."Club" c ON c.id=e."clubId"
    WHERE e."competitionId"=p_competition_id) r;
  v_title:='نتایج هفته '||p_round||' · '||v_comp.name;
  v_body:='نتایج تمام مسابقات این هفته ثبت شد:'||E'\n'||COALESCE(v_results,'')
   ||E'\n\nجدول فعلی لیگ:'||E'\n'||COALESCE(v_table,'');
  INSERT INTO public."LeagueNotice"(id,"userId",kind,title,body,"referenceId","dedupeKey","createdAt")
  SELECT 'league_notice_'||replace(gen_random_uuid()::text,'-',''),c."ownerId",'ROUND_RESULTS',v_title,v_body,
   p_competition_id,'league-round:'||p_competition_id||':'||p_round||':'||c."ownerId",(p_now AT TIME ZONE 'UTC')
  FROM public."CompetitionEntry" e JOIN public."Club" c ON c.id=e."clubId"
  WHERE e."competitionId"=p_competition_id ON CONFLICT("dedupeKey") DO NOTHING;
  GET DIAGNOSTICS v_notices=ROW_COUNT;
 END IF;
 RETURN jsonb_build_object('competitionId',v_comp.id,'format',v_comp.format::text,'completed',v_comp_completed,
  'roundComplete',true,'nextRound',v_next,'fixturesCreated',v_created,'noticesCreated',v_notices,'replayed',false);
END;
$function$;
REVOKE ALL ON FUNCTION public.advance_competition_after_match_http(text,integer,timestamptz) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.advance_competition_after_match_http(text,integer,timestamptz) TO service_role;
 END IF;
END $grant$;
