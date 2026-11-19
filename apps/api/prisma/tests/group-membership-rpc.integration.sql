BEGIN;
DO $test$
DECLARE
 v_user_a text:=gen_random_uuid()::text; v_user_b text:=gen_random_uuid()::text;
 v_group_id text:='-1001234567890'; v_now timestamptz:=clock_timestamp(); r jsonb;
BEGIN
 INSERT INTO public."User"(id,"telegramId","displayName","createdAt","updatedAt","lastActiveAt")
 VALUES(v_user_a,'991000000001','Group Owner',v_now,v_now,v_now),(v_user_b,'991000000002','Group Member',v_now,v_now,v_now);
 INSERT INTO public."Club"(id,"ownerId",name,slug,"createdAt","updatedAt")
 VALUES(gen_random_uuid()::text,v_user_a,'Owner FC','group-owner-'||v_user_a,v_now,v_now),
 (gen_random_uuid()::text,v_user_b,'Member FC','group-member-'||v_user_b,v_now,v_now);
 r:=public.get_group_actor_status_http('991000000001',v_group_id);
 IF r->>'userExists'<>'true' OR r->>'userSuspended'<>'false' OR r->>'groupExists'<>'false' THEN RAISE EXCEPTION 'actor status mismatch: %',r; END IF;
 r:=public.register_telegram_group_http('991000000001',v_group_id,'Integration Group','OWNER',25,v_now);
 IF r->>'role'<>'OWNER' OR r->>'registeredManagers'<>'1' OR r#>>'{group,telegramId}'<>v_group_id OR r#>>'{group,points}'<>'0' THEN RAISE EXCEPTION 'registration mismatch: %',r; END IF;
 r:=public.join_telegram_group_http('991000000002',v_group_id,25,v_now+interval '1 second');
 IF r->>'role'<>'MEMBER' OR r->>'alreadyJoined'<>'false' OR r->>'registeredManagers'<>'1' THEN RAISE EXCEPTION 'join mismatch: %',r; END IF;
 r:=public.join_telegram_group_http('991000000002',v_group_id,25,v_now+interval '2 seconds');
 IF r->>'alreadyJoined'<>'true' OR r->>'role'<>'MEMBER' THEN RAISE EXCEPTION 'idempotent join mismatch: %',r; END IF;
 r:=public.join_telegram_group_http('991000000002','-1001234567891',4,v_now+interval '3 seconds');
 IF r->>'error'<>'GROUP_MINIMUM_MEMBERS_REQUIRED' THEN RAISE EXCEPTION 'minimum member validation mismatch: %',r; END IF;
 UPDATE public."TelegramGroup" SET "isSuspended"=true WHERE "telegramId"=v_group_id;
 r:=public.get_group_actor_status_http('991000000001',v_group_id);
 IF r->>'groupSuspended'<>'true' THEN RAISE EXCEPTION 'suspension status mismatch: %',r; END IF;
 r:=public.register_telegram_group_http('991000000001',v_group_id,'Integration Group','OWNER',25,v_now);
 IF r->>'error'<>'GROUP_SUSPENDED' THEN RAISE EXCEPTION 'suspended group registration mismatch: %',r; END IF;
END; $test$;
ROLLBACK;
