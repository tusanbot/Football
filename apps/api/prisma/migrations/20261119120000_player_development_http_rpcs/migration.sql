CREATE OR REPLACE FUNCTION public.settle_player_daily_state_http(p_user_id TEXT,p_club_id TEXT,p_expected_last_tick TIMESTAMPTZ,p_game_date DATE,p_elapsed_days INTEGER,p_updates JSONB,p_payroll JSONB,p_lineup_changed BOOLEAN,p_now TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE c "Club"%ROWTYPE;u JSONB;w "Wallet"%ROWTYPE;paid BIGINT;pdate DATE;
BEGIN
 SELECT * INTO c FROM public."Club" WHERE id=p_club_id AND "ownerId"=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND');END IF;
 IF c."lastDailyTickAt"<>p_expected_last_tick THEN RETURN jsonb_build_object('error','DAILY_SETTLEMENT_CONFLICT');END IF;
 IF p_elapsed_days<=0 OR jsonb_typeof(p_updates) IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('error','INVALID_DAILY_SETTLEMENT');END IF;
 FOR u IN SELECT value FROM jsonb_array_elements(p_updates) LOOP
  UPDATE public."Player" SET age=(u->>'age')::int,"ageDays"=(u->>'ageDays')::int,attributes=COALESCE(u->'attributes',attributes),overall=COALESCE((u->>'overall')::int,overall),"contractDays"=(u->>'contractDays')::int,fitness=(u->>'fitness')::int,morale=(u->>'morale')::int,status=(u->>'status')::"PlayerStatus","injuryUntil"=NULLIF(u->>'injuryUntil','')::timestamptz,"lineupSlot"=CASE WHEN u ? 'lineupSlot' THEN NULL ELSE "lineupSlot" END WHERE id=u->>'id' AND "clubId"=p_club_id;
  IF COALESCE((u->>'expireListing')::boolean,false) THEN UPDATE public."PlayerMarketListing" SET status='EXPIRED' WHERE "playerId"=u->>'id' AND status='OPEN';END IF;
 END LOOP;
 IF p_payroll IS NOT NULL THEN
  pdate=(p_payroll->>'payrollDate')::date;paid=(p_payroll->>'cashPaid')::bigint;
  IF paid>0 THEN SELECT * INTO w FROM public."Wallet" WHERE "userId"=p_user_id AND asset='CASH' FOR UPDATE;
   IF NOT FOUND OR w.id<>(p_payroll->>'walletId') OR w.version<>(p_payroll->>'walletVersion')::int OR w.balance<>(p_payroll->>'walletBalance')::bigint OR w.balance<paid THEN RETURN jsonb_build_object('error','DAILY_SETTLEMENT_CONFLICT');END IF;
   UPDATE public."Wallet" SET balance=balance-paid,version=version+1 WHERE id=w.id;
   INSERT INTO public."LedgerTransaction"(id,"idempotencyKey","userId",asset,direction,amount,reason,"referenceType","referenceId","createdAt") VALUES(gen_random_uuid()::text,'weekly-payroll:'||p_club_id||':'||pdate,p_user_id,'CASH','DEBIT',paid,'WEEKLY_PLAYER_AND_COACH_PAYROLL','CLUB_PAYROLL',p_club_id,p_now);
  END IF;
  INSERT INTO public."ClubPayroll"(id,"clubId","payrollDate","weeksCovered","playerWages","coachWages","arrearsBefore","totalDue","cashPaid","arrearsAfter","playersCount","createdAt") VALUES(gen_random_uuid()::text,p_club_id,pdate,(p_payroll->>'weeksCovered')::int,(p_payroll->>'playerWages')::bigint,(p_payroll->>'coachWages')::bigint,(p_payroll->>'arrearsBefore')::bigint,(p_payroll->>'totalDue')::bigint,paid,(p_payroll->>'arrearsAfter')::bigint,(p_payroll->>'playersCount')::int,p_now);
  IF paid>0 THEN INSERT INTO public."ClubFinanceEntry"(id,"idempotencyKey","clubId",category,direction,amount,description,"occurredAt") VALUES(gen_random_uuid()::text,'club-finance-payroll:'||p_club_id||':'||pdate,p_club_id,'PLAYER_AND_COACH_PAYROLL','DEBIT',paid,'Weekly payroll cash paid',pdate::timestamptz);END IF;
  UPDATE public."Club" SET "lastPayrollAt"=pdate::timestamptz,wageArrears=(p_payroll->>'arrearsAfter')::bigint WHERE id=p_club_id;
  IF (p_payroll->>'arrearsAfter')::bigint>0 AND (p_payroll->>'totalDue')::bigint>0 THEN UPDATE public."Player" SET morale=GREATEST(0,morale-LEAST(12,2+CEIL(((p_payroll->>'arrearsAfter')::numeric*10)/(p_payroll->>'totalDue')::numeric)::int)) WHERE "clubId"=p_club_id AND status IN ('ACTIVE','INJURED','CONTRACT_EXPIRED','LISTED');END IF;
 END IF;
 UPDATE public."Club" SET "lastDailyTickAt"=p_game_date::timestamptz,"lineupVersion"="lineupVersion"+CASE WHEN p_lineup_changed THEN 1 ELSE 0 END WHERE id=p_club_id;
 INSERT INTO public."ClubDailyTick"(id,"clubId","gameDate","elapsedDays","createdAt") VALUES(gen_random_uuid()::text,p_club_id,p_game_date,p_elapsed_days,p_now);
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.train_player_http(p_user_id TEXT,p_player_id TEXT,p_club_id TEXT,p_idempotency_key TEXT,p_training_date DATE,p_focus TEXT,p_intensity TEXT,p_expected_wallet_version INTEGER,p_expected_wallet_balance BIGINT,p_cash_cost BIGINT,p_overall_before INTEGER,p_overall_after INTEGER,p_fitness_before INTEGER,p_fitness_after INTEGER,p_morale_after INTEGER,p_attributes_before JSONB,p_attributes_after JSONB,p_injury_occurred BOOLEAN,p_injury_until TIMESTAMPTZ,p_training_focus TEXT,p_now TIMESTAMPTZ,p_player_name TEXT,p_clear_lineup BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE c "Club"%ROWTYPE;p "Player"%ROWTYPE;w "Wallet"%ROWTYPE;old "PlayerTrainingLog"%ROWTYPE;
BEGIN
 SELECT * INTO c FROM public."Club" WHERE id=p_club_id AND "ownerId"=p_user_id FOR UPDATE;IF NOT FOUND THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND');END IF;
 SELECT * INTO old FROM public."PlayerTrainingLog" WHERE "idempotencyKey"=p_idempotency_key;
 IF FOUND THEN IF old."userId"<>p_user_id OR old."playerId"<>p_player_id OR old.focus::text<>p_focus OR old.intensity::text<>p_intensity THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT');END IF;
  SELECT * INTO w FROM public."Wallet" WHERE "userId"=p_user_id AND asset='CASH';RETURN jsonb_build_object('playerId',p_player_id,'focus',p_focus,'intensity',p_intensity,'overallBefore',old."overallBefore",'overallAfter',old."overallAfter",'fitnessBefore',old."fitnessBefore",'fitnessAfter',old."fitnessAfter",'injuryOccurred',old."injuryOccurred",'injuryUntil',old."injuryUntil",'cashCost',old."cashCost"::text,'cashBalance',COALESCE(w.balance,0)::text,'replayed',true);END IF;
 SELECT * INTO p FROM public."Player" WHERE id=p_player_id AND "clubId"=p_club_id FOR UPDATE;IF NOT FOUND THEN RETURN jsonb_build_object('error','PLAYER_NOT_FOUND');END IF;
 IF p.status<>'ACTIVE' THEN RETURN jsonb_build_object('error',CASE WHEN p.status='INJURED' THEN 'PLAYER_INJURED' WHEN p.status='CONTRACT_EXPIRED' THEN 'CONTRACT_EXPIRED' ELSE 'PLAYER_NOT_AVAILABLE' END);END IF;
 IF EXISTS(SELECT 1 FROM public."PlayerTrainingLog" WHERE "playerId"=p_player_id AND "trainingDate"=p_training_date) THEN RETURN jsonb_build_object('error','ALREADY_TRAINED_TODAY');END IF;
 IF p.overall<>p_overall_before OR p.fitness<>p_fitness_before OR p.attributes<>p_attributes_before THEN RETURN jsonb_build_object('error','CONCURRENT_MODIFICATION');END IF;
 SELECT * INTO w FROM public."Wallet" WHERE "userId"=p_user_id AND asset='CASH' FOR UPDATE;IF NOT FOUND THEN RETURN jsonb_build_object('error','WALLET_NOT_FOUND');END IF;
 IF w.version<>p_expected_wallet_version OR w.balance<>p_expected_wallet_balance THEN RETURN jsonb_build_object('error','CONCURRENT_MODIFICATION');END IF;IF w.balance<p_cash_cost THEN RETURN jsonb_build_object('error','INSUFFICIENT_CASH');END IF;
 UPDATE public."Wallet" SET balance=balance-p_cash_cost,version=version+1 WHERE id=w.id;
 UPDATE public."Player" SET attributes=p_attributes_after,overall=p_overall_after,fitness=p_fitness_after,morale=p_morale_after,"trainingFocus"=p_training_focus::"TrainingFocus","lastTrainedAt"=p_now,status=CASE WHEN p_injury_occurred THEN 'INJURED'::"PlayerStatus" ELSE 'ACTIVE'::"PlayerStatus" END,"injuryUntil"=p_injury_until,"lineupSlot"=CASE WHEN p_clear_lineup THEN NULL ELSE "lineupSlot" END WHERE id=p_player_id;
 IF p_clear_lineup THEN UPDATE public."Club" SET "lineupVersion"="lineupVersion"+1 WHERE id=p_club_id;END IF;
 INSERT INTO public."LedgerTransaction"(id,"idempotencyKey","userId",asset,direction,amount,reason,"referenceType","referenceId","createdAt") VALUES(gen_random_uuid()::text,'player-training:'||p_idempotency_key,p_user_id,'CASH','DEBIT',p_cash_cost,'PLAYER_TRAINING','PLAYER',p_player_id,p_now);
 INSERT INTO public."ClubFinanceEntry"(id,"idempotencyKey","clubId",category,direction,amount,description,"occurredAt") VALUES(gen_random_uuid()::text,'club-finance-training:'||p_idempotency_key,p_club_id,'PLAYER_TRAINING','DEBIT',p_cash_cost,'Training session for '||p_player_name,p_now);
 INSERT INTO public."PlayerTrainingLog"(id,"idempotencyKey","userId","clubId","playerId","trainingDate",focus,intensity,"cashCost","overallBefore","overallAfter","fitnessBefore","fitnessAfter","attributesBefore","attributesAfter","injuryOccurred","injuryUntil","createdAt") VALUES(gen_random_uuid()::text,p_idempotency_key,p_user_id,p_club_id,p_player_id,p_training_date,p_focus::"TrainingFocus",p_intensity::"TrainingIntensity",p_cash_cost,p_overall_before,p_overall_after,p_fitness_before,p_fitness_after,p_attributes_before,p_attributes_after,p_injury_occurred,p_injury_until,p_now);
 RETURN jsonb_build_object('playerId',p_player_id,'focus',p_focus,'intensity',p_intensity,'overallBefore',p_overall_before,'overallAfter',p_overall_after,'fitnessBefore',p_fitness_before,'fitnessAfter',p_fitness_after,'injuryOccurred',p_injury_occurred,'injuryUntil',p_injury_until,'cashCost',p_cash_cost::text,'cashBalance',(w.balance-p_cash_cost)::text,'replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.renew_player_contract_http(p_user_id TEXT,p_club_id TEXT,p_player_id TEXT,p_idempotency_key TEXT,p_extension_days INTEGER,p_expected_contract_days INTEGER,p_expected_wage BIGINT,p_new_contract_days INTEGER,p_new_wage BIGINT,p_status TEXT,p_now TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE c "Club"%ROWTYPE;p "Player"%ROWTYPE;old "PlayerContractRenewal"%ROWTYPE;
BEGIN
 SELECT * INTO c FROM public."Club" WHERE id=p_club_id AND "ownerId"=p_user_id FOR UPDATE;IF NOT FOUND THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND');END IF;
 SELECT * INTO old FROM public."PlayerContractRenewal" WHERE "idempotencyKey"=p_idempotency_key;
 IF FOUND THEN IF old."userId"<>p_user_id OR old."playerId"<>p_player_id OR old."extensionDays"<>p_extension_days OR old."newWage"<>p_new_wage THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT');END IF;RETURN jsonb_build_object('playerId',p_player_id,'extensionDays',p_extension_days,'contractDays',old."newContractDays",'weeklyWage',old."newWage"::text,'replayed',true);END IF;
 SELECT * INTO p FROM public."Player" WHERE id=p_player_id AND "clubId"=p_club_id FOR UPDATE;IF NOT FOUND THEN RETURN jsonb_build_object('error','PLAYER_NOT_FOUND');END IF;
 IF p.status IN ('LISTED','RETIRED') THEN RETURN jsonb_build_object('error','PLAYER_NOT_AVAILABLE');END IF;IF p."contractDays"<>p_expected_contract_days OR p.wage<>p_expected_wage THEN RETURN jsonb_build_object('error','CONCURRENT_MODIFICATION');END IF;
 UPDATE public."Player" SET "contractDays"=p_new_contract_days,wage=p_new_wage,status=p_status::"PlayerStatus" WHERE id=p_player_id;
 INSERT INTO public."PlayerContractRenewal"(id,"idempotencyKey","userId","clubId","playerId","extensionDays","oldContractDays","newContractDays","oldWage","newWage","createdAt") VALUES(gen_random_uuid()::text,p_idempotency_key,p_user_id,p_club_id,p_player_id,p_extension_days,p."contractDays",p_new_contract_days,p.wage,p_new_wage,p_now);
 RETURN jsonb_build_object('playerId',p_player_id,'extensionDays',p_extension_days,'oldContractDays',p."contractDays",'contractDays',p_new_contract_days,'oldWeeklyWage',p.wage::text,'weeklyWage',p_new_wage::text,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.settle_player_daily_state_http(TEXT,TEXT,TIMESTAMPTZ,DATE,INTEGER,JSONB,JSONB,BOOLEAN,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.train_player_http(TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT,INTEGER,BIGINT,BIGINT,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,JSONB,JSONB,BOOLEAN,TIMESTAMPTZ,TEXT,TIMESTAMPTZ,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.renew_player_contract_http(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,BIGINT,TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_player_daily_state_http(TEXT,TEXT,TIMESTAMPTZ,DATE,INTEGER,JSONB,JSONB,BOOLEAN,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.train_player_http(TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT,INTEGER,BIGINT,BIGINT,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,JSONB,JSONB,BOOLEAN,TIMESTAMPTZ,TEXT,TIMESTAMPTZ,TEXT,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_player_contract_http(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,BIGINT,INTEGER,BIGINT,TEXT,TIMESTAMPTZ) TO service_role;
