-- Legacy special-player challenge reads and reward claims run fully inside Supabase.
CREATE OR REPLACE FUNCTION public.list_legacy_special_challenges(p_user_id text)
RETURNS TABLE(challenges jsonb)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE v_club_id text; v_challenges jsonb;
BEGIN
  SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId" = p_user_id;
  IF v_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001'; END IF;
  WITH defs(slug,title,description,player_slug,reward_name,req_matches,req_wins,req_goals,req_position) AS (
    VALUES
      ('pele-king-of-football','پادشاه فوتبال','در ۸۰ مسابقه شرکت کن و دست‌کم ۵۰ پیروزی به دست بیاور.','pele','پله',80,50,0,NULL::text),
      ('maradona-hand-of-god','جادوی شماره ۱۰','در ۵۰ مسابقه شرکت کن، ۳۰ بار پیروز شو و با بازیکنان هافبک هجومی ۲۵ گل بزن.','diego-maradona','دیه‌گو مارادونا',50,30,25,'CAM'),
      ('van-basten-golden-boot','کفش طلایی','در ۴۰ مسابقه شرکت کن، ۱۵ برد به دست بیاور و با مهاجمان نوک ۳۰ گل ثبت کن.','marco-van-basten','مارکو فان‌باستن',40,15,30,'ST')
  ), progress AS (
    SELECT d.*, (SELECT count(*) FROM public."FootballMatch" m WHERE m.status::text='COMPLETED' AND (m."homeClubId"=v_club_id OR m."awayClubId"=v_club_id))::int matches,
      (SELECT count(*) FROM public."FootballMatch" m WHERE m.status::text='COMPLETED' AND m."winnerClubId"=v_club_id)::int wins,
      COALESCE((SELECT sum(pm.goals) FROM public."PlayerMatchPerformance" pm JOIN public."Player" p ON p.id=pm."playerId"
        WHERE pm."clubId"=v_club_id AND (d.req_position IS NULL OR p.position::text=d.req_position)),0)::int goals
    FROM defs d
  )
  SELECT jsonb_agg(jsonb_build_object(
    'slug',p.slug,'title',p.title,'description',p.description,'rewardName',p.reward_name,
    'progress',jsonb_build_object('matches',p.matches,'wins',p.wins,'goals',p.goals,'requiredMatches',p.req_matches,'requiredWins',p.req_wins,'requiredGoals',p.req_goals,
      'completed',p.matches>=p.req_matches AND p.wins>=p.req_wins AND p.goals>=p.req_goals),
    'claimed',a.id IS NOT NULL,'available',COALESCE(sp.active,FALSE) AND (SELECT count(*) FROM public."SpecialPlayerAcquisition" x WHERE x."specialPlayerId"=sp.id)<1,
    'canClaim',p.matches>=p.req_matches AND p.wins>=p.req_wins AND p.goals>=p.req_goals AND a.id IS NULL AND COALESCE(sp.active,FALSE)
      AND (SELECT count(*) FROM public."SpecialPlayerAcquisition" x WHERE x."specialPlayerId"=sp.id)<1
  ) ORDER BY p.slug) INTO v_challenges
  FROM progress p
  LEFT JOIN public."SpecialPlayer" sp ON sp.slug=p.player_slug
  LEFT JOIN public."SpecialPlayerAcquisition" a ON a."idempotencyKey"='legacy-challenge:'||p_user_id||':'||p.slug;
  RETURN QUERY SELECT COALESCE(v_challenges,'[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_legacy_special_challenge(p_user_id text,p_slug text)
RETURNS TABLE(result jsonb)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_club_id text; v_key text; v_req_matches int; v_req_wins int; v_req_goals int; v_position text;
  v_player_slug text; v_special public."SpecialPlayer"%ROWTYPE; v_matches int; v_wins int; v_goals int;
  v_previous public."SpecialPlayerAcquisition"%ROWTYPE; v_player_id text; v_acquisition_id text;
BEGIN
  CASE p_slug
    WHEN 'pele-king-of-football' THEN v_player_slug:='pele'; v_req_matches:=80; v_req_wins:=50; v_req_goals:=0; v_position:=NULL;
    WHEN 'maradona-hand-of-god' THEN v_player_slug:='diego-maradona'; v_req_matches:=50; v_req_wins:=30; v_req_goals:=25; v_position:='CAM';
    WHEN 'van-basten-golden-boot' THEN v_player_slug:='marco-van-basten'; v_req_matches:=40; v_req_wins:=15; v_req_goals:=30; v_position:='ST';
    ELSE RAISE EXCEPTION USING MESSAGE='LEGACY_CHALLENGE_NOT_FOUND', ERRCODE='P0001';
  END CASE;
  v_key:='legacy-challenge:'||p_user_id||':'||p_slug;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key,0));
  SELECT * INTO v_previous FROM public."SpecialPlayerAcquisition" WHERE "idempotencyKey"=v_key;
  IF FOUND THEN
    IF v_previous."userId"<>p_user_id OR v_previous.method<>'legacy_event' THEN
      RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_CONFLICT', ERRCODE='P0001';
    END IF;
    RETURN QUERY SELECT jsonb_build_object('acquisitionId',v_previous.id,'playerId',v_previous."playerId",
      'specialPlayer',jsonb_build_object('id',sp.id,'fullName',sp."fullName",'rarity',sp.rarity::text,'overall',sp.overall),'replayed',true)
      FROM public."SpecialPlayer" sp WHERE sp.id=v_previous."specialPlayerId";
    RETURN;
  END IF;
  SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId"=p_user_id;
  IF v_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE='CLUB_NOT_FOUND', ERRCODE='P0001'; END IF;
  SELECT count(*) INTO v_matches FROM public."FootballMatch" m WHERE m.status::text='COMPLETED' AND (m."homeClubId"=v_club_id OR m."awayClubId"=v_club_id);
  SELECT count(*) INTO v_wins FROM public."FootballMatch" m WHERE m.status::text='COMPLETED' AND m."winnerClubId"=v_club_id;
  SELECT COALESCE(sum(pm.goals),0)::int INTO v_goals FROM public."PlayerMatchPerformance" pm
    JOIN public."Player" p ON p.id=pm."playerId" WHERE pm."clubId"=v_club_id AND (v_position IS NULL OR p.position::text=v_position);
  IF v_matches<v_req_matches OR v_wins<v_req_wins OR v_goals<v_req_goals THEN
    RAISE EXCEPTION USING MESSAGE='LEGACY_CHALLENGE_NOT_COMPLETED', ERRCODE='P0001';
  END IF;
  SELECT * INTO v_special FROM public."SpecialPlayer" WHERE slug=v_player_slug FOR UPDATE;
  IF NOT FOUND OR NOT v_special.active OR NOT (v_special."acquisitionMethods" @> ARRAY['legacy_event']::text[]) THEN
    RAISE EXCEPTION USING MESSAGE='LEGACY_REWARD_NOT_AVAILABLE', ERRCODE='P0001';
  END IF;
  IF EXISTS(SELECT 1 FROM public."SpecialPlayerAcquisition" WHERE "specialPlayerId"=v_special.id) THEN
    RAISE EXCEPTION USING MESSAGE='LEGACY_REWARD_ALREADY_CLAIMED', ERRCODE='P0001';
  END IF;
  INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,wage,"contractDays",origin,status,"specialPlayerId","createdAt","updatedAt")
  VALUES(gen_random_uuid()::text,v_club_id,split_part(trim(v_special."fullName"),' ',1),
    COALESCE(NULLIF(btrim(substr(trim(v_special."fullName"),length(split_part(trim(v_special."fullName"),' ',1))+1)),''),'Legend'),
    v_special.nationality,28,COALESCE(v_special.positions[1],'ST')::public."PlayerPosition",v_special.overall,v_special.potential,
    v_special.attributes,(v_special.overall*3)::bigint,365,'SPECIAL','ACTIVE',v_special.id,NOW(),NOW())
  RETURNING id INTO v_player_id;
  INSERT INTO public."SpecialPlayerAcquisition"(id,"idempotencyKey","userId","clubId","specialPlayerId","playerId",method,asset,amount,"createdAt")
  VALUES(gen_random_uuid()::text,v_key,p_user_id,v_club_id,v_special.id,v_player_id,'legacy_event','GOLD',0,NOW())
  RETURNING id INTO v_acquisition_id;
  RETURN QUERY SELECT jsonb_build_object('acquisitionId',v_acquisition_id,'playerId',v_player_id,
    'specialPlayer',jsonb_build_object('id',v_special.id,'fullName',v_special."fullName",'rarity',v_special.rarity::text,'overall',v_special.overall),'replayed',false);
END;
$function$;
REVOKE ALL ON FUNCTION public.list_legacy_special_challenges(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_legacy_special_challenge(text,text) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.list_legacy_special_challenges(text) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.claim_legacy_special_challenge(text,text) TO service_role';
 END IF;
END; $grant$;
