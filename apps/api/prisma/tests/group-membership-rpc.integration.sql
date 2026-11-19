BEGIN;
DO $test$
DECLARE
 v_user_a text:=gen_random_uuid()::text; v_user_b text:=gen_random_uuid()::text;
 v_group_id text:='-1001234567890'; v_now timestamptz:=clock_timestamp(); r jsonb; v_challenge_id text; v_cancel_id text;
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
 r:=public.sync_telegram_group_member_http(v_group_id,'991000000002',true,'MEMBER');
 IF r->>'updated'<>'true' OR r->>'isMember'<>'true' THEN RAISE EXCEPTION 'member sync mismatch: %',r; END IF;
 r:=public.check_telegram_group_members_http(v_group_id,24,true);
 IF r->>'found'<>'true' OR r->>'isActive'<>'true' OR r->>'memberCount'<>'24' THEN RAISE EXCEPTION 'member count mismatch: %',r; END IF;
 r:=public.award_group_activity_http('991000000002',v_group_id,'DAILY_ACTIVITY',NULL,v_now);
 IF r->>'awarded'<>'true' OR r->>'award'<>'1' THEN RAISE EXCEPTION 'daily activity award mismatch: %',r; END IF;
 r:=public.award_group_activity_http('991000000002',v_group_id,'DAILY_ACTIVITY',NULL,v_now);
 IF r->>'replayed'<>'true' THEN RAISE EXCEPTION 'daily activity idempotency mismatch: %',r; END IF;
 r:=public.award_group_activity_http('991000000002',v_group_id,'MATCH_PLAYED','match-fixture-1',v_now);
 IF r->>'awarded'<>'true' OR r->>'award'<>'2' THEN RAISE EXCEPTION 'game activity award mismatch: %',r; END IF;
 r:=public.list_my_telegram_groups_http('991000000002');
 IF jsonb_array_length(r->'groups')<>1 THEN RAISE EXCEPTION 'my groups listing mismatch: %',r; END IF;
 r:=public.get_telegram_group_workspace_http('991000000002',v_group_id);
 IF r#>>'{group,role}'<>'MEMBER' OR r#>>'{personal,points}'<>'0'
 OR jsonb_array_length(r->'shop')<>3 OR jsonb_array_length(r->'challenges')<>0
 OR jsonb_array_length(r->'leagues')<>0 THEN RAISE EXCEPTION 'group workspace mismatch: %',r; END IF;

 UPDATE public."TelegramGroup" SET points=1000 WHERE "telegramId"=v_group_id;
 r:=public.list_group_shop_http('991000000001',v_group_id);
 IF jsonb_array_length(r->'items')<>3 OR r->>'points'<>'1000' THEN RAISE EXCEPTION 'group shop listing mismatch: %',r; END IF;
 r:=public.purchase_group_reward_http('991000000001',v_group_id,'member-spotlight','991000000002','group-shop-purchase-0001');
 IF r->>'purchased'<>'true' OR r->>'replayed'<>'false' OR r->>'points'<>'940' THEN RAISE EXCEPTION 'group reward purchase mismatch: %',r; END IF;
 r:=public.purchase_group_reward_http('991000000001',v_group_id,'member-spotlight','991000000002','group-shop-purchase-0001');
 IF r->>'replayed'<>'true' OR r->>'points'<>'940' THEN RAISE EXCEPTION 'group reward purchase replay mismatch: %',r; END IF;
 r:=public.purchase_group_reward_http('991000000002',v_group_id,'group-banner',NULL,'group-shop-member-0001');
 IF r->>'error'<>'GROUP_MANAGER_REQUIRED' THEN RAISE EXCEPTION 'group shop manager authorization mismatch: %',r; END IF;
 r:=public.create_group_challenge_http('991000000001',v_group_id,'Integration Challenge',v_now,v_now+interval '1 day',50,'group-challenge-create-0001',v_now);
 IF r->>'replayed'<>'false' OR r#>>'{challenge,rewardPoints}'<>'50' THEN RAISE EXCEPTION 'group challenge creation mismatch: %',r; END IF;
 v_challenge_id:=r#>>'{challenge,id}';
 r:=public.create_group_challenge_http('991000000001',v_group_id,'Integration Challenge',v_now,v_now+interval '1 day',50,'group-challenge-create-0001',v_now);
 IF r->>'replayed'<>'true' THEN RAISE EXCEPTION 'group challenge idempotency mismatch: %',r; END IF;
 r:=public.join_group_challenge_http('991000000002',v_group_id,v_challenge_id,v_now+interval '1 second');
 IF r->>'joined'<>'true' OR r->>'replayed'<>'false' THEN RAISE EXCEPTION 'group challenge join mismatch: %',r; END IF;
 r:=public.join_group_challenge_http('991000000002',v_group_id,v_challenge_id,v_now+interval '2 seconds');
 IF r->>'replayed'<>'true' THEN RAISE EXCEPTION 'group challenge join replay mismatch: %',r; END IF;
 UPDATE public."GroupChallenge" SET "endsAt"=v_now-interval '1 second' WHERE id=v_challenge_id;
 r:=public.complete_group_challenge_http('991000000001',v_group_id,v_challenge_id,'991000000002',v_now);
 IF r->>'completed'<>'true' OR r->>'replayed'<>'false' THEN RAISE EXCEPTION 'group challenge settlement mismatch: %',r; END IF;
 r:=public.complete_group_challenge_http('991000000001',v_group_id,v_challenge_id,'991000000002',v_now);
 IF r->>'replayed'<>'true' THEN RAISE EXCEPTION 'group challenge settlement replay mismatch: %',r; END IF;
 r:=public.create_group_challenge_http('991000000001',v_group_id,'Cancelled Challenge',v_now,v_now+interval '1 day',20,'group-challenge-cancel-0001',v_now);
 v_cancel_id:=r#>>'{challenge,id}';
 r:=public.cancel_group_challenge_http('991000000001',v_group_id,v_cancel_id,v_now);
 IF r->>'cancelled'<>'true' OR r->>'replayed'<>'false' THEN RAISE EXCEPTION 'group challenge cancellation mismatch: %',r; END IF;
 r:=public.cancel_group_challenge_http('991000000001',v_group_id,v_cancel_id,v_now);
 IF r->>'replayed'<>'true' THEN RAISE EXCEPTION 'group challenge cancellation replay mismatch: %',r; END IF;

 r:=public.get_telegram_group_summary_http('991000000002',v_group_id);
 IF r->>'role'<>'MEMBER' OR r#>>'{group,telegramId}'<>v_group_id THEN RAISE EXCEPTION 'group summary mismatch: %',r; END IF;
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
