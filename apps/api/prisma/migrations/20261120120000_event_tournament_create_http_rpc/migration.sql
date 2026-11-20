-- Atomic event-tournament creation for the Node Supabase HTTP runtime.
CREATE OR REPLACE FUNCTION public.create_event_tournament_http(
 p_telegram_user_id text,p_idempotency_key text,p_title text,p_description text,
 p_entry_fee_asset text,p_entry_fee_amount bigint,p_max_participants integer,
 p_registration_ends_at timestamptz,p_starts_at timestamptz,p_ends_at timestamptz,
 p_prizes jsonb,p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp
AS $fn$
DECLARE v_tournament public."EventTournament"%ROWTYPE;v_prize record;v_expected jsonb;v_existing jsonb;
 v_created integer:=0;v_type text;v_amount bigint;v_item text;v_special text;v_placement integer;
BEGIN
 IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$'
  OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^event-tournament-create:[A-Za-z0-9:_-]{12,128}$'
  OR p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 3 AND 100
  OR p_description IS NULL OR length(btrim(p_description)) NOT BETWEEN 5 AND 2000
  OR p_entry_fee_amount IS NULL OR p_entry_fee_amount<0
  OR (p_entry_fee_amount>0 AND (p_entry_fee_asset IS NULL OR p_entry_fee_asset NOT IN('CASH','GOLD','HONOR')))
  OR (p_entry_fee_asset IS NOT NULL AND p_entry_fee_asset NOT IN('CASH','GOLD','HONOR'))
  OR p_max_participants IS NULL OR p_max_participants NOT BETWEEN 4 AND 16
  OR p_registration_ends_at IS NULL OR p_starts_at IS NULL OR p_now IS NULL
  OR p_registration_ends_at<=p_now OR p_starts_at<p_registration_ends_at
  OR (p_ends_at IS NOT NULL AND p_ends_at<=p_starts_at)
  OR p_prizes IS NULL OR jsonb_typeof(p_prizes)<>'array' OR jsonb_array_length(p_prizes) NOT BETWEEN 1 AND 12
 THEN RAISE EXCEPTION USING MESSAGE='INVALID_EVENT_TOURNAMENT',ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
 SELECT COALESCE(jsonb_agg(jsonb_build_object('placement',x.placement,'type',x.type,
  'amount',COALESCE(x.amount,'0'),'itemKey',x."itemKey",'specialPlayerId',x."specialPlayerId")
  ORDER BY x.placement,x.type,COALESCE(x."itemKey",''),COALESCE(x."specialPlayerId",'')),'[]'::jsonb)
 INTO v_expected FROM jsonb_to_recordset(p_prizes) AS x(
  placement integer,type text,amount text,"itemKey" text,"specialPlayerId" text);
 FOR v_prize IN SELECT * FROM jsonb_to_recordset(p_prizes) AS x(
  placement integer,type text,amount text,"itemKey" text,"specialPlayerId" text)
 LOOP
  v_placement:=v_prize.placement;v_type:=v_prize.type;
  IF v_placement IS NULL OR v_placement NOT BETWEEN 0 AND 3
   OR v_type NOT IN('CASH','GOLD','HONOR','STORE_ITEM','SPECIAL_PLAYER')
   OR COALESCE(v_prize.amount,'0') !~ '^(0|[1-9][0-9]{0,17})$'
  THEN RAISE EXCEPTION USING MESSAGE='INVALID_TOURNAMENT_PRIZE',ERRCODE='22023'; END IF;
  v_amount:=COALESCE(v_prize.amount,'0')::bigint;v_item:=v_prize."itemKey";v_special:=v_prize."specialPlayerId";
  IF v_type IN('CASH','GOLD','HONOR') AND v_amount<=0 THEN RAISE EXCEPTION USING MESSAGE='INVALID_TOURNAMENT_PRIZE_AMOUNT',ERRCODE='22023'; END IF;
  IF v_type='STORE_ITEM' AND (v_item IS NULL OR length(btrim(v_item)) NOT BETWEEN 2 AND 80) THEN RAISE EXCEPTION USING MESSAGE='STORE_ITEM_NOT_AVAILABLE',ERRCODE='P0001'; END IF;
  IF v_type='SPECIAL_PLAYER' AND (v_special IS NULL OR NOT EXISTS(SELECT 1 FROM public."SpecialPlayer" WHERE id=v_special AND active)) THEN
   RAISE EXCEPTION USING MESSAGE='SPECIAL_PLAYER_NOT_AVAILABLE',ERRCODE='P0001'; END IF;
  IF v_type<>'STORE_ITEM' AND v_item IS NOT NULL OR v_type<>'SPECIAL_PLAYER' AND v_special IS NOT NULL THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_TOURNAMENT_PRIZE',ERRCODE='22023'; END IF;
 END LOOP;
 SELECT * INTO v_tournament FROM public."EventTournament" WHERE "idempotencyKey"=p_idempotency_key FOR UPDATE;
 IF FOUND THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('placement',placement,'type',type::text,
   'amount',amount::text,'itemKey',"itemKey",'specialPlayerId',"specialPlayerId")
   ORDER BY placement,type::text,COALESCE("itemKey",''),COALESCE("specialPlayerId",'')),'[]'::jsonb)
  INTO v_existing FROM public."EventTournamentPrize" WHERE "tournamentId"=v_tournament.id;
  IF v_tournament."createdByTelegramId" IS DISTINCT FROM p_telegram_user_id
   OR v_tournament.title IS DISTINCT FROM btrim(p_title)
   OR v_tournament.description IS DISTINCT FROM btrim(p_description)
   OR v_tournament."entryFeeAsset"::text IS DISTINCT FROM p_entry_fee_asset
   OR v_tournament."entryFeeAmount" IS DISTINCT FROM p_entry_fee_amount
   OR v_tournament."maxParticipants" IS DISTINCT FROM p_max_participants
   OR v_tournament."registrationEndsAt" IS DISTINCT FROM (p_registration_ends_at AT TIME ZONE 'UTC')
   OR v_tournament."startsAt" IS DISTINCT FROM (p_starts_at AT TIME ZONE 'UTC')
   OR v_tournament."endsAt" IS DISTINCT FROM (p_ends_at AT TIME ZONE 'UTC')
   OR v_existing IS DISTINCT FROM v_expected THEN
   RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_CONFLICT',ERRCODE='P0001'; END IF;
  RETURN jsonb_build_object('tournament',to_jsonb(v_tournament),'replayed',true);
 END IF;
 INSERT INTO public."EventTournament"(id,"idempotencyKey",title,description,status,"entryFeeAsset","entryFeeAmount",
  "maxParticipants","registrationEndsAt","startsAt","endsAt","createdByTelegramId","createdAt","updatedAt")
 VALUES('event_tournament_'||replace(gen_random_uuid()::text,'-',''),p_idempotency_key,btrim(p_title),btrim(p_description),
  'REGISTRATION',p_entry_fee_asset::"WalletAsset",p_entry_fee_amount,p_max_participants,
  p_registration_ends_at AT TIME ZONE 'UTC',p_starts_at AT TIME ZONE 'UTC',p_ends_at AT TIME ZONE 'UTC',
  p_telegram_user_id,p_now AT TIME ZONE 'UTC',p_now AT TIME ZONE 'UTC')
 RETURNING * INTO v_tournament;
 FOR v_prize IN SELECT * FROM jsonb_to_recordset(p_prizes) AS x(
  placement integer,type text,amount text,"itemKey" text,"specialPlayerId" text)
 LOOP
  INSERT INTO public."EventTournamentPrize"(id,"tournamentId",placement,type,amount,"itemKey","specialPlayerId","createdAt")
  VALUES('event_tournament_prize_'||replace(gen_random_uuid()::text,'-',''),v_tournament.id,
   v_prize.placement,v_prize.type::"EventTournamentPrizeType",COALESCE(v_prize.amount,'0')::bigint,
   v_prize."itemKey",v_prize."specialPlayerId",p_now AT TIME ZONE 'UTC');
  v_created:=v_created+1;
 END LOOP;
 INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId","idempotencyKey",metadata,"createdAt")
 VALUES('admin_audit_'||replace(gen_random_uuid()::text,'-',''),p_telegram_user_id,'create-event-tournament',
  'event-tournament',v_tournament.id,'event-tournament-audit:'||substr(p_idempotency_key,length('event-tournament-create:')+1),
  jsonb_build_object('title',v_tournament.title,'prizeCount',v_created),p_now AT TIME ZONE 'UTC');
 RETURN jsonb_build_object('tournament',to_jsonb(v_tournament),'replayed',false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.create_event_tournament_http(text,text,text,text,text,bigint,integer,timestamptz,timestamptz,timestamptz,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT SELECT,INSERT ON TABLE public."EventTournament",public."EventTournamentPrize",public."AdminAuditLog" TO service_role;
  GRANT SELECT ON TABLE public."SpecialPlayer" TO service_role;
  GRANT EXECUTE ON FUNCTION public.create_event_tournament_http(text,text,text,text,text,bigint,integer,timestamptz,timestamptz,timestamptz,jsonb,timestamptz) TO service_role;
 END IF;
END;
$grant$;
