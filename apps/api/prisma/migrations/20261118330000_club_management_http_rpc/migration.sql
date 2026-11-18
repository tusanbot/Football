CREATE OR REPLACE FUNCTION public.club_management_command(
 p_action text, p_user_id text, p_idempotency_key text, p_payload jsonb, p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
 c public."Club"%ROWTYPE;
 w public."Wallet"%ROWTYPE;
 prior public."LedgerTransaction"%ROWTYPE;
 amount bigint;
 reason text;
 expected_reason text;
 category text;
 description text;
 current_level integer;
 next_level integer;
 coach_row public."Coach"%ROWTYPE;
 sponsor_id text;
 prospect_row public."AcademyProspect"%ROWTYPE;
 player_id text;
 candidate_name text;
 result jsonb;
 prospect jsonb;
BEGIN
 IF p_user_id IS NULL OR length(p_user_id) NOT BETWEEN 1 AND 128
   OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$'
   OR p_payload IS NULL OR p_now IS NULL THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_COMMAND', ERRCODE='22023';
 END IF;
 SELECT * INTO c FROM public."Club" WHERE "ownerId"=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='CLUB_NOT_FOUND', ERRCODE='P0002'; END IF;
 expected_reason := CASE p_action
   WHEN 'UPGRADE_FACILITY' THEN 'CLUB_FACILITY_UPGRADE:'||(p_payload->>'facility')
   WHEN 'UPGRADE_COACH' THEN 'COACH_UPGRADE'
   WHEN 'HIRE_COACH' THEN 'COACH_HIRING:'||(p_payload->>'candidateId')
   WHEN 'SIGN_SPONSOR' THEN 'SPONSOR_CONTRACT_SIGNING:'||(p_payload->>'offerId')
   WHEN 'SCOUT_ACADEMY' THEN 'ACADEMY_SCOUTING'
   WHEN 'RECRUIT_PROSPECT' THEN 'ACADEMY_PROSPECT_RECRUITMENT:'||(p_payload->>'prospectId')
   ELSE NULL END;
 IF expected_reason IS NULL THEN RAISE EXCEPTION USING MESSAGE='UNSUPPORTED_CLUB_ACTION', ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM public."LedgerTransaction" WHERE "idempotencyKey"='club-op:'||p_idempotency_key;
 IF FOUND THEN
   IF prior."userId"<>p_user_id OR prior.reason<>expected_reason THEN RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_CONFLICT', ERRCODE='23505'; END IF;
   CASE p_action
    WHEN 'SCOUT_ACADEMY' THEN
      SELECT jsonb_agg(jsonb_build_object('id',id,'firstName',"firstName",'lastName',"lastName",'age',age,'position',position::text,'overall',overall,'potential',potential,'recruitmentCost',"recruitmentCost"::text) ORDER BY id)
      INTO result FROM public."AcademyProspect" WHERE "clubId"=c.id AND "scoutingBatchKey"=p_idempotency_key;
      RETURN jsonb_build_object('prospects',coalesce(result,'[]'::jsonb),'scoutingCost',prior.amount::text,'replayed',true);
    WHEN 'RECRUIT_PROSPECT' THEN
      SELECT * INTO prospect_row FROM public."AcademyProspect" WHERE id=p_payload->>'prospectId' AND "clubId"=c.id;
      IF FOUND AND prospect_row."recruitedPlayerId" IS NOT NULL THEN
       SELECT id INTO player_id FROM public."Player" WHERE id=prospect_row."recruitedPlayerId";
       RETURN jsonb_build_object('prospectId',prospect_row.id,'player',jsonb_build_object('id',player_id,'firstName',prospect_row."firstName",'lastName',prospect_row."lastName",'position',prospect_row.position::text,'overall',prospect_row.overall,'potential',prospect_row.potential),'cost',prior.amount::text,'replayed',true);
      END IF;
      RETURN jsonb_build_object('prospectId',p_payload->>'prospectId','cost',prior.amount::text,'replayed',true);
    ELSE RETURN jsonb_build_object('replayed',true);
   END CASE;
 END IF;

 IF p_action='UPGRADE_FACILITY' THEN
   IF p_payload->>'facility' NOT IN ('STADIUM','TRAINING_GROUND','ACADEMY') THEN RAISE EXCEPTION USING MESSAGE='INVALID_FACILITY', ERRCODE='22023'; END IF;
   current_level := CASE p_payload->>'facility' WHEN 'STADIUM' THEN c."stadiumLevel" WHEN 'TRAINING_GROUND' THEN c."trainingGroundLevel" ELSE c."academyLevel" END;
   IF current_level>=10 THEN RAISE EXCEPTION USING MESSAGE='FACILITY_MAX_LEVEL', ERRCODE='22023'; END IF;
   next_level:=current_level+1;
   amount := (CASE p_payload->>'facility' WHEN 'STADIUM' THEN 4000 WHEN 'TRAINING_GROUND' THEN 2500 ELSE 3500 END)
      * (CASE WHEN p_payload->>'facility'='ACADEMY' THEN greatest(1,current_level) ELSE current_level END)
      * (CASE WHEN p_payload->>'facility'='ACADEMY' THEN greatest(1,current_level) ELSE current_level END);
   reason:='CLUB_FACILITY_UPGRADE:'||(p_payload->>'facility'); category:='FACILITY_UPGRADE';
   description:=(p_payload->>'facility')||' upgraded to level '||next_level::text;
   SELECT * INTO w FROM public."Wallet" WHERE "userId"=p_user_id AND asset='CASH' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='WALLET_NOT_FOUND', ERRCODE='P0002'; END IF;
   IF w.balance<amount THEN RAISE EXCEPTION USING MESSAGE='INSUFFICIENT_CASH', ERRCODE='22023'; END IF;
   UPDATE public."Wallet" SET balance=balance-amount,version=version+1,"updatedAt"=p_now WHERE id=w.id;
   INSERT INTO public."LedgerTransaction"(id,"idempotencyKey","userId",asset,direction,amount,reason,"referenceType","referenceId","createdAt")
   VALUES(gen_random_uuid()::text,'club-op:'||p_idempotency_key,p_user_id,'CASH','DEBIT',amount,reason,'CLUB_OPERATIONS',c.id,p_now);
   INSERT INTO public."ClubFinanceEntry"(id,"idempotencyKey","clubId",category,direction,amount,description,"occurredAt")
   VALUES(gen_random_uuid()::text,'club-finance:'||p_idempotency_key,c.id,category,'DEBIT',amount,description,p_now);
   IF p_payload->>'facility'='STADIUM' THEN UPDATE public."Club" SET "stadiumLevel"=next_level,"updatedAt"=p_now WHERE id=c.id;
   ELSIF p_payload->>'facility'='TRAINING_GROUND' THEN UPDATE public."Club" SET "trainingGroundLevel"=next_level,"updatedAt"=p_now WHERE id=c.id;
   ELSE UPDATE public."Club" SET "academyLevel"=next_level,"updatedAt"=p_now WHERE id=c.id; END IF;
   RETURN jsonb_build_object('facility',p_payload->>'facility','level',next_level,'cost',amount::text,'replayed',false);

 ELSIF p_action IN ('UPGRADE_COACH','HIRE_COACH') THEN
   IF p_action='UPGRADE_COACH' THEN
     SELECT * INTO coach_row FROM public."Coach" WHERE "clubId"=c.id FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='COACH_NOT_FOUND', ERRCODE='P0002'; END IF;
     IF coach_row.level>=10 THEN RAISE EXCEPTION USING MESSAGE='COACH_MAX_LEVEL', ERRCODE='22023'; END IF;
     amount:=1500*coach_row.level*coach_row.level;
     reason:='COACH_UPGRADE'; category:='COACH_DEVELOPMENT'; description:='Coach skill development';
   ELSE
     candidate_name:=p_payload->>'name';
     amount:=(p_payload->>'signingFee')::bigint;
     IF candidate_name IS NULL OR amount<=0 THEN RAISE EXCEPTION USING MESSAGE='INVALID_COACH_CANDIDATE', ERRCODE='22023'; END IF;
     reason:='COACH_HIRING:'||(p_payload->>'candidateId'); category:='COACH_SIGNING'; description:='Hired '||candidate_name;
   END IF;
   SELECT * INTO w FROM public."Wallet" WHERE "userId"=p_user_id AND asset='CASH' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='WALLET_NOT_FOUND', ERRCODE='P0002'; END IF;
   IF w.balance<amount THEN RAISE EXCEPTION USING MESSAGE='INSUFFICIENT_CASH', ERRCODE='22023'; END IF;
   UPDATE public."Wallet" SET balance=balance-amount,version=version+1,"updatedAt"=p_now WHERE id=w.id;
   INSERT INTO public."LedgerTransaction"(id,"idempotencyKey","userId",asset,direction,amount,reason,"referenceType","referenceId","createdAt")
   VALUES(gen_random_uuid()::text,'club-op:'||p_idempotency_key,p_user_id,'CASH','DEBIT',amount,reason,'CLUB_OPERATIONS',c.id,p_now);
   INSERT INTO public."ClubFinanceEntry"(id,"idempotencyKey","clubId",category,direction,amount,description,"occurredAt")
   VALUES(gen_random_uuid()::text,'club-finance:'||p_idempotency_key,c.id,category,'DEBIT',amount,description,p_now);
   IF p_action='UPGRADE_COACH' THEN
     UPDATE public."Coach" SET level=level+1,"trainingSkill"=least(100,"trainingSkill"+5),"recoverySkill"=least(100,"recoverySkill"+5),"medicalSkill"=least(100,"medicalSkill"+5),"weeklySalary"="weeklySalary"+40,"updatedAt"=p_now WHERE id=coach_row.id RETURNING * INTO coach_row;
     RETURN jsonb_build_object('coach',jsonb_build_object('level',coach_row.level,'trainingSkill',coach_row."trainingSkill",'recoverySkill',coach_row."recoverySkill",'medicalSkill',coach_row."medicalSkill",'weeklySalary',coach_row."weeklySalary"::text),'cost',amount::text,'replayed',false);
   END IF;
   INSERT INTO public."Coach"(id,"clubId",name,level,"trainingSkill","recoverySkill","medicalSkill","weeklySalary","createdAt","updatedAt")
   VALUES(gen_random_uuid()::text,c.id,candidate_name,1,(p_payload->>'trainingSkill')::int,(p_payload->>'recoverySkill')::int,(p_payload->>'medicalSkill')::int,(p_payload->>'weeklySalary')::bigint,p_now,p_now)
   ON CONFLICT ("clubId") DO UPDATE SET name=excluded.name,level=1,"trainingSkill"=excluded."trainingSkill","recoverySkill"=excluded."recoverySkill","medicalSkill"=excluded."medicalSkill","weeklySalary"=excluded."weeklySalary","updatedAt"=p_now
   RETURNING * INTO coach_row;
   RETURN jsonb_build_object('coach',jsonb_build_object('name',coach_row.name,'level',coach_row.level,'trainingSkill',coach_row."trainingSkill",'recoverySkill',coach_row."recoverySkill",'medicalSkill',coach_row."medicalSkill",'weeklySalary',coach_row."weeklySalary"::text),'signingFee',amount::text,'replayed',false);

 ELSIF p_action='SIGN_SPONSOR' THEN
   IF EXISTS(SELECT 1 FROM public."SponsorContract" WHERE "clubId"=c.id AND status='ACTIVE' AND "endsAt">p_now) THEN RAISE EXCEPTION USING MESSAGE='ACTIVE_SPONSOR_EXISTS', ERRCODE='23505'; END IF;
   IF c.level < (p_payload->>'minimumLevel')::int OR c.reputation < (p_payload->>'minimumReputation')::int THEN RAISE EXCEPTION USING MESSAGE='SPONSOR_OFFER_LOCKED', ERRCODE='22023'; END IF;
   amount:=(p_payload->>'signingBonus')::bigint;
   IF amount<0 OR (p_payload->>'dailyIncome')::bigint<0 OR (p_payload->>'durationDays')::int NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION USING MESSAGE='INVALID_SPONSOR_OFFER', ERRCODE='22023'; END IF;
   SELECT * INTO w FROM public."Wallet" WHERE "userId"=p_user_id AND asset='CASH' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='WALLET_NOT_FOUND', ERRCODE='P0002'; END IF;
   UPDATE public."Wallet" SET balance=balance+amount,version=version+1,"updatedAt"=p_now WHERE id=w.id;
   INSERT INTO public."LedgerTransaction"(id,"idempotencyKey","userId",asset,direction,amount,reason,"referenceType","referenceId","createdAt")
   VALUES(gen_random_uuid()::text,'club-op:'||p_idempotency_key,p_user_id,'CASH','CREDIT',amount,'SPONSOR_CONTRACT_SIGNING:'||(p_payload->>'offerId'),'CLUB_OPERATIONS',c.id,p_now);
   INSERT INTO public."ClubFinanceEntry"(id,"idempotencyKey","clubId",category,direction,amount,description,"occurredAt")
   VALUES(gen_random_uuid()::text,'club-finance:'||p_idempotency_key,c.id,'SPONSOR_SIGNING_BONUS','CREDIT',amount,'Signing bonus from '||(p_payload->>'partnerName'),p_now);
   INSERT INTO public."SponsorContract"(id,"idempotencyKey","clubId","partnerName",tier,"dailyIncome","signingBonus","startedAt","endsAt",status,"createdAt")
   VALUES(gen_random_uuid()::text,'sponsor:'||p_idempotency_key,c.id,p_payload->>'partnerName',p_payload->>'tier',(p_payload->>'dailyIncome')::bigint,amount,p_now,p_now+((p_payload->>'durationDays')::int||' days')::interval,'ACTIVE',p_now)
   RETURNING id INTO sponsor_id;
   RETURN jsonb_build_object('sponsor',jsonb_build_object('id',sponsor_id,'partnerName',p_payload->>'partnerName','tier',p_payload->>'tier','dailyIncome',p_payload->>'dailyIncome','endsAt',(p_now+((p_payload->>'durationDays')::int||' days')::interval)),'replayed',false);

 ELSIF p_action='SCOUT_ACADEMY' THEN
   IF c."academyLevel"<1 THEN RAISE EXCEPTION USING MESSAGE='ACADEMY_NOT_BUILT', ERRCODE='22023'; END IF;
   IF jsonb_typeof(p_payload->'prospects')<>'array' OR jsonb_array_length(p_payload->'prospects')<>3 THEN RAISE EXCEPTION USING MESSAGE='INVALID_SCOUTING_BATCH', ERRCODE='22023'; END IF;
   IF (SELECT count(*) FROM public."AcademyProspect" WHERE "clubId"=c.id AND status='AVAILABLE')+3>12 THEN RAISE EXCEPTION USING MESSAGE='ACADEMY_CAPACITY_REACHED', ERRCODE='22023'; END IF;
   amount:=1000+c."academyLevel"*750;
   SELECT * INTO w FROM public."Wallet" WHERE "userId"=p_user_id AND asset='CASH' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='WALLET_NOT_FOUND', ERRCODE='P0002'; END IF;
   IF w.balance<amount THEN RAISE EXCEPTION USING MESSAGE='INSUFFICIENT_CASH', ERRCODE='22023'; END IF;
   UPDATE public."Wallet" SET balance=balance-amount,version=version+1,"updatedAt"=p_now WHERE id=w.id;
   INSERT INTO public."LedgerTransaction"(id,"idempotencyKey","userId",asset,direction,amount,reason,"referenceType","referenceId","createdAt")
   VALUES(gen_random_uuid()::text,'club-op:'||p_idempotency_key,p_user_id,'CASH','DEBIT',amount,'ACADEMY_SCOUTING','CLUB_OPERATIONS',c.id,p_now);
   INSERT INTO public."ClubFinanceEntry"(id,"idempotencyKey","clubId",category,direction,amount,description,"occurredAt")
   VALUES(gen_random_uuid()::text,'club-finance:'||p_idempotency_key,c.id,'ACADEMY_SCOUTING','DEBIT',amount,'Academy scouting network',p_now);
   FOR prospect IN SELECT value FROM jsonb_array_elements(p_payload->'prospects') LOOP
     IF (prospect->>'overall')::int NOT BETWEEN 20 AND 75 OR (prospect->>'potential')::int < (prospect->>'overall')::int
       OR (prospect->>'potential')::int>99 OR prospect->>'position' NOT IN ('GK','RB','LB','CB','CDM','CM','CAM','RW','LW','ST') THEN
       RAISE EXCEPTION USING MESSAGE='INVALID_PROSPECT', ERRCODE='22023';
     END IF;
     INSERT INTO public."AcademyProspect"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,"recruitmentCost",status,"scoutingBatchKey","createdAt")
     VALUES(prospect->>'id',c.id,prospect->>'firstName',prospect->>'lastName',prospect->>'nationality',(prospect->>'age')::int,(prospect->>'position')::"PlayerPosition",
       (prospect->>'overall')::int,(prospect->>'potential')::int,prospect->'attributes',
       (prospect->>'overall')::bigint*45+(prospect->>'potential')::bigint*25+c."academyLevel"*100,'AVAILABLE',p_idempotency_key,p_now);
   END LOOP;
   SELECT jsonb_agg(jsonb_build_object('id',id,'firstName',"firstName",'lastName',"lastName",'age',age,'position',position::text,'overall',overall,'potential',potential,'recruitmentCost',"recruitmentCost"::text) ORDER BY id)
   INTO result FROM public."AcademyProspect" WHERE "clubId"=c.id AND "scoutingBatchKey"=p_idempotency_key;
   RETURN jsonb_build_object('prospects',coalesce(result,'[]'::jsonb),'scoutingCost',amount::text,'replayed',false);

 ELSIF p_action='RECRUIT_PROSPECT' THEN
   SELECT * INTO prospect_row FROM public."AcademyProspect" WHERE id=p_payload->>'prospectId' AND "clubId"=c.id AND status='AVAILABLE' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='PROSPECT_NOT_AVAILABLE', ERRCODE='P0002'; END IF;
   amount:=prospect_row."recruitmentCost";
   SELECT * INTO w FROM public."Wallet" WHERE "userId"=p_user_id AND asset='CASH' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='WALLET_NOT_FOUND', ERRCODE='P0002'; END IF;
   IF w.balance<amount THEN RAISE EXCEPTION USING MESSAGE='INSUFFICIENT_CASH', ERRCODE='22023'; END IF;
   UPDATE public."Wallet" SET balance=balance-amount,version=version+1,"updatedAt"=p_now WHERE id=w.id;
   INSERT INTO public."LedgerTransaction"(id,"idempotencyKey","userId",asset,direction,amount,reason,"referenceType","referenceId","createdAt")
   VALUES(gen_random_uuid()::text,'club-op:'||p_idempotency_key,p_user_id,'CASH','DEBIT',amount,'ACADEMY_PROSPECT_RECRUITMENT:'||prospect_row.id,'CLUB_OPERATIONS',c.id,p_now);
   INSERT INTO public."ClubFinanceEntry"(id,"idempotencyKey","clubId",category,direction,amount,description,"occurredAt")
   VALUES(gen_random_uuid()::text,'club-finance:'||p_idempotency_key,c.id,'ACADEMY_RECRUITMENT','DEBIT',amount,'Recruited '||prospect_row."firstName"||' '||prospect_row."lastName",p_now);
   player_id:=gen_random_uuid()::text;
   INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,wage,"contractDays",fitness,morale,status,origin,"createdAt","updatedAt")
   VALUES(player_id,c.id,prospect_row."firstName",prospect_row."lastName",prospect_row.nationality,prospect_row.age,prospect_row.position,prospect_row.overall,prospect_row.potential,prospect_row.attributes,60+prospect_row.overall,365,100,75,'ACTIVE','GENERATED',p_now,p_now);
   UPDATE public."AcademyProspect" SET status='RECRUITED',"recruitedPlayerId"=player_id,"recruitedAt"=p_now WHERE id=prospect_row.id;
   RETURN jsonb_build_object('prospectId',prospect_row.id,'player',jsonb_build_object('id',player_id,'firstName',prospect_row."firstName",'lastName',prospect_row."lastName",'position',prospect_row.position::text,'overall',prospect_row.overall,'potential',prospect_row.potential),'cost',amount::text,'replayed',false);
 ELSE
   RAISE EXCEPTION USING MESSAGE='UNSUPPORTED_CLUB_ACTION', ERRCODE='22023';
 END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.club_management_command(text,text,text,jsonb,timestamptz) FROM PUBLIC, anon, authenticated;
DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.club_management_command(text,text,text,jsonb,timestamptz) TO service_role'; END IF; END $grant$;
