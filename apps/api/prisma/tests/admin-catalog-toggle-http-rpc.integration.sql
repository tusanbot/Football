BEGIN;
DO $test$
DECLARE v jsonb; item_id text:='ci-admin-catalog-item'; gift_id text:='ci-admin-catalog-gift'; actor text:='919900097';
BEGIN
 INSERT INTO public."GroupRewardItem"(id,slug,name,description,cost,scope,active)
 VALUES(item_id,'ci-admin-catalog-item','CI item','CI item description',10,'PERSONAL',true);
 INSERT INTO public."GiftCode"(id,code,"createdByTelegramId",active)
 VALUES(gift_id,'CI_ADMIN_CATALOG_GIFT',actor,true);
 v:=public.admin_catalog_toggle_http('toggle-item',item_id,false,actor,'admin-catalog-item-key-01');
 IF v->>'replay'<>'false' OR (SELECT active FROM public."GroupRewardItem" WHERE id=item_id) THEN RAISE EXCEPTION 'item toggle failed'; END IF;
 v:=public.admin_catalog_toggle_http('toggle-item',item_id,false,actor,'admin-catalog-item-key-01');
 IF v->>'replay'<>'true' THEN RAISE EXCEPTION 'item toggle replay failed'; END IF;
 v:=public.admin_catalog_toggle_http('toggle-gift-code',gift_id,false,actor,'admin-catalog-gift-key1');
 IF v->>'replay'<>'false' OR (SELECT active FROM public."GiftCode" WHERE id=gift_id) THEN RAISE EXCEPTION 'gift code toggle failed'; END IF;
 IF (SELECT count(*) FROM public."AdminAuditLog" WHERE "actorTelegramId"=actor)<>2 THEN RAISE EXCEPTION 'catalog audit rows missing'; END IF;
 IF has_function_privilege('anon','public.admin_catalog_toggle_http(text,text,boolean,text,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.admin_catalog_toggle_http(text,text,boolean,text,text)','EXECUTE') THEN RAISE EXCEPTION 'catalog toggle RPC exposed to public roles'; END IF;
END;
$test$;
ROLLBACK;
