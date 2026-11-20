CREATE OR REPLACE FUNCTION public.admin_catalog_manage_http(
 p_action text,p_target_id text,p_actor_telegram_id text,p_idempotency_key text,
 p_item_slug text DEFAULT NULL,p_item_name text DEFAULT NULL,p_item_description text DEFAULT NULL,
 p_item_cost bigint DEFAULT NULL,p_item_scope text DEFAULT NULL,
 p_code text DEFAULT NULL,p_reward_type public."GiftCodeRewardType" DEFAULT NULL,
 p_cash_amount bigint DEFAULT NULL,p_gold_amount bigint DEFAULT NULL,p_group_points bigint DEFAULT NULL,
 p_max_redemptions integer DEFAULT NULL,p_per_user_limit integer DEFAULT NULL,p_expires_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE
 v_existing public."AdminAuditLog"%ROWTYPE; v_metadata jsonb; v_target_id text; v_target_type text;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('create-item','item-update','create-gift-code')
  OR p_actor_telegram_id IS NULL OR p_actor_telegram_id !~ '^[0-9]{1,20}$'
  OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 12 AND 160 THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_CATALOG_ACTION',ERRCODE='22023';
 END IF;
 IF p_action IN ('create-item','item-update') THEN
  IF (p_action='create-item' AND (p_item_slug IS NULL OR p_item_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' OR length(p_item_slug) NOT BETWEEN 3 AND 48
      OR p_item_name IS NULL OR length(btrim(p_item_name)) NOT BETWEEN 2 AND 80
      OR p_item_description IS NULL OR length(btrim(p_item_description)) NOT BETWEEN 2 AND 500
      OR p_item_cost IS NULL OR p_item_cost < 0 OR p_item_scope IS NULL OR p_item_scope NOT IN ('PERSONAL','GROUP')))
   OR (p_action='item-update' AND (p_target_id IS NULL OR length(p_target_id) NOT BETWEEN 1 AND 128
      OR (p_item_name IS NULL AND p_item_description IS NULL AND p_item_cost IS NULL)
      OR (p_item_name IS NOT NULL AND length(btrim(p_item_name)) NOT BETWEEN 2 AND 80)
      OR (p_item_description IS NOT NULL AND length(btrim(p_item_description)) NOT BETWEEN 2 AND 500)
      OR (p_item_cost IS NOT NULL AND p_item_cost < 0))) THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_ITEM',ERRCODE='22023';
  END IF;
  v_target_type:='item';
 ELSIF p_action='create-gift-code' THEN
  IF p_code IS NULL OR p_code !~ '^[A-Za-z0-9_-]{4,32}$'
   OR p_reward_type IS NULL OR p_max_redemptions IS NULL OR p_max_redemptions NOT BETWEEN 1 AND 100000
   OR p_per_user_limit IS NULL OR p_per_user_limit NOT BETWEEN 1 AND 1000
   OR COALESCE(p_cash_amount,0)<0 OR COALESCE(p_gold_amount,0)<0 OR COALESCE(p_group_points,0)<0
   OR COALESCE(p_cash_amount,0)>9223372036854775807-COALESCE(p_gold_amount,0)
   OR (p_reward_type='GROUP_POINTS' AND COALESCE(p_group_points,0)<=0)
   OR (p_reward_type='WALLET' AND COALESCE(p_cash_amount,0)+COALESCE(p_gold_amount,0)<=0) THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_GIFT_CODE',ERRCODE='22023';
  END IF;
  v_target_type:='gift-code';
 END IF;
 v_metadata:=jsonb_build_object(
  'targetId',p_target_id,'itemSlug',p_item_slug,'itemName',p_item_name,'itemDescription',p_item_description,
  'itemCost',p_item_cost::text,'itemScope',p_item_scope,'code',upper(p_code),
  'rewardType',p_reward_type::text,'cashAmount',COALESCE(p_cash_amount,0)::text,
  'goldAmount',COALESCE(p_gold_amount,0)::text,'groupPoints',COALESCE(p_group_points,0)::text,
  'maxRedemptions',p_max_redemptions,'perUserLimit',p_per_user_limit,'expiresAt',p_expires_at
 );
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
 SELECT * INTO v_existing FROM public."AdminAuditLog" WHERE "idempotencyKey"=p_idempotency_key;
 IF FOUND THEN
  IF v_existing."actorTelegramId"=p_actor_telegram_id AND v_existing.action=p_action
   AND v_existing.metadata=v_metadata THEN
   RETURN jsonb_build_object('ok',true,'targetType',v_existing."targetType",'targetId',v_existing."targetId",'replay',true);
  END IF;
  RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_KEY_REUSED',ERRCODE='23505';
 END IF;
 IF p_action='create-item' THEN
  v_target_id:=gen_random_uuid()::text;
  INSERT INTO public."GroupRewardItem"(id,slug,name,description,cost,scope,active,"createdAt")
  VALUES(v_target_id,p_item_slug,btrim(p_item_name),btrim(p_item_description),p_item_cost,p_item_scope,true,clock_timestamp());
 ELSIF p_action='item-update' THEN
  UPDATE public."GroupRewardItem" SET
   name=COALESCE(btrim(p_item_name),name),
   description=COALESCE(btrim(p_item_description),description),
   cost=COALESCE(p_item_cost,cost)
  WHERE id=p_target_id RETURNING id INTO v_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002'; END IF;
 ELSE
  v_target_id:=gen_random_uuid()::text;
  INSERT INTO public."GiftCode"(id,code,"rewardType","cashAmount","goldAmount","groupPoints","maxRedemptions","perUserLimit","expiresAt","createdByTelegramId","createdAt")
  VALUES(v_target_id,upper(p_code),p_reward_type,COALESCE(p_cash_amount,0),COALESCE(p_gold_amount,0),COALESCE(p_group_points,0),p_max_redemptions, p_per_user_limit,p_expires_at,p_actor_telegram_id,clock_timestamp());
 END IF;
 INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId",metadata,"idempotencyKey","createdAt")
 VALUES(gen_random_uuid()::text,p_actor_telegram_id,p_action,v_target_type,v_target_id,v_metadata,p_idempotency_key,clock_timestamp());
 RETURN jsonb_build_object('ok',true,'targetType',v_target_type,'targetId',v_target_id,'replay',false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_catalog_manage_http(text,text,text,text,text,text,text,bigint,text,text,public."GiftCodeRewardType",bigint,bigint,bigint,integer,integer,timestamptz) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.admin_catalog_manage_http(text,text,text,text,text,text,text,bigint,text,text,public."GiftCodeRewardType",bigint,bigint,bigint,integer,integer,timestamptz) TO service_role;
 END IF;
END;
$grant$;
