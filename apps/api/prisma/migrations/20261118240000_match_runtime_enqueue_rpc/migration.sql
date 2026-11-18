CREATE OR REPLACE FUNCTION public.get_due_match_runtime_fixtures(p_now timestamp without time zone,p_limit integer)
RETURNS TABLE(match_id text,scheduled_at timestamp without time zone,home_club jsonb,away_club jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $function$
 SELECT m."id",m."scheduledAt",
 jsonb_build_object('id',h."id",'ownerId',h."ownerId",'name',h."name",'formation',h."formation",
 'mentality',h."mentality",'pressing',h."pressing",'tempo',h."tempo",'passingStyle',h."passingStyle",
 'stadiumLevel',h."stadiumLevel",'ticketPrice',h."ticketPrice"::text,'reputation',h."reputation",
 'matchFallbackPlan',h."matchFallbackPlan",'coachMedicalSkill',COALESCE(hc."medicalSkill",0),
 'players',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p."id",'firstName',p."firstName",'lastName',p."lastName",
 'position',p."position"::text,'overall',p."overall",'lineupSlot',p."lineupSlot",'morale',p."morale",
 'fitness',p."fitness",'attributes',p."attributes",'suspensionMatchesRemaining',p."suspensionMatchesRemaining")
 ORDER BY p."lineupSlot" ASC NULLS LAST,p."overall" DESC,p."id" ASC)
 FROM public."Player" p WHERE p."clubId"=h."id" AND p."status"::text='ACTIVE'),'[]'::jsonb)),
 jsonb_build_object('id',a."id",'ownerId',a."ownerId",'name',a."name",'formation',a."formation",
 'mentality',a."mentality",'pressing',a."pressing",'tempo',a."tempo",'passingStyle',a."passingStyle",
 'stadiumLevel',a."stadiumLevel",'ticketPrice',a."ticketPrice"::text,'reputation',a."reputation",
 'matchFallbackPlan',a."matchFallbackPlan",'coachMedicalSkill',COALESCE(ac."medicalSkill",0),
 'players',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p."id",'firstName',p."firstName",'lastName',p."lastName",
 'position',p."position"::text,'overall',p."overall",'lineupSlot',p."lineupSlot",'morale',p."morale",
 'fitness',p."fitness",'attributes',p."attributes",'suspensionMatchesRemaining',p."suspensionMatchesRemaining")
 ORDER BY p."lineupSlot" ASC NULLS LAST,p."overall" DESC,p."id" ASC)
 FROM public."Player" p WHERE p."clubId"=a."id" AND p."status"::text='ACTIVE'),'[]'::jsonb))
 FROM public."FootballMatch" m JOIN public."Club" h ON h."id"=m."homeClubId"
 JOIN public."Club" a ON a."id"=m."awayClubId"
 LEFT JOIN public."Coach" hc ON hc."clubId"=h."id" LEFT JOIN public."Coach" ac ON ac."clubId"=a."id"
 WHERE m."status"::text='SCHEDULED' AND m."scheduledAt"<=p_now
 AND NOT EXISTS(SELECT 1 FROM public."MatchRuntime" r WHERE r."matchId"=m."id")
 ORDER BY m."scheduledAt",m."createdAt" LIMIT LEAST(GREATEST(p_limit,1),100);
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_match_runtime_snapshots(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $function$
DECLARE inserted_count integer;
BEGIN
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>100 THEN
  RAISE EXCEPTION 'INVALID_MATCH_RUNTIME_SNAPSHOT_BATCH';
 END IF;
 INSERT INTO public."MatchRuntime"("id","matchId","status","currentMinute","stateVersion","nextActionAt",
  "kickoffSnapshot","fallbackPlan","createdAt","updatedAt")
 SELECT gen_random_uuid()::text,row.match_id,'QUEUED',0,1,row.scheduled_at,row.kickoff_snapshot,row.fallback_plan,NOW(),NOW()
 FROM jsonb_to_recordset(p_rows) AS row(match_id text,scheduled_at timestamp without time zone,kickoff_snapshot jsonb,fallback_plan jsonb)
 ON CONFLICT("matchId") DO NOTHING;
 GET DIAGNOSTICS inserted_count=ROW_COUNT;
 RETURN inserted_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_due_match_runtime_fixtures(timestamp without time zone,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enqueue_match_runtime_snapshots(jsonb) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT EXECUTE ON FUNCTION public.get_due_match_runtime_fixtures(timestamp without time zone,integer) TO service_role;
 GRANT EXECUTE ON FUNCTION public.enqueue_match_runtime_snapshots(jsonb) TO service_role;
END IF; END $grant$;
