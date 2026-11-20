-- Read-only event tournament admin role lookup and inactive-role semantics.
BEGIN;
DO $test$
DECLARE v_result jsonb;
BEGIN
 INSERT INTO public."AdminRoleAssignment"(id,"telegramId",role,active,"createdByTelegramId","updatedByTelegramId","createdAt","updatedAt")
 VALUES('ci-event-admin-role-active','910000001','football',true,'910000999','910000999',NOW(),NOW()),
       ('ci-event-admin-role-inactive','910000002','economy',false,'910000999','910000999',NOW(),NOW());
 v_result:=public.get_event_tournament_admin_role_http('910000001');
 IF v_result->>'role' IS DISTINCT FROM 'football' OR v_result->>'active' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'active admin role lookup mismatch: %',v_result;
 END IF;
 v_result:=public.get_event_tournament_admin_role_http('910000002');
 IF v_result->>'role' IS DISTINCT FROM 'economy' OR v_result->>'active' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'inactive admin role lookup mismatch: %',v_result;
 END IF;
 v_result:=public.get_event_tournament_admin_role_http('910000003');
 IF v_result IS NOT NULL THEN RAISE EXCEPTION 'missing admin role must return null: %',v_result; END IF;
END;
$test$;
ROLLBACK;
