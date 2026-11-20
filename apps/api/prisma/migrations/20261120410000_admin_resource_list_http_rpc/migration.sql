CREATE OR REPLACE FUNCTION public.get_admin_resource_list_http(
 p_resource text,p_limit integer,p_query text DEFAULT NULL,p_season integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_result jsonb;
BEGIN
 IF p_resource IS NULL OR p_resource NOT IN ('players','clubs','users','groups','challenges','leagues','items','gift-codes','alliances','matches','alliance-seasons','season-awards')
  OR p_limit IS NULL OR p_limit<1 OR p_limit>100
  OR (p_query IS NOT NULL AND length(p_query)>100)
  OR (p_season IS NOT NULL AND (p_season<2020 OR p_season>2200)) THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_RESOURCE_QUERY',ERRCODE='22023';
 END IF;
 CASE p_resource
 WHEN 'clubs' THEN
  SELECT COALESCE(jsonb_agg(q.row_data),'[]'::jsonb) INTO v_result FROM (
   SELECT to_jsonb(c)||jsonb_build_object('wageArrears',c."wageArrears"::text,'ticketPrice',c."ticketPrice"::text,'operatingArrears',c."operatingArrears"::text,
    'owner',jsonb_build_object('telegramId',u."telegramId",'displayName',u."displayName"),
    '_count',jsonb_build_object('players',(SELECT count(*) FROM public."Player" p WHERE p."clubId"=c.id),'homeMatches',(SELECT count(*) FROM public."FootballMatch" m WHERE m."homeClubId"=c.id),'awayMatches',(SELECT count(*) FROM public."FootballMatch" m WHERE m."awayClubId"=c.id))) AS row_data
   FROM public."Club" c JOIN public."User" u ON u.id=c."ownerId"
   WHERE p_query IS NULL OR c.name ILIKE '%'||p_query||'%' OR c.slug ILIKE '%'||p_query||'%' OR u."telegramId" ILIKE '%'||p_query||'%'
   ORDER BY c."createdAt" DESC LIMIT p_limit
  ) q;
 WHEN 'players' THEN
  SELECT COALESCE(jsonb_agg(q.row_data),'[]'::jsonb) INTO v_result FROM (
   SELECT to_jsonb(p)||jsonb_build_object('marketValue',p."marketValue"::text,'wage',p.wage::text,'club',jsonb_build_object('id',c.id,'name',c.name)) AS row_data
   FROM public."Player" p JOIN public."Club" c ON c.id=p."clubId"
   WHERE p_query IS NULL OR p."firstName" ILIKE '%'||p_query||'%' OR p."lastName" ILIKE '%'||p_query||'%' OR c.name ILIKE '%'||p_query||'%'
   ORDER BY p."createdAt" DESC LIMIT p_limit
  ) q;
 WHEN 'users' THEN
  SELECT COALESCE(jsonb_agg(q.row_data),'[]'::jsonb) INTO v_result FROM (
   SELECT to_jsonb(u)||jsonb_build_object('club',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id',c.id,'name',c.name,'level',c.level) END) AS row_data
   FROM public."User" u LEFT JOIN public."Club" c ON c."ownerId"=u.id
   WHERE p_query IS NULL OR u."telegramId" ILIKE '%'||p_query||'%' OR COALESCE(u.username,'') ILIKE '%'||p_query||'%' OR COALESCE(u."displayName",'') ILIKE '%'||p_query||'%'
   ORDER BY u."createdAt" DESC LIMIT p_limit
  ) q;
 WHEN 'groups' THEN
  SELECT COALESCE(jsonb_agg(q.row_data),'[]'::jsonb) INTO v_result FROM (
   SELECT to_jsonb(g)||jsonb_build_object('points',g.points::text,'_count',jsonb_build_object(
    'memberships',(SELECT count(*) FROM public."GroupMembership" gm WHERE gm."groupId"=g.id),
    'challenges',(SELECT count(*) FROM public."GroupChallenge" ch WHERE ch."groupId"=g.id))) AS row_data
   FROM public."TelegramGroup" g WHERE p_query IS NULL OR g.title ILIKE '%'||p_query||'%'
   ORDER BY g."createdAt" DESC LIMIT p_limit
  ) q;
 WHEN 'challenges' THEN
  SELECT COALESCE(jsonb_agg(q.row_data),'[]'::jsonb) INTO v_result FROM (
   SELECT to_jsonb(ch)||jsonb_build_object('rewardPoints',ch."rewardPoints"::text,
    'group',jsonb_build_object('title',g.title,'telegramId',g."telegramId"),
    '_count',jsonb_build_object('participants',(SELECT count(*) FROM public."GroupChallengeParticipant" cp WHERE cp."challengeId"=ch.id))) AS row_data
   FROM public."GroupChallenge" ch JOIN public."TelegramGroup" g ON g.id=ch."groupId"
   WHERE p_query IS NULL OR ch.title ILIKE '%'||p_query||'%' OR g.title ILIKE '%'||p_query||'%'
   ORDER BY ch."createdAt" DESC LIMIT p_limit
  ) q;
 WHEN 'leagues' THEN
  SELECT COALESCE(jsonb_agg(q.row_data),'[]'::jsonb) INTO v_result FROM (
   SELECT to_jsonb(c)||jsonb_build_object('_count',jsonb_build_object(
    'entries',(SELECT count(*) FROM public."CompetitionEntry" e WHERE e."competitionId"=c.id),
    'matches',(SELECT count(*) FROM public."FootballMatch" m WHERE m."competitionId"=c.id)),
    'pyramidLeague',CASE WHEN pl.id IS NULL THEN NULL ELSE jsonb_build_object('id',pl.id) END) AS row_data
   FROM public."Competition" c LEFT JOIN public."PyramidLeague" pl ON pl."competitionId"=c.id
   WHERE p_query IS NULL OR c.name ILIKE '%'||p_query||'%'
   ORDER BY c."createdAt" DESC LIMIT p_limit
  ) q;
 WHEN 'items' THEN
  SELECT COALESCE(jsonb_agg(q.row_data),'[]'::jsonb) INTO v_result FROM (
   SELECT to_jsonb(i)||jsonb_build_object('cost',i.cost::text,'_count',jsonb_build_object('grants',(SELECT count(*) FROM public."GroupRewardGrant" gr WHERE gr."itemId"=i.id))) AS row_data
   FROM public."GroupRewardItem" i WHERE p_query IS NULL OR i.name ILIKE '%'||p_query||'%' OR i.slug ILIKE '%'||p_query||'%'
   ORDER BY i."createdAt" DESC LIMIT p_limit
  ) q;
 WHEN 'gift-codes' THEN
  SELECT COALESCE(jsonb_agg(q.row_data),'[]'::jsonb) INTO v_result FROM (
   SELECT to_jsonb(gc)||jsonb_build_object('cashAmount',gc."cashAmount"::text,'goldAmount',gc."goldAmount"::text,'groupPoints',gc."groupPoints"::text,
    '_count',jsonb_build_object('redemptions',(SELECT count(*) FROM public."GiftCodeRedemption" gr WHERE gr."giftCodeId"=gc.id))) AS row_data
   FROM public."GiftCode" gc WHERE p_query IS NULL OR gc.code ILIKE '%'||p_query||'%'
   ORDER BY gc."createdAt" DESC LIMIT p_limit
  ) q;
 WHEN 'alliances' THEN
  SELECT COALESCE(jsonb_agg(q.row_data),'[]'::jsonb) INTO v_result FROM (
   SELECT to_jsonb(a)||jsonb_build_object('treasuryPoints',a."treasuryPoints"::text,
    '_count',jsonb_build_object('groups',(SELECT count(*) FROM public."AllianceGroup" ag WHERE ag."allianceId"=a.id),
     'seasons',(SELECT count(*) FROM public."AllianceSeason" s WHERE s."allianceId"=a.id),
     'competitions',(SELECT count(*) FROM public."Competition" c WHERE c."allianceId"=a.id)),
    'seasons',COALESCE((SELECT jsonb_agg(to_jsonb(s2) ORDER BY s2.number DESC) FROM
      (SELECT s.* FROM public."AllianceSeason" s WHERE s."allianceId"=a.id ORDER BY s.number DESC LIMIT 3) s2),'[]'::jsonb)) AS row_data
   FROM public."Alliance" a WHERE p_query IS NULL OR a.name ILIKE '%'||p_query||'%' OR a.slug ILIKE '%'||p_query||'%'
   ORDER BY a."createdAt" DESC LIMIT p_limit
  ) q;
 WHEN 'matches' THEN
  SELECT COALESCE(jsonb_agg(q.row_data),'[]'::jsonb) INTO v_result FROM (
   SELECT to_jsonb(m)||jsonb_build_object('ticketRevenue',m."ticketRevenue"::text,
    'homeClub',jsonb_build_object('name',h.name),'awayClub',jsonb_build_object('name',a.name),
    'competition',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name',c.name) END) AS row_data
   FROM public."FootballMatch" m JOIN public."Club" h ON h.id=m."homeClubId"
   JOIN public."Club" a ON a.id=m."awayClubId" LEFT JOIN public."Competition" c ON c.id=m."competitionId"
   ORDER BY m."scheduledAt" DESC LIMIT p_limit
  ) q;
 WHEN 'alliance-seasons' THEN
  SELECT COALESCE(jsonb_agg(q.row_data),'[]'::jsonb) INTO v_result FROM (
   SELECT to_jsonb(s)||jsonb_build_object('alliance',jsonb_build_object('name',a.name,'status',a.status)) AS row_data
   FROM public."AllianceSeason" s JOIN public."Alliance" a ON a.id=s."allianceId"
   WHERE p_query IS NULL OR a.name ILIKE '%'||p_query||'%'
   ORDER BY s."createdAt" DESC LIMIT p_limit
  ) q;
 WHEN 'season-awards' THEN
  SELECT COALESCE(jsonb_agg(q.row_data),'[]'::jsonb) INTO v_result FROM (
   SELECT to_jsonb(sa)||jsonb_build_object('player',jsonb_build_object('id',p.id,'firstName',p."firstName",'lastName',p."lastName",'position',p.position,
    'club',jsonb_build_object('name',c.name))) AS row_data
   FROM public."SeasonPlayerAward" sa JOIN public."Player" p ON p.id=sa."playerId" JOIN public."Club" c ON c.id=p."clubId"
   WHERE (p_season IS NULL OR sa.season=p_season) AND (p_query IS NULL OR sa."awardName" ILIKE '%'||p_query||'%' OR sa."awardType" ILIKE '%'||p_query||'%' OR p."firstName" ILIKE '%'||p_query||'%' OR p."lastName" ILIKE '%'||p_query||'%')
   ORDER BY sa.season DESC,sa."awardType" ASC LIMIT p_limit
  ) q;
 ELSE
  RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_RESOURCE',ERRCODE='22023';
 END CASE;
 RETURN COALESCE(v_result,'[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_admin_resource_list_http(text,integer,text,integer) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.get_admin_resource_list_http(text,integer,text,integer) TO service_role;
 END IF;
END;
$grant$;
