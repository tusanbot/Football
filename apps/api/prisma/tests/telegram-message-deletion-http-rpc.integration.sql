BEGIN;
SET LOCAL ROLE service_role;
DO $test$
DECLARE
 v_chat bigint := -1999000000001; v_message integer := 2147483000;
 v_id text; v_status text; v_delete_at timestamptz; v_claim record; v_retry record; v_i integer;
BEGIN
 SELECT * INTO v_id,v_status,v_delete_at FROM public.schedule_telegram_message_deletion_http(v_chat::text,v_message,NOW()-INTERVAL '1 second');
 IF v_id IS NULL OR v_status<>'PENDING' OR v_delete_at>NOW() THEN RAISE EXCEPTION 'message deletion scheduling failed'; END IF;
 SELECT * INTO v_id,v_status,v_delete_at FROM public.schedule_telegram_message_deletion_http(v_chat::text,v_message,NOW()-INTERVAL '2 seconds');
 IF v_status<>'PENDING' THEN RAISE EXCEPTION 'message deletion upsert failed'; END IF;
 SELECT * INTO v_claim FROM public.claim_due_telegram_message_deletions_http(100) WHERE telegram_chat_id=v_chat::text AND message_id=v_message;
 IF v_claim.id IS NULL OR NOT public.complete_telegram_message_deletion_http(v_claim.id,v_claim.claim_token) THEN RAISE EXCEPTION 'message deletion claim/complete failed'; END IF;
 IF NOT public.complete_telegram_message_deletion_http(v_claim.id,v_claim.claim_token) THEN RAISE EXCEPTION 'same completed deletion claim must be safely replayable'; END IF;
 IF public.complete_telegram_message_deletion_http(v_claim.id,gen_random_uuid()::text) THEN RAISE EXCEPTION 'unrelated stale deletion token was accepted'; END IF;
 SELECT * INTO v_id,v_status,v_delete_at FROM public.schedule_telegram_message_deletion_http(v_chat::text,v_message+1,NOW()-INTERVAL '1 second');
 FOR v_i IN 1..8 LOOP
  UPDATE public."TelegramMessageDeletion" SET "availableAt"=NOW()-INTERVAL '1 second',"lockedUntil"=NULL WHERE "id"=v_id;
  SELECT * INTO v_claim FROM public.claim_due_telegram_message_deletions_http(100) WHERE telegram_chat_id=v_chat::text AND message_id=v_message+1;
  IF v_claim.id IS NULL THEN RAISE EXCEPTION 'retry candidate not claimed at attempt %',v_i; END IF;
  SELECT * INTO v_retry FROM public.fail_telegram_message_deletion_http(v_id,v_claim.claim_token,'test failure');
  IF v_retry.attempts<>v_i THEN RAISE EXCEPTION 'retry attempt counter mismatch'; END IF;
  IF v_i<8 AND (NOT v_retry.rescheduled OR v_retry.failed) THEN RAISE EXCEPTION 'retry exhausted too early'; END IF;
  IF v_i=8 AND (v_retry.rescheduled OR NOT v_retry.failed) THEN RAISE EXCEPTION 'retry did not reach terminal failure'; END IF;
 END LOOP;
 IF has_function_privilege('anon','public.schedule_telegram_message_deletion_http(text,integer,timestamp with time zone)','EXECUTE')
 OR has_function_privilege('authenticated','public.claim_due_telegram_message_deletions_http(integer)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.complete_telegram_message_deletion_http(text,text)','EXECUTE') THEN
 RAISE EXCEPTION 'Telegram deletion RPC grants are invalid'; END IF;
END;
$test$;
ROLLBACK;
