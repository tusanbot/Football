BEGIN;
INSERT INTO public."GroupRewardItem"(id,slug,name,description,cost,scope) VALUES('admin-catalog-manage-item','admin-catalog-manage','Item','Description',10,'GROUP');
SELECT public.admin_catalog_manage_http('item-update','admin-catalog-manage-item','12345','admin-catalog-update-001',NULL,'Updated',NULL,25,NULL);
DO $$
DECLARE r jsonb; a integer;
BEGIN
 r:=public.admin_catalog_manage_http('item-update','admin-catalog-manage-item','12345','admin-catalog-update-001',NULL,'Updated',NULL,25,NULL);
 IF r->>'replay'<>'true' THEN RAISE EXCEPTION 'item update replay expected'; END IF;
 IF (SELECT name FROM public."GroupRewardItem" WHERE id='admin-catalog-manage-item')<>'Updated' THEN RAISE EXCEPTION 'item update failed'; END IF;
 PERFORM public.admin_catalog_manage_http('create-item',NULL,'12345','admin-catalog-create-001','admin-catalog-new','New item','Description',50,'PERSONAL');
 r:=public.admin_catalog_manage_http('create-item',NULL,'12345','admin-catalog-create-001','admin-catalog-new','New item','Description',50,'PERSONAL');
 IF r->>'replay'<>'true' THEN RAISE EXCEPTION 'item create replay expected'; END IF;
 PERFORM public.admin_catalog_manage_http('create-gift-code',NULL,'12345','admin-catalog-gift-001',NULL,NULL,NULL,NULL,NULL,'TEST-CODE','WALLET',100,5,0,20,2,NULL);
 r:=public.admin_catalog_manage_http('create-gift-code',NULL,'12345','admin-catalog-gift-001',NULL,NULL,NULL,NULL,NULL,'TEST-CODE','WALLET',100,5,0,20,2,NULL);
 IF r->>'replay'<>'true' THEN RAISE EXCEPTION 'gift code replay expected'; END IF;
 SELECT count(*) INTO a FROM public."AdminAuditLog" WHERE "idempotencyKey" IN ('admin-catalog-update-001','admin-catalog-create-001','admin-catalog-gift-001');
 IF a<>3 THEN RAISE EXCEPTION 'expected 3 audit rows, got %',a; END IF;
 IF has_function_privilege('anon','public.admin_catalog_manage_http(text,text,text,text,text,text,text,bigint,text,text,public."GiftCodeRewardType",bigint,bigint,bigint,integer,integer,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'anon must not execute admin catalog management'; END IF;
 IF has_function_privilege('authenticated','public.admin_catalog_manage_http(text,text,text,text,text,text,text,bigint,text,text,public."GiftCodeRewardType",bigint,bigint,bigint,integer,integer,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'authenticated must not execute admin catalog management'; END IF;
 BEGIN
  PERFORM public.admin_catalog_manage_http('create-gift-code',NULL,'12345','admin-catalog-gift-001',NULL,NULL,NULL,NULL,NULL,'OTHER-CODE','WALLET',100,5,0,20,2,NULL);
  RAISE EXCEPTION 'expected idempotency conflict';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $$;
ROLLBACK;
