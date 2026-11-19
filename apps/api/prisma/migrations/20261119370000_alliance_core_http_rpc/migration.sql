-- Core alliance mutations executed atomically through Supabase HTTP RPC.
CREATE OR REPLACE FUNCTION public.create_alliance_http(p_telegram_user_id text,p_telegram_group_id text,p_name text,p_description text,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; a public."Alliance"%ROWTYPE; old public."Alliance"%ROWTYPE; days integer:=30;
BEGIN
 IF p_telegram_user_id !~ '^[0-9]{1,20}$' OR p_telegram_group_id !~ '^-?[0-9]{1,20}$' OR length(btrim(p_name)) NOT BETWEEN 3 AND 60 OR length(coalesce(p_description,''))>300 OR p_idempotency_key !~ '^[A-Za-z0-9_-]{12,64}$' THEN RAISE EXCEPTION USING MESSAGE='INVALID_ALLIANCE_REQUEST',ERRCODE='22023'; END IF;
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id FOR UPDATE;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF u."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Club" WHERE "ownerId"=u.id) THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF NOT g."isActive" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 IF g."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_SUSPENDED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id AND role<>'MEMBER') THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO old FROM public."Alliance" WHERE slug=p_idempotency_key;
 IF old.id IS NOT NULL THEN
  IF old."createdByGroupId"<>g.id OR old.name<>p_name OR old.description<>coalesce(p_description,'') THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN jsonb_build_object('alliance',to_jsonb(old),'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public."AllianceGroup" WHERE "groupId"=g.id) THEN RETURN jsonb_build_object('error','GROUP_ALREADY_IN_ALLIANCE'); END IF;
 INSERT INTO public."Alliance"(id,slug,name,description,"createdByGroupId","createdAt","updatedAt") VALUES(gen_random_uuid()::text,p_idempotency_key,btrim(p_name),coalesce(p_description,''),g.id,now(),now()) RETURNING * INTO a;
 INSERT INTO public."AllianceGroup"(id,"allianceId","groupId",role,"joinedAt") VALUES(gen_random_uuid()::text,a.id,g.id,'FOUNDER',now());
 SELECT CASE WHEN jsonb_typeof(value)='number' THEN (value#>>'{}')::integer ELSE 30 END INTO days FROM public."GameSetting" WHERE key='alliances.defaultSeasonDurationDays';
 IF days IS NULL OR days<7 OR days>90 THEN days:=30; END IF;
 INSERT INTO public."AllianceSeason"(id,"allianceId",number,status,"startsAt","endsAt","createdAt") VALUES(gen_random_uuid()::text,a.id,1,'ACTIVE',now(),now()+make_interval(days=>days),now());
 INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt") VALUES(gen_random_uuid()::text,a.id,p_telegram_user_id,p_telegram_group_id,'ALLIANCE_CREATED',jsonb_build_object('name',a.name),now());
 RETURN jsonb_build_object('alliance',to_jsonb(a),'replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.invite_alliance_group_http(p_telegram_user_id text,p_telegram_group_id text,p_target_telegram_group_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; target public."TelegramGroup"%ROWTYPE; m public."AllianceGroup"%ROWTYPE; a public."Alliance"%ROWTYPE; inv public."AllianceInvitation"%ROWTYPE;
BEGIN
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF NOT g."isActive" OR g."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id AND role<>'MEMBER') THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO m FROM public."AllianceGroup" WHERE "groupId"=g.id;
 IF m.id IS NULL THEN RETURN jsonb_build_object('error','ALLIANCE_NOT_FOUND'); END IF;
 SELECT * INTO a FROM public."Alliance" WHERE id=m."allianceId";
 IF a.status<>'ACTIVE' THEN RETURN jsonb_build_object('error','ALLIANCE_INACTIVE'); END IF;
 SELECT * INTO target FROM public."TelegramGroup" WHERE "telegramId"=p_target_telegram_group_id FOR UPDATE;
 IF target.id IS NULL THEN RETURN jsonb_build_object('error','TARGET_GROUP_NOT_FOUND'); END IF;
 IF NOT target."isActive" OR target."isSuspended" THEN RETURN jsonb_build_object('error','TARGET_GROUP_INACTIVE'); END IF;
 IF target.id=g.id THEN RETURN jsonb_build_object('error','CANNOT_INVITE_SELF'); END IF;
 IF EXISTS(SELECT 1 FROM public."AllianceGroup" WHERE "groupId"=target.id) THEN RETURN jsonb_build_object('error','TARGET_ALREADY_IN_ALLIANCE'); END IF;
 INSERT INTO public."AllianceInvitation"(id,"allianceId","groupId","invitedByGroupId",status,"createdAt") VALUES(gen_random_uuid()::text,a.id,target.id,g.id,'PENDING',now())
 ON CONFLICT("allianceId","groupId") DO UPDATE SET status='PENDING',"invitedByGroupId"=EXCLUDED."invitedByGroupId","respondedAt"=NULL,"createdAt"=now() RETURNING * INTO inv;
 INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt") VALUES(gen_random_uuid()::text,a.id,p_telegram_user_id,p_telegram_group_id,'GROUP_INVITED',jsonb_build_object('targetGroupId',p_target_telegram_group_id,'invitationId',inv.id),now());
 RETURN jsonb_build_object('invitation',to_jsonb(inv),'alliance',jsonb_build_object('id',a.id,'name',a.name));
END $$;

CREATE OR REPLACE FUNCTION public.respond_alliance_invitation_http(p_telegram_user_id text,p_telegram_group_id text,p_invitation_id text,p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; inv public."AllianceInvitation"%ROWTYPE; a public."Alliance"%ROWTYPE;
BEGIN
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id AND role<>'MEMBER') THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO inv FROM public."AllianceInvitation" WHERE id=p_invitation_id AND "groupId"=g.id FOR UPDATE;
 IF inv.id IS NULL THEN RETURN jsonb_build_object('error','INVITATION_NOT_FOUND'); END IF;
 IF inv.status<>'PENDING' THEN RETURN jsonb_build_object('accepted',inv.status='ACCEPTED','replayed',true); END IF;
 SELECT * INTO a FROM public."Alliance" WHERE id=inv."allianceId" FOR UPDATE;
 IF p_accept THEN
  IF a.status<>'ACTIVE' THEN RETURN jsonb_build_object('error','ALLIANCE_INACTIVE'); END IF;
  IF EXISTS(SELECT 1 FROM public."AllianceGroup" WHERE "groupId"=g.id) THEN RETURN jsonb_build_object('error','GROUP_ALREADY_IN_ALLIANCE'); END IF;
  INSERT INTO public."AllianceGroup"(id,"allianceId","groupId",role,"joinedAt") VALUES(gen_random_uuid()::text,a.id,g.id,'MEMBER',now());
 END IF;
 UPDATE public."AllianceInvitation" SET status=CASE WHEN p_accept THEN 'ACCEPTED' ELSE 'DECLINED' END,"respondedAt"=now() WHERE id=inv.id RETURNING * INTO inv;
 INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt") VALUES(gen_random_uuid()::text,a.id,p_telegram_user_id,p_telegram_group_id,CASE WHEN p_accept THEN 'INVITATION_ACCEPTED' ELSE 'INVITATION_DECLINED' END,jsonb_build_object('invitationId',inv.id),now());
 RETURN jsonb_build_object('accepted',p_accept,'replayed',false,'allianceName',a.name);
END $$;

CREATE OR REPLACE FUNCTION public.contribute_alliance_treasury_http(p_telegram_user_id text,p_telegram_group_id text,p_amount bigint,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE u public."User"%ROWTYPE; g public."TelegramGroup"%ROWTYPE; m public."AllianceGroup"%ROWTYPE; a public."Alliance"%ROWTYPE; old public."AllianceLedger"%ROWTYPE; points bigint;
BEGIN
 IF p_amount IS NULL OR p_amount<=0 OR p_amount>1000000000 OR p_idempotency_key !~ '^[A-Za-z0-9_-]{12,64}$' THEN RAISE EXCEPTION USING MESSAGE='INVALID_CONTRIBUTION_AMOUNT',ERRCODE='22023'; END IF;
 SELECT * INTO u FROM public."User" WHERE "telegramId"=p_telegram_user_id FOR UPDATE;
 IF u.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF u."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 SELECT * INTO g FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF g.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF NOT g."isActive" OR g."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=g.id AND "userId"=u.id AND role<>'MEMBER') THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO m FROM public."AllianceGroup" WHERE "groupId"=g.id;
 IF m.id IS NULL THEN RETURN jsonb_build_object('error','ALLIANCE_NOT_FOUND'); END IF;
 SELECT * INTO a FROM public."Alliance" WHERE id=m."allianceId" FOR UPDATE;
 SELECT * INTO old FROM public."AllianceLedger" WHERE "idempotencyKey"=p_idempotency_key;
 IF old.id IS NOT NULL THEN
  IF old."allianceId"<>a.id OR old.amount<>p_amount OR old.source<>'GROUP_CONTRIBUTION' THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN jsonb_build_object('contributed',true,'replayed',true,'treasuryPoints',a."treasuryPoints"::text);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public."AllianceSeason" WHERE "allianceId"=a.id AND status='ACTIVE') THEN RETURN jsonb_build_object('error','SEASON_REVIEW_REQUIRED'); END IF;
 UPDATE public."TelegramGroup" SET points=points-p_amount WHERE id=g.id AND points>=p_amount RETURNING points INTO points;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','INSUFFICIENT_GROUP_POINTS'); END IF;
 UPDATE public."Alliance" SET "treasuryPoints"="treasuryPoints"+p_amount,"updatedAt"=now() WHERE id=a.id RETURNING * INTO a;
 INSERT INTO public."AllianceLedger"(id,"allianceId","idempotencyKey",amount,source,description,"createdAt") VALUES(gen_random_uuid()::text,a.id,p_idempotency_key,p_amount,'GROUP_CONTRIBUTION','Contribution from Telegram group '||g.title,now());
 INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt") VALUES(gen_random_uuid()::text,'alliance-contribution:'||p_idempotency_key,g.id,u.id,-p_amount,'ADMIN_ADJUSTMENT','Contribution to alliance treasury',now());
 INSERT INTO public."AllianceAuditLog"(id,"allianceId","actorTelegramId","groupTelegramId",action,metadata,"createdAt") VALUES(gen_random_uuid()::text,a.id,p_telegram_user_id,p_telegram_group_id,'TREASURY_CONTRIBUTION',jsonb_build_object('amount',p_amount::text,'idempotencyKey',p_idempotency_key),now());
 RETURN jsonb_build_object('contributed',true,'replayed',false,'treasuryPoints',a."treasuryPoints"::text,'groupPoints',points::text);
END $$;
