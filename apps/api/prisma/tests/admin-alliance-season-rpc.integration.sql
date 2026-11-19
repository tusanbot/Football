BEGIN;
DO $test$
DECLARE
 v_admin_id text:=gen_random_uuid()::text;
 v_founder_id text:=gen_random_uuid()::text;
 v_admin_tg text:=(200000000000+floor(random()*799999999999)::bigint)::text;
 v_founder_tg text:=(200000000000+floor(random()*799999999999)::bigint)::text;
 v_group_tg text:='-100'||(200000000000+floor(random()*799999999999)::bigint)::text;
 v_now timestamptz:=clock_timestamp();
 r jsonb; aid text; sid text; sid2 text; sid3 text; group_db_id text; season_no int;
BEGIN
 INSERT INTO public."User"(id,"telegramId","displayName","createdAt","updatedAt","lastActiveAt")
 VALUES(v_admin_id,v_admin_tg,'Admin RPC Actor',v_now,v_now,v_now),(v_founder_id,v_founder_tg,'Alliance Founder',v_now,v_now,v_now);
 INSERT INTO public."Club"(id,"ownerId",name,slug,"createdAt","updatedAt")
 VALUES(gen_random_uuid()::text,v_admin_id,'Admin RPC Club','admin-rpc-club-'||v_admin_id,v_now,v_now),
 (gen_random_uuid()::text,v_founder_id,'Founder RPC Club','founder-rpc-club-'||v_founder_id,v_now,v_now);
 r:=public.register_telegram_group_http(v_founder_tg,v_group_tg,'Admin RPC Founder Group','OWNER',20,v_now);
 SELECT id INTO group_db_id FROM public."TelegramGroup" WHERE "telegramId"=v_group_tg;
 r:=public.create_alliance_http(v_founder_tg,v_group_tg,'Admin RPC Alliance','admin lifecycle','admin-alliance-rpc-'||substr(v_admin_id,1,16));
 aid:=r#>>'{alliance,id}';
 IF aid IS NULL THEN RAISE EXCEPTION 'test alliance creation failed: %',r; END IF;
 UPDATE public."AllianceSeason" SET status='COMPLETED',"reviewStatus"='APPROVED',"closedAt"=v_now WHERE "allianceId"=aid AND number=1;
 r:=public.admin_start_alliance_season_http(v_admin_tg,aid,7,'admin-start-alliance-season-'||substr(v_admin_id,1,12),'test admin start');
 sid:=r#>>'{season,id}';
 IF sid IS NULL OR r#>>'{season,number}'<>'2' OR r->>'replayed'<>'false' THEN RAISE EXCEPTION 'admin season start failed: %',r; END IF;
 r:=public.admin_start_alliance_season_http(v_admin_tg,aid,7,'admin-start-alliance-season-'||substr(v_admin_id,1,12));
 IF r->>'replayed'<>'false' AND r#>>'{season,id}' IS DISTINCT FROM sid THEN RAISE EXCEPTION 'admin start idempotent replay failed: %',r; END IF;
 IF (SELECT count(*) FROM public."AdminAuditLog" WHERE "idempotencyKey"='admin-start-alliance-season-'||substr(v_admin_id,1,12) AND "actorTelegramId"=v_admin_tg AND action='start-alliance-season')<>1 THEN RAISE EXCEPTION 'admin start audit missing or duplicated'; END IF;
 UPDATE public."AllianceGroup" SET "joinedAt"=v_now-interval '2 hours' WHERE "allianceId"=aid;
 UPDATE public."AllianceSeason" SET "startsAt"=v_now-interval '1 hour',"endsAt"=v_now-interval '1 minute' WHERE id=sid;
 INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt")
 VALUES(gen_random_uuid()::text,'admin-close-points-'||substr(v_admin_id,1,12),group_db_id,v_founder_id,100,'DAILY_ACTIVITY','admin close test',v_now-interval '10 minutes');
 UPDATE public."Alliance" SET "treasuryPoints"=50 WHERE id=aid;
 r:=public.admin_close_alliance_season_http(v_admin_tg,sid,'admin-close-alliance-season-'||substr(v_admin_id,1,12),'test admin close');
 IF r->>'replayed'<>'false' OR r->>'reviewStatus'<>'FLAGGED' OR r->>'prize'<>'0' THEN RAISE EXCEPTION 'admin close/security gate failed: %',r; END IF;
 r:=public.admin_close_alliance_season_http(v_admin_tg,sid,'admin-close-alliance-season-'||substr(v_admin_id,1,12));
 IF r->>'replayed'<>'false' AND r->>'reviewStatus'<>'FLAGGED' THEN RAISE EXCEPTION 'admin close idempotent replay failed: %',r; END IF;
 IF (SELECT count(*) FROM public."AdminAuditLog" WHERE "idempotencyKey"='admin-close-alliance-season-'||substr(v_admin_id,1,12) AND "actorTelegramId"=v_admin_tg AND action='close-alliance-season')<>1 THEN RAISE EXCEPTION 'admin close audit missing or duplicated'; END IF;
 r:=public.admin_review_alliance_season_http(v_admin_tg,sid,'APPROVE','admin-review-alliance-season-'||substr(v_admin_id,1,12),'test admin review');
 IF r->>'reviewStatus'<>'APPROVED' OR r->>'prize'<>'50' OR r->>'replayed'<>'false' THEN RAISE EXCEPTION 'admin review and payout failed: %',r; END IF;
 r:=public.admin_review_alliance_season_http(v_admin_tg,sid,'APPROVE','admin-review-alliance-season-'||substr(v_admin_id,1,12));
 IF r->>'replayed'<>'false' AND r->>'reviewStatus'<>'APPROVED' THEN RAISE EXCEPTION 'admin review idempotent replay failed: %',r; END IF;
 IF (SELECT count(*) FROM public."AllianceAuditLog" WHERE "allianceId"=aid AND "actorTelegramId"=v_admin_tg AND action='ADMIN_SEASON_REVIEWED')<>1 THEN RAISE EXCEPTION 'admin alliance audit actor identity missing'; END IF;
 IF (SELECT count(*) FROM public."AdminAuditLog" WHERE "actorTelegramId"=v_admin_tg AND "targetType"='alliance-season' AND "idempotencyKey" IN ('admin-start-alliance-season-'||substr(v_admin_id,1,12),'admin-close-alliance-season-'||substr(v_admin_id,1,12),'admin-review-alliance-season-'||substr(v_admin_id,1,12)))<>3 THEN RAISE EXCEPTION 'expected three atomic admin audit entries'; END IF;
 r:=public.admin_start_alliance_season_http(v_admin_tg,aid,7,'admin-start-third-season-'||substr(v_admin_id,1,12),'test third start');
 sid3:=r#>>'{season,id}';
 IF sid3 IS NULL OR r#>>'{season,number}'<>'3' THEN RAISE EXCEPTION 'admin third season start failed: %',r; END IF;
 r:=public.admin_start_alliance_season_http(v_admin_tg,aid,7,'admin-start-third-season-'||substr(v_admin_id,1,12));
 IF r#>>'{season,id}' IS DISTINCT FROM sid3 THEN RAISE EXCEPTION 'admin third season replay mismatch: %',r; END IF;
END $test$;
ROLLBACK;
