CREATE OR REPLACE FUNCTION public.finalize_event_tournament_http(p_competition_id text,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp
AS $fn$
DECLARE v_tournament public."EventTournament"%ROWTYPE; v_comp_status text; v_part record; v_prize record;
 v_placement integer; v_score integer; v_status text; v_detail jsonb; v_asset "WalletAsset";
 v_wallet_id text; v_ledger_id text; v_inventory integer; v_special public."SpecialPlayer"%ROWTYPE;
 v_player_id text; v_owned text; v_awarded integer:=0; v_participants integer:=0; v_unsettled integer;
 v_winners text; v_rewards text; v_updated integer;
BEGIN
 IF COALESCE(btrim(p_competition_id),'')='' OR p_now IS NULL THEN RAISE EXCEPTION USING MESSAGE='INVALID_COMPETITION',ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('event-tournament-finalize:'||p_competition_id,0));
 SELECT * INTO v_tournament FROM public."EventTournament" WHERE "competitionId"=p_competition_id FOR UPDATE;
 IF NOT FOUND OR v_tournament.status::text<>'ACTIVE' THEN
  RETURN jsonb_build_object('finalized',false,'replayed',true,'participants',0,'awards',0); END IF;
 SELECT status::text INTO v_comp_status FROM public."Competition" WHERE id=p_competition_id;
 IF v_comp_status<>'COMPLETED' THEN
  SELECT count(*) INTO v_participants FROM public."EventTournamentParticipant" WHERE "tournamentId"=v_tournament.id;
  RETURN jsonb_build_object('finalized',false,'replayed',false,'participants',v_participants,'awards',0); END IF;
 FOR v_part IN
  SELECT p.id,p."userId",p."clubId",p."prizeSettledAt",
   s.placement,s.points
  FROM public."EventTournamentParticipant" p
  LEFT JOIN LATERAL (
   SELECT ranked.position AS placement,ranked.points FROM (
    SELECT ce."clubId",ce.points,row_number() OVER(ORDER BY ce.points DESC,
     (ce."goalsFor"-ce."goalsAgainst") DESC,ce."goalsFor" DESC,c.name ASC) AS position
    FROM public."CompetitionEntry" ce JOIN public."Club" c ON c.id=ce."clubId"
    WHERE ce."competitionId"=p_competition_id
   ) ranked WHERE ranked."clubId"=p."clubId"
  ) s ON true
  WHERE p."tournamentId"=v_tournament.id ORDER BY p."joinedAt",p.id FOR UPDATE OF p
 LOOP
  v_participants:=v_participants+1;
  IF v_part."prizeSettledAt" IS NOT NULL THEN CONTINUE; END IF;
  IF v_part.placement IS NULL THEN RAISE EXCEPTION USING MESSAGE='EVENT_TOURNAMENT_STANDING_MISSING',ERRCODE='P0001'; END IF;
  UPDATE public."EventTournamentParticipant" SET placement=v_part.placement,score=v_part.points
   WHERE id=v_part.id;
  FOR v_prize IN SELECT * FROM public."EventTournamentPrize"
   WHERE "tournamentId"=v_tournament.id AND
    (placement=v_part.placement OR (v_part.placement>3 AND placement=0))
   ORDER BY "createdAt",id
  LOOP
   IF EXISTS(SELECT 1 FROM public."EventTournamentPrizeAward" WHERE "participantId"=v_part.id AND "prizeId"=v_prize.id) THEN
    CONTINUE;
   END IF;
   v_status:='AWARDED';v_detail:='{}'::jsonb;
   IF v_prize.type::text IN('CASH','GOLD','HONOR') THEN
    v_asset:=v_prize.type::text::"WalletAsset";
    INSERT INTO public."Wallet"(id,"userId",asset,balance,version,"createdAt","updatedAt")
    VALUES('wallet_'||replace(gen_random_uuid()::text,'-',''),v_part."userId",v_asset,0,0,
     (p_now AT TIME ZONE 'UTC'),(p_now AT TIME ZONE 'UTC'))
    ON CONFLICT("userId",asset) DO NOTHING;
    INSERT INTO public."LedgerTransaction"(id,"idempotencyKey","userId",asset,direction,amount,reason,"referenceType","referenceId","createdAt")
    VALUES('ledger_'||replace(gen_random_uuid()::text,'-',''),
     'event-tournament-prize:'||v_tournament.id||':'||v_part.id||':'||v_prize.id,
     v_part."userId",v_asset,'CREDIT',v_prize.amount,'EVENT_TOURNAMENT_PRIZE','event-tournament',v_tournament.id,
     (p_now AT TIME ZONE 'UTC'))
    ON CONFLICT("idempotencyKey") DO NOTHING RETURNING id INTO v_ledger_id;
    IF v_ledger_id IS NOT NULL THEN
     UPDATE public."Wallet" SET balance=balance+v_prize.amount,version=version+1,"updatedAt"=(p_now AT TIME ZONE 'UTC')
     WHERE "userId"=v_part."userId" AND asset=v_asset;
    END IF;
    v_detail:=jsonb_build_object('asset',v_asset::text,'amount',v_prize.amount::text);
   ELSIF v_prize.type::text='STORE_ITEM' THEN
    IF COALESCE(v_prize."itemKey",'')='' THEN RAISE EXCEPTION USING MESSAGE='TOURNAMENT_STORE_ITEM_KEY_MISSING',ERRCODE='P0001'; END IF;
    INSERT INTO public."StoreInventoryItem"(id,"userId","itemKey",quantity,"createdAt","updatedAt")
    VALUES('inventory_'||replace(gen_random_uuid()::text,'-',''),v_part."userId",v_prize."itemKey",1,
     (p_now AT TIME ZONE 'UTC'),(p_now AT TIME ZONE 'UTC'))
    ON CONFLICT("userId","itemKey") DO UPDATE SET quantity=public."StoreInventoryItem".quantity+1,"updatedAt"=EXCLUDED."updatedAt"
    RETURNING quantity INTO v_inventory;
    v_detail:=jsonb_build_object('itemKey',v_prize."itemKey",'quantity',v_inventory);
   ELSE
    IF v_prize."specialPlayerId" IS NULL THEN RAISE EXCEPTION USING MESSAGE='TOURNAMENT_SPECIAL_PLAYER_MISSING',ERRCODE='P0001'; END IF;
    SELECT * INTO v_special FROM public."SpecialPlayer" WHERE id=v_prize."specialPlayerId" FOR SHARE;
    IF NOT FOUND OR NOT v_special.active THEN RAISE EXCEPTION USING MESSAGE='SPECIAL_PLAYER_NOT_AVAILABLE',ERRCODE='P0001'; END IF;
    SELECT id INTO v_owned FROM public."Player" WHERE "clubId"=v_part."clubId" AND "specialPlayerId"=v_special.id LIMIT 1;
    IF v_owned IS NOT NULL THEN
     v_status:='SKIPPED_ALREADY_OWNED';
    ELSE
     v_player_id:='player_'||replace(gen_random_uuid()::text,'-','');
     INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,
      "marketValue",attributes,wage,"contractDays",origin,status,"specialPlayerId","createdAt","updatedAt")
     VALUES(v_player_id,v_part."clubId",COALESCE(NULLIF(split_part(btrim(v_special."fullName"),' ',1),''),v_special."fullName"),
      COALESCE(NULLIF(regexp_replace(btrim(v_special."fullName"),'^\S+\s*','',''),''),'Legend'),
      v_special.nationality,
      CASE WHEN v_special."birthDate" IS NULL THEN 28 ELSE GREATEST(16,extract(year FROM age((p_now AT TIME ZONE 'UTC')::date,v_special."birthDate"::date))::integer) END,
      COALESCE((SELECT x FROM unnest(v_special.positions) WITH ORDINALITY AS pos(x,n)
       WHERE x=ANY(ARRAY['GK','RB','LB','CB','CDM','CM','CAM','RW','LW','ST']) ORDER BY n LIMIT 1),'ST')::"PlayerPosition",
      v_special.overall,v_special.potential,v_special.overall::bigint*10000,v_special.attributes,
      v_special.overall::bigint*50,365,'SPECIAL'::"PlayerOrigin",'ACTIVE'::"PlayerStatus",v_special.id,
      (p_now AT TIME ZONE 'UTC'),(p_now AT TIME ZONE 'UTC'));
     INSERT INTO public."SpecialPlayerAcquisition"(id,"idempotencyKey","userId","clubId","specialPlayerId","playerId",method,asset,amount,"createdAt")
     VALUES('special_acquisition_'||replace(gen_random_uuid()::text,'-',''),
      'event-tournament-special:'||v_tournament.id||':'||v_part.id||':'||v_prize.id,
      v_part."userId",v_part."clubId",v_special.id,v_player_id,'EVENT_TOURNAMENT','HONOR',0,(p_now AT TIME ZONE 'UTC'));
     v_detail:=jsonb_build_object('specialPlayerId',v_special.id,'playerId',v_player_id);
    END IF;
   END IF;
   INSERT INTO public."EventTournamentPrizeAward"(id,"participantId","prizeId",status,detail,"createdAt")
   VALUES('event_prize_award_'||replace(gen_random_uuid()::text,'-',''),v_part.id,v_prize.id,v_status,v_detail,(p_now AT TIME ZONE 'UTC'))
   ON CONFLICT("participantId","prizeId") DO NOTHING;
   IF v_status='AWARDED' THEN v_awarded:=v_awarded+1; END IF;
  END LOOP;
  UPDATE public."EventTournamentParticipant" SET "prizeSettledAt"=(p_now AT TIME ZONE 'UTC') WHERE id=v_part.id;
 END LOOP;
 SELECT count(*) INTO v_unsettled FROM public."EventTournamentParticipant"
 WHERE "tournamentId"=v_tournament.id AND "prizeSettledAt" IS NULL;
 IF v_unsettled>0 THEN
  RETURN jsonb_build_object('finalized',false,'replayed',false,'participants',v_participants,'awards',v_awarded); END IF;
 SELECT string_agg((r.position||'. '||r.name||' · '||r.points||' امتیاز'),E'\n' ORDER BY r.position)
 INTO v_winners FROM (
  SELECT row_number() OVER(ORDER BY ce.points DESC,(ce."goalsFor"-ce."goalsAgainst") DESC,
   ce."goalsFor" DESC,c.name ASC) position,c.name,ce.points
  FROM public."CompetitionEntry" ce JOIN public."Club" c ON c.id=ce."clubId"
  WHERE ce."competitionId"=p_competition_id
 ) r WHERE r.position<=3;
 UPDATE public."EventTournament" SET status='COMPLETED',"finalizedAt"=(p_now AT TIME ZONE 'UTC'),
  "endsAt"=COALESCE("endsAt",(p_now AT TIME ZONE 'UTC')),"updatedAt"=(p_now AT TIME ZONE 'UTC')
 WHERE id=v_tournament.id AND status='ACTIVE';
 GET DIAGNOSTICS v_updated=ROW_COUNT;
 IF v_updated<>1 THEN RETURN jsonb_build_object('finalized',false,'replayed',true,'participants',v_participants,'awards',v_awarded); END IF;
 FOR v_part IN SELECT p.id,p."userId",p."clubId",p.placement FROM public."EventTournamentParticipant" p
  WHERE p."tournamentId"=v_tournament.id
 LOOP
  SELECT string_agg(CASE WHEN pr.type::text IN('CASH','GOLD','HONOR') THEN pr.type::text||' · '||pr.amount::text
   WHEN pr.type::text='STORE_ITEM' THEN 'آیتم فروشگاه · '||COALESCE(pr."itemKey",'')
   ELSE 'بازیکن ویژه' END,'، ' ORDER BY pr."createdAt",pr.id)
  INTO v_rewards FROM public."EventTournamentPrize" pr WHERE pr."tournamentId"=v_tournament.id
   AND (pr.placement=v_part.placement OR (v_part.placement>3 AND pr.placement=0));
  INSERT INTO public."LeagueNotice"(id,"userId",kind,title,body,"referenceId","dedupeKey","createdAt")
  VALUES('league_notice_'||replace(gen_random_uuid()::text,'-',''),v_part."userId",'EVENT_TOURNAMENT_RESULT',
   'نتیجه نهایی تورنمنت «'||v_tournament.title||'»',
   'تورنمنت به پایان رسید.'||E'\n'||COALESCE(v_winners,'')||E'\n\nرتبه باشگاه شما: '||COALESCE(v_part.placement,0)
    ||E'\nجوایز شما: '||COALESCE(v_rewards,'جایزه‌ای برای این رتبه تعریف نشده است.'),
   p_competition_id,'event-tournament-result:'||v_tournament.id||':'||v_part."userId",(p_now AT TIME ZONE 'UTC'))
  ON CONFLICT("dedupeKey") DO NOTHING;
 END LOOP;
 RETURN jsonb_build_object('finalized',true,'replayed',false,'participants',v_participants,'awards',v_awarded);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.process_due_event_tournament_finalizations_http(p_now timestamptz,p_limit integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp
AS $fn$
DECLARE v_row record;v_result jsonb;v_candidates integer:=0;v_finalized integer:=0;v_failed integer:=0;
BEGIN
 IF p_now IS NULL OR p_limit IS NULL OR p_limit<1 THEN RAISE EXCEPTION USING MESSAGE='INVALID_EVENT_TOURNAMENT_BATCH',ERRCODE='P0001'; END IF;
 FOR v_row IN SELECT et."competitionId" FROM public."EventTournament" et
  JOIN public."Competition" c ON c.id=et."competitionId"
  WHERE et.status::text='ACTIVE' AND c.status::text='COMPLETED'
  ORDER BY et."updatedAt" LIMIT LEAST(p_limit,10) FOR UPDATE OF et SKIP LOCKED
 LOOP
  v_candidates:=v_candidates+1;
  v_result:=public.finalize_event_tournament_http(v_row."competitionId",p_now);
  IF COALESCE((v_result->>'finalized')::boolean,false) THEN v_finalized:=v_finalized+1; END IF;
 END LOOP;
 RETURN jsonb_build_object('candidates',v_candidates,'finalized',v_finalized,'failed',v_failed);
END;
$fn$;

REVOKE ALL ON FUNCTION public.finalize_event_tournament_http(text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.process_due_event_tournament_finalizations_http(timestamptz,integer) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.finalize_event_tournament_http(text,timestamptz) TO service_role;
  GRANT EXECUTE ON FUNCTION public.process_due_event_tournament_finalizations_http(timestamptz,integer) TO service_role;
 END IF;
END;
$grant$;
