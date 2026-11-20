-- Isolate each scheduled finalization item so one malformed tournament or
-- expired promotion offer cannot starve the remaining durable work queue.
CREATE OR REPLACE FUNCTION public.process_due_pyramid_work_http(p_now timestamptz,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp
AS $fn$
DECLARE
 v_row record; v_result jsonb; v_completed integer:=0; v_due integer:=0;
 v_accepted integer:=0; v_failed integer:=0;
 v_season integer; v_tier_name text; v_queue jsonb;
BEGIN
 IF p_now IS NULL OR p_limit IS NULL OR p_limit<1 THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_PYRAMID_BATCH',ERRCODE='P0001';
 END IF;

 FOR v_row IN
  SELECT pl."competitionId" FROM public."PyramidLeague" pl
  JOIN public."Competition" c ON c.id=pl."competitionId"
  WHERE pl."promotionProcessedAt" IS NULL AND c.status::text='COMPLETED'
  ORDER BY pl."createdAt" LIMIT LEAST(p_limit,100) FOR UPDATE OF pl SKIP LOCKED
 LOOP
  BEGIN
   v_result:=public.finalize_pyramid_league_http(v_row."competitionId",p_now);
   IF COALESCE((v_result->>'processed')::boolean,false) THEN
    v_completed:=v_completed+1;
   END IF;
  EXCEPTION WHEN OTHERS THEN
   v_failed:=v_failed+1;
   RAISE WARNING 'Pyramid league finalization failed for competition %: %',v_row."competitionId",SQLERRM;
  END;
 END LOOP;

 FOR v_row IN
  SELECT o.id,o."clubId",o."targetTier",o."leagueId",pl.tier,pl.season,c."ownerId"
  FROM public."LeaguePromotionOffer" o
  JOIN public."PyramidLeague" pl ON pl.id=o."leagueId"
  JOIN public."Club" c ON c.id=o."clubId"
  WHERE o.status::text='PENDING' AND o."expiresAt"<=(p_now AT TIME ZONE 'UTC')
  ORDER BY o."expiresAt" LIMIT LEAST(p_limit,100) FOR UPDATE OF o SKIP LOCKED
 LOOP
  BEGIN
   UPDATE public."LeaguePromotionOffer" SET status='ACCEPTED',"resolvedAt"=(p_now AT TIME ZONE 'UTC')
   WHERE id=v_row.id AND status='PENDING' AND "expiresAt"<=(p_now AT TIME ZONE 'UTC');
   IF NOT FOUND THEN CONTINUE; END IF;
   v_season:=v_row.season+1;
   v_tier_name:=public.pyramid_tier_name_http(v_row."targetTier");
   INSERT INTO public."PyramidLeagueApplication"(id,"userId","clubId",tier,season,status,"appliedAt")
   VALUES('pyramid_application_'||replace(gen_random_uuid()::text,'-',''),v_row."ownerId",v_row."clubId",
    v_row."targetTier",v_season,'QUEUED',(p_now AT TIME ZONE 'UTC'))
   ON CONFLICT("clubId",tier,season) DO UPDATE SET status='QUEUED',"appliedAt"=EXCLUDED."appliedAt";
   PERFORM public.adjust_pyramid_club_values_http(v_row."clubId",v_row.tier,v_row."targetTier");
   INSERT INTO public."LeagueNotice"(id,"userId",kind,title,body,"referenceId","createdAt")
   VALUES('league_notice_'||replace(gen_random_uuid()::text,'-',''),v_row."ownerId",'PROMOTION_AUTO_ACCEPTED',
    'صعود به‌صورت خودکار تأیید شد',
    'مهلت پاسخ به پیشنهاد صعود پایان یافت؛ تیم شما در فصل '||v_season||' به '||v_tier_name||' منتقل شد.',
    v_row.id,(p_now AT TIME ZONE 'UTC'));
   v_queue:=public.assign_pyramid_queue_http(v_row."targetTier",v_season,p_now);
   v_accepted:=v_accepted+1;
   v_due:=v_due+1;
  EXCEPTION WHEN OTHERS THEN
   v_failed:=v_failed+1;
   RAISE WARNING 'Promotion offer processing failed for offer %: %',v_row.id,SQLERRM;
  END;
 END LOOP;

 RETURN jsonb_build_object('completedLeagues',v_completed,'processed',v_due,'accepted',v_accepted,'failed',v_failed);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.process_due_event_tournament_finalizations_http(p_now timestamptz,p_limit integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp
AS $fn$
DECLARE
 v_row record; v_result jsonb; v_candidates integer:=0; v_finalized integer:=0; v_failed integer:=0;
BEGIN
 IF p_now IS NULL OR p_limit IS NULL OR p_limit<1 THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_EVENT_TOURNAMENT_BATCH',ERRCODE='P0001';
 END IF;
 FOR v_row IN
  SELECT et."competitionId" FROM public."EventTournament" et
  JOIN public."Competition" c ON c.id=et."competitionId"
  WHERE et.status::text='ACTIVE' AND c.status::text='COMPLETED'
  ORDER BY et."updatedAt" LIMIT LEAST(p_limit,10) FOR UPDATE OF et SKIP LOCKED
 LOOP
  v_candidates:=v_candidates+1;
  BEGIN
   v_result:=public.finalize_event_tournament_http(v_row."competitionId",p_now);
   IF COALESCE((v_result->>'finalized')::boolean,false) THEN
    v_finalized:=v_finalized+1;
   END IF;
  EXCEPTION WHEN OTHERS THEN
   v_failed:=v_failed+1;
   RAISE WARNING 'Event tournament finalization failed for competition %: %',v_row."competitionId",SQLERRM;
  END;
 END LOOP;
 RETURN jsonb_build_object('candidates',v_candidates,'finalized',v_finalized,'failed',v_failed);
END;
$fn$;

REVOKE ALL ON FUNCTION public.process_due_pyramid_work_http(timestamptz,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.process_due_event_tournament_finalizations_http(timestamptz,integer) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.process_due_pyramid_work_http(timestamptz,integer) TO service_role;
  GRANT EXECUTE ON FUNCTION public.process_due_event_tournament_finalizations_http(timestamptz,integer) TO service_role;
 END IF;
END;
$grant$;
