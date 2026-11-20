CREATE OR REPLACE FUNCTION public.schedule_telegram_message_deletion_http(
  p_telegram_chat_id text,p_message_id integer,p_delete_at timestamptz
) RETURNS TABLE(id text,status text,delete_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_telegram_chat_id !~ '^-?[0-9]{1,20}$' OR p_message_id<=0 OR p_delete_at IS NULL THEN
   RAISE EXCEPTION 'INVALID_TELEGRAM_MESSAGE_DELETION';
 END IF;
 RETURN QUERY
 INSERT INTO public."TelegramMessageDeletion" ("id","telegramChatId","messageId","deleteAt","availableAt","status","attempts","lockedUntil","claimToken","lastError","deletedAt","createdAt","updatedAt")
 VALUES (gen_random_uuid()::text,p_telegram_chat_id::bigint,p_message_id,p_delete_at,p_delete_at,'PENDING',0,NULL,NULL,NULL,NULL,NOW(),NOW())
 ON CONFLICT ("telegramChatId","messageId") DO UPDATE SET
  "deleteAt"=EXCLUDED."deleteAt","availableAt"=EXCLUDED."availableAt","status"='PENDING',"attempts"=0,
  "lockedUntil"=NULL,"claimToken"=NULL,"lastError"=NULL,"deletedAt"=NULL,"updatedAt"=NOW()
 RETURNING "TelegramMessageDeletion"."id","TelegramMessageDeletion"."status"::text,"TelegramMessageDeletion"."deleteAt";
END; $$;

CREATE OR REPLACE FUNCTION public.claim_due_telegram_message_deletions_http(p_limit integer DEFAULT 25)
RETURNS TABLE(id text,telegram_chat_id text,message_id integer,claim_token text)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 RETURN QUERY
 WITH due AS (
  SELECT d."id" FROM public."TelegramMessageDeletion" d
  WHERE (d."status"='PENDING' AND d."deleteAt"<=NOW() AND d."availableAt"<=NOW())
     OR (d."status"='PROCESSING' AND d."lockedUntil"<=NOW())
  ORDER BY d."deleteAt" ASC
  FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(COALESCE(p_limit,25),1),100)
 ), claimed AS (
  UPDATE public."TelegramMessageDeletion" d SET "status"='PROCESSING',"attempts"=d."attempts"+1,
   "lockedUntil"=NOW()+INTERVAL '60 seconds',"claimToken"=gen_random_uuid()::text,"updatedAt"=NOW()
  FROM due WHERE d."id"=due."id"
  RETURNING d."id",d."telegramChatId",d."messageId",d."claimToken"
 )
 SELECT c."id",c."telegramChatId"::text,c."messageId",c."claimToken" FROM claimed c;
END; $$;

CREATE OR REPLACE FUNCTION public.complete_telegram_message_deletion_http(p_id text,p_claim_token text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE affected integer;
BEGIN
 UPDATE public."TelegramMessageDeletion" SET "status"='DELETED',"deletedAt"=NOW(),"lockedUntil"=NULL,
  "claimToken"=NULL,"lastError"=NULL,"updatedAt"=NOW()
 WHERE "id"=p_id AND "status"='PROCESSING' AND "claimToken"=p_claim_token;
 GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected=1;
END; $$;

CREATE OR REPLACE FUNCTION public.fail_telegram_message_deletion_http(p_id text,p_claim_token text,p_error text)
RETURNS TABLE(rescheduled boolean,failed boolean,attempts integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE current_attempts integer; exhausted boolean; delay_seconds integer;
BEGIN
 SELECT d."attempts" INTO current_attempts FROM public."TelegramMessageDeletion" d
 WHERE d."id"=p_id AND d."status"='PROCESSING' AND d."claimToken"=p_claim_token FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 exhausted:=current_attempts>=8;
 delay_seconds:=LEAST(900*power(2,GREATEST(0,current_attempts-1))::integer,3600);
 UPDATE public."TelegramMessageDeletion" SET "status"=CASE WHEN exhausted THEN 'FAILED'::public."TelegramMessageDeletionStatus" ELSE 'PENDING'::public."TelegramMessageDeletionStatus" END,
  "availableAt"=NOW()+make_interval(secs=>delay_seconds),"lockedUntil"=NULL,"claimToken"=NULL,
  "lastError"=left(COALESCE(NULLIF(trim(p_error),''),'TELEGRAM_DELETE_FAILED'),500),"updatedAt"=NOW()
 WHERE "id"=p_id AND "status"='PROCESSING' AND "claimToken"=p_claim_token;
 RETURN QUERY SELECT NOT exhausted,exhausted,current_attempts;
END; $$;

GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public."TelegramMessageDeletion" TO service_role;
REVOKE ALL ON FUNCTION public.schedule_telegram_message_deletion_http(text,integer,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_due_telegram_message_deletions_http(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_telegram_message_deletion_http(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fail_telegram_message_deletion_http(text,text,text) FROM PUBLIC,anon,authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT EXECUTE ON FUNCTION public.schedule_telegram_message_deletion_http(text,integer,timestamptz) TO service_role;
 GRANT EXECUTE ON FUNCTION public.claim_due_telegram_message_deletions_http(integer) TO service_role;
 GRANT EXECUTE ON FUNCTION public.complete_telegram_message_deletion_http(text,text) TO service_role;
 GRANT EXECUTE ON FUNCTION public.fail_telegram_message_deletion_http(text,text,text) TO service_role;
END IF; END $$;
