CREATE OR REPLACE FUNCTION public.pyramid_tier_name_http(p_tier integer)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_temp
AS $fn$ SELECT CASE p_tier WHEN 1 THEN 'لیگ پایه' WHEN 2 THEN 'لیگ آماتور' WHEN 3 THEN 'لیگ منطقه‌ای'
 WHEN 4 THEN 'لیگ نیمه‌حرفه‌ای' WHEN 5 THEN 'لیگ حرفه‌ای' WHEN 6 THEN 'لیگ برتر (فوق‌حرفه‌ای)'
 WHEN 7 THEN 'لیگ قهرمانان' ELSE NULL END $fn$;

CREATE OR REPLACE FUNCTION public.pyramid_tier_bps_http(p_tier integer)
RETURNS bigint LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_temp
AS $fn$ SELECT CASE p_tier WHEN 1 THEN 10000 WHEN 2 THEN 11000 WHEN 3 THEN 12000
 WHEN 4 THEN 13000 WHEN 5 THEN 14500 WHEN 6 THEN 16000 WHEN 7 THEN 18000 ELSE NULL END::bigint $fn$;

CREATE OR REPLACE FUNCTION public.adjust_pyramid_club_values_http(p_club_id text,p_from_tier integer,p_to_tier integer)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp
AS $fn$
DECLARE v_from bigint:=public.pyramid_tier_bps_http(p_from_tier); v_to bigint:=public.pyramid_tier_bps_http(p_to_tier); v_count integer:=0;
BEGIN
 IF v_from IS NULL OR v_to IS NULL OR p_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE='INVALID_LEAGUE_TIER',ERRCODE='P0001'; END IF;
 UPDATE public."Player" SET "marketValue"=("marketValue"*v_to+v_from/2)/v_from,
  "updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC') WHERE "clubId"=p_club_id;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 UPDATE public."PlayerMarketListing" l SET "askingPrice"=(l."askingPrice"*v_to+v_from/2)/v_from,
  "updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC')
 FROM public."Player" p WHERE p.id=l."playerId" AND p."clubId"=p_club_id AND l.status::text='OPEN';
 RETURN v_count;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.assign_pyramid_queue_http(p_tier integer,p_season integer,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp
AS $fn$
DECLARE v_app_ids text[]; v_club_ids text[]; v_slots text[]; v_group integer; v_level text;
 v_key text; v_comp_id text; v_league_id text; v_rules jsonb;
 v_kickoff timestamptz; v_local timestamp; v_i integer; v_round integer; v_home text; v_away text;
 v_fixture_key text; v_fixtures integer:=0; v_entries integer:=0;
BEGIN
 IF public.pyramid_tier_name_http(p_tier) IS NULL OR p_season<2000 OR p_now IS NULL THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_LEAGUE_TIER',ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('pyramid-queue:'||p_tier||':'||p_season,0));
 SELECT array_agg(q.id ORDER BY q."appliedAt",q.id),array_agg(q."clubId" ORDER BY q."appliedAt",q.id)
 INTO v_app_ids,v_club_ids FROM (
  SELECT id,"clubId","appliedAt" FROM public."PyramidLeagueApplication"
  WHERE tier=p_tier AND season=p_season AND status::text='QUEUED'
  ORDER BY "appliedAt",id LIMIT 8
 ) q;
 IF COALESCE(cardinality(v_app_ids),0)<8 THEN
  RETURN jsonb_build_object('created',false,'waitingTeams',COALESCE(cardinality(v_app_ids),0),'requiredTeams',8);
 END IF;
 SELECT count(*)+1 INTO v_group FROM public."PyramidLeague" WHERE tier=p_tier AND season=p_season;
 v_level:=public.pyramid_tier_name_http(p_tier);
 v_key:='pyramid:'||p_tier||':'||p_season||':'||v_group;
 v_rules:='{"maxSubstitutions":5,"maxInPlayWindows":3,"injuriesEnabled":true,"injuryDurationDays":5,"redCardSuspensionMatches":1,"yellowCardsToSuspend":3,"yellowCardSuspensionMatches":1,"penaltiesOnDraw":false}'::jsonb;
 v_local:=(p_now+interval '1 day') AT TIME ZONE 'Asia/Tehran';
 v_kickoff:=(date_trunc('hour',v_local)+CASE WHEN date_part('minute',v_local)>0 OR date_part('second',v_local)>0
  THEN interval '1 hour' ELSE interval '0 hour' END) AT TIME ZONE 'Asia/Tehran';
 v_comp_id:='competition_'||replace(gen_random_uuid()::text,'-','');
 INSERT INTO public."Competition"(id,"idempotencyKey",name,season,format,status,"maxTeams","cupLegs",rules,"createdByClubId","startsAt","createdAt","updatedAt")
 VALUES(v_comp_id,v_key,v_level||' · گروه '||v_group,p_season,'LEAGUE','ACTIVE',8,1,v_rules,v_club_ids[1],v_kickoff,
  (p_now AT TIME ZONE 'UTC'),(p_now AT TIME ZONE 'UTC'));
 INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId","joinedAt")
 SELECT 'competition_entry_'||replace(gen_random_uuid()::text,'-',''),v_comp_id,c,(p_now AT TIME ZONE 'UTC') FROM unnest(v_club_ids) c;
 v_league_id:='pyramid_league_'||replace(gen_random_uuid()::text,'-','');
 INSERT INTO public."PyramidLeague"(id,"competitionId",tier,season,"groupNumber","createdAt")
 VALUES(v_league_id,v_comp_id,p_tier,p_season,v_group,(p_now AT TIME ZONE 'UTC'));
 INSERT INTO public."PyramidLeagueEntry"(id,"leagueId","clubId","joinedAt")
 SELECT 'pyramid_entry_'||replace(gen_random_uuid()::text,'-',''),v_league_id,c,(p_now AT TIME ZONE 'UTC') FROM unnest(v_club_ids) c;
 UPDATE public."PyramidLeagueApplication" SET status='ASSIGNED',"assignedLeagueId"=v_league_id
 WHERE id=ANY(v_app_ids) AND status::text='QUEUED';
 v_slots:=ARRAY(SELECT c FROM unnest(v_club_ids) c ORDER BY random());
 FOR v_round IN 1..7 LOOP
  FOR v_i IN 1..4 LOOP
   IF ((v_round-1)+(v_i-1))%2=1 THEN v_home:=v_slots[9-v_i];v_away:=v_slots[v_i];
   ELSE v_home:=v_slots[v_i];v_away:=v_slots[9-v_i]; END IF;
   v_fixture_key:=v_key||':r'||v_round||':'||v_home||':'||v_away;
   INSERT INTO public."FootballMatch"(id,"idempotencyKey",type,status,"homeClubId","awayClubId","competitionId",
    "rulesSnapshot",round,"scheduledAt",seed,"createdAt","updatedAt")
   VALUES('match_'||replace(gen_random_uuid()::text,'-',''),v_fixture_key,'LEAGUE','SCHEDULED',v_home,v_away,v_comp_id,
    v_rules,v_round,v_kickoff+((v_round-1)*interval '1 day'),v_fixture_key,
    (p_now AT TIME ZONE 'UTC'),(p_now AT TIME ZONE 'UTC'));
   v_fixtures:=v_fixtures+1;
  END LOOP;
  v_slots:=ARRAY[v_slots[1],v_slots[8],v_slots[2],v_slots[3],v_slots[4],v_slots[5],v_slots[6],v_slots[7]];
 END LOOP;
 GET DIAGNOSTICS v_entries=ROW_COUNT;
 RETURN jsonb_build_object('created',true,'leagueId',v_league_id,'competitionId',v_comp_id,'tier',p_tier,
  'season',p_season,'groupNumber',v_group,'teams',8,'fixturesCreated',v_fixtures);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finalize_pyramid_league_http(p_competition_id text,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp
AS $fn$
DECLARE v_league public."PyramidLeague"%ROWTYPE; v_comp_status text; v_count integer; v_pos integer:=0;
 v_entry record; v_ranked text[]:=ARRAY[]::text[]; v_tier_name text; v_offer_id text; v_owner text;
 v_queue jsonb:='{"created":false}'; v_awards integer:=0; v_offers integer:=0; v_relegated integer:=0;
BEGIN
 IF COALESCE(btrim(p_competition_id),'')='' OR p_now IS NULL THEN RAISE EXCEPTION USING MESSAGE='INVALID_COMPETITION',ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('pyramid-finalize:'||p_competition_id,0));
 SELECT pl.*,c.status::text AS competition_status INTO v_league
 FROM public."PyramidLeague" pl JOIN public."Competition" c ON c.id=pl."competitionId"
 WHERE pl."competitionId"=p_competition_id FOR UPDATE OF pl,c;
 IF NOT FOUND OR v_league."promotionProcessedAt" IS NOT NULL OR v_league.competition_status<>'COMPLETED' THEN
  RETURN jsonb_build_object('processed',false,'replayed',true); END IF;
 SELECT count(*) INTO v_count FROM public."PyramidLeagueEntry" WHERE "leagueId"=v_league.id;
 IF v_count<>8 THEN RAISE EXCEPTION USING MESSAGE='PYRAMID_LEAGUE_REQUIRES_EIGHT_TEAMS',ERRCODE='P0001'; END IF;
 v_tier_name:=public.pyramid_tier_name_http(v_league.tier);
 IF v_tier_name IS NULL THEN RAISE EXCEPTION USING MESSAGE='INVALID_LEAGUE_TIER',ERRCODE='P0001'; END IF;
 FOR v_entry IN
  SELECT e."clubId",c.name,c."ownerId",ce.points,ce."goalsFor",ce."goalsAgainst",ce.won,
   row_number() OVER(ORDER BY ce.points DESC,(ce."goalsFor"-ce."goalsAgainst") DESC,
    ce."goalsFor" DESC,ce.won DESC,c.id ASC) AS position
  FROM public."PyramidLeagueEntry" e JOIN public."Club" c ON c.id=e."clubId"
  JOIN public."CompetitionEntry" ce ON ce."competitionId"=p_competition_id AND ce."clubId"=e."clubId"
  WHERE e."leagueId"=v_league.id
  ORDER BY position
 LOOP
  v_pos:=v_entry.position;v_ranked:=array_append(v_ranked,v_entry."clubId");
  UPDATE public."PyramidLeagueEntry" SET "finalPosition"=v_pos WHERE "leagueId"=v_league.id AND "clubId"=v_entry."clubId";
 END LOOP;
 IF cardinality(v_ranked)<>8 THEN RAISE EXCEPTION USING MESSAGE='PYRAMID_LEAGUE_STANDINGS_INCOMPLETE',ERRCODE='P0001'; END IF;
 UPDATE public."PyramidLeague" SET "promotionProcessedAt"=(p_now AT TIME ZONE 'UTC') WHERE id=v_league.id AND "promotionProcessedAt" IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('processed',false,'replayed',true); END IF;
 INSERT INTO public."LeagueAward"(id,"leagueId","clubId",season,tier,placement,"awardName","awardType","createdAt")
 VALUES
 ('league_award_'||replace(gen_random_uuid()::text,'-',''),v_league.id,v_ranked[1],v_league.season,v_league.tier,1,'جام قهرمانی '||v_tier_name,'TROPHY_GOLD',(p_now AT TIME ZONE 'UTC')),
 ('league_award_'||replace(gen_random_uuid()::text,'-',''),v_league.id,v_ranked[2],v_league.season,v_league.tier,2,'مدال نقره '||v_tier_name,'MEDAL_SILVER',(p_now AT TIME ZONE 'UTC')),
 ('league_award_'||replace(gen_random_uuid()::text,'-',''),v_league.id,v_ranked[3],v_league.season,v_league.tier,3,'مدال برنز '||v_tier_name,'MEDAL_BRONZE',(p_now AT TIME ZONE 'UTC'))
 ON CONFLICT("leagueId",placement) DO NOTHING;
 GET DIAGNOSTICS v_awards=ROW_COUNT;
 IF v_league.tier<7 THEN
  FOR v_pos IN 1..2 LOOP
   SELECT c."ownerId" INTO v_owner FROM public."Club" c WHERE c.id=v_ranked[v_pos];
   v_offer_id:='promotion_offer_'||replace(gen_random_uuid()::text,'-','');
   INSERT INTO public."LeaguePromotionOffer"(id,"leagueId","clubId","targetTier","finalPosition","status","offeredAt","expiresAt")
   VALUES(v_offer_id,v_league.id,v_ranked[v_pos],v_league.tier+1,v_pos,'PENDING',(p_now AT TIME ZONE 'UTC'),(p_now+interval '24 hours') AT TIME ZONE 'UTC')
   ON CONFLICT("leagueId","clubId") DO NOTHING;
   IF FOUND THEN
    INSERT INTO public."LeagueNotice"(id,"userId",kind,title,body,"referenceId","createdAt")
    VALUES('league_notice_'||replace(gen_random_uuid()::text,'-',''),v_owner,'PROMOTION_OFFER','پیشنهاد صعود',
     'تیم شما در '||v_tier_name||' جزو دو تیم برتر شده است. برای صعود به '||public.pyramid_tier_name_http(v_league.tier+1)||' باید پیشنهاد را تأیید کنید.',
     v_offer_id,(p_now AT TIME ZONE 'UTC'));
    v_offers:=v_offers+1;
   END IF;
  END LOOP;
 END IF;
 IF v_league.tier>1 THEN
  FOR v_pos IN 7..8 LOOP
   SELECT c."ownerId" INTO v_owner FROM public."Club" c WHERE c.id=v_ranked[v_pos];
   INSERT INTO public."PyramidLeagueApplication"(id,"userId","clubId",tier,season,status,"appliedAt")
   VALUES('pyramid_application_'||replace(gen_random_uuid()::text,'-',''),v_owner,v_ranked[v_pos],v_league.tier-1,v_league.season+1,'QUEUED',(p_now AT TIME ZONE 'UTC'))
   ON CONFLICT("clubId",tier,season) DO UPDATE SET status='QUEUED',"appliedAt"=EXCLUDED."appliedAt";
   PERFORM public.adjust_pyramid_club_values_http(v_ranked[v_pos],v_league.tier,v_league.tier-1);
   INSERT INTO public."LeagueNotice"(id,"userId",kind,title,body,"referenceId","createdAt")
   VALUES('league_notice_'||replace(gen_random_uuid()::text,'-',''),v_owner,'RELEGATION','سقوط به سطح پایین‌تر',
    'تیم شما در فصل بعد در '||public.pyramid_tier_name_http(v_league.tier-1)||' حضور خواهد داشت.',v_league.id,(p_now AT TIME ZONE 'UTC'));
   v_relegated:=v_relegated+1;
  END LOOP;
  v_queue:=public.assign_pyramid_queue_http(v_league.tier-1,v_league.season+1,p_now);
 END IF;
 RETURN jsonb_build_object('processed',true,'replayed',false,'leagueId',v_league.id,'champion',v_ranked[1],
  'runnerUp',v_ranked[2],'thirdPlace',v_ranked[3],'awardsCreated',v_awards,'promotionOffersCreated',v_offers,
  'relegationsProcessed',v_relegated,'nextTierQueue',v_queue);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.respond_promotion_offer_http(p_user_id text,p_offer_id text,p_accept boolean,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp
AS $fn$
DECLARE v_offer public."LeaguePromotionOffer"%ROWTYPE; v_league public."PyramidLeague"%ROWTYPE;
 v_club_id text; v_owner text; v_season integer; v_tier_name text; v_replacement record; v_existing_count integer;
 v_new_id text; v_queue jsonb;
BEGIN
 SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId"=p_user_id;
 IF v_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE='CLUB_NOT_FOUND',ERRCODE='P0001'; END IF;
 SELECT * INTO v_offer FROM public."LeaguePromotionOffer" WHERE id=p_offer_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='PROMOTION_OFFER_NOT_FOUND',ERRCODE='P0001'; END IF;
 IF v_offer."clubId"<>v_club_id THEN RAISE EXCEPTION USING MESSAGE='NOT_PROMOTION_OFFER_OWNER',ERRCODE='P0001'; END IF;
 SELECT * INTO v_league FROM public."PyramidLeague" WHERE id=v_offer."leagueId";
 IF v_offer.status::text<>'PENDING' THEN
  IF NOT ((p_accept AND v_offer.status::text='ACCEPTED') OR (NOT p_accept AND v_offer.status::text='DECLINED')) THEN
   RAISE EXCEPTION USING MESSAGE='PROMOTION_OFFER_ALREADY_RESOLVED',ERRCODE='P0001'; END IF;
  IF p_accept THEN RETURN jsonb_build_object('offer',to_jsonb(v_offer),'accepted',true,'targetTier',v_offer."targetTier",'season',v_league.season+1,'createdLeague',NULL,'replayed',true); END IF;
  SELECT o.id,o."clubId" INTO v_replacement FROM public."LeaguePromotionOffer" o
  WHERE o."leagueId"=v_offer."leagueId" AND o."finalPosition">2 AND o.status::text IN('PENDING','ACCEPTED')
  ORDER BY o."offeredAt" LIMIT 1;
  RETURN jsonb_build_object('offer',to_jsonb(v_offer),'accepted',false,'replayed',true,
   'replacementOfferId',v_replacement.id,'replacementClubId',v_replacement."clubId");
 END IF;
 IF v_offer."expiresAt"<=p_now THEN RAISE EXCEPTION USING MESSAGE='PROMOTION_OFFER_EXPIRED',ERRCODE='P0001'; END IF;
 UPDATE public."LeaguePromotionOffer" SET status=CASE WHEN p_accept THEN 'ACCEPTED'::"PromotionOfferStatus" ELSE 'DECLINED'::"PromotionOfferStatus" END,
  "resolvedAt"=(p_now AT TIME ZONE 'UTC') WHERE id=p_offer_id RETURNING * INTO v_offer;
 v_season:=v_league.season+1;v_tier_name:=public.pyramid_tier_name_http(v_offer."targetTier");
 IF p_accept THEN
  SELECT "ownerId" INTO v_owner FROM public."Club" WHERE id=v_club_id;
  INSERT INTO public."PyramidLeagueApplication"(id,"userId","clubId",tier,season,status,"appliedAt")
  VALUES('pyramid_application_'||replace(gen_random_uuid()::text,'-',''),v_owner,v_club_id,v_offer."targetTier",v_season,'QUEUED',(p_now AT TIME ZONE 'UTC'))
  ON CONFLICT("clubId",tier,season) DO UPDATE SET status='QUEUED',"appliedAt"=EXCLUDED."appliedAt";
  PERFORM public.adjust_pyramid_club_values_http(v_club_id,v_league.tier,v_offer."targetTier");
  INSERT INTO public."LeagueNotice"(id,"userId",kind,title,body,"referenceId","createdAt")
  VALUES('league_notice_'||replace(gen_random_uuid()::text,'-',''),p_user_id,'PROMOTION_ACCEPTED','صعود تأیید شد',
   'تیم شما به '||v_tier_name||' صعود کرد و در صف تشکیل لیگ فصل '||v_season||' قرار گرفت.',p_offer_id,(p_now AT TIME ZONE 'UTC'));
  v_queue:=public.assign_pyramid_queue_http(v_offer."targetTier",v_season,p_now);
  RETURN jsonb_build_object('offer',to_jsonb(v_offer),'accepted',true,'targetTier',v_offer."targetTier",'season',v_season,
   'createdLeague',v_queue,'replayed',false);
 END IF;
 INSERT INTO public."LeagueNotice"(id,"userId",kind,title,body,"referenceId","createdAt")
 VALUES('league_notice_'||replace(gen_random_uuid()::text,'-',''),p_user_id,'PROMOTION_DECLINED','انصراف از صعود ثبت شد',
  'انصراف شما ثبت شد؛ تیم بعدی جدول برای دریافت سهمیه صعود بررسی می‌شود.',p_offer_id,(p_now AT TIME ZONE 'UTC'));
 SELECT count(*) FILTER(WHERE status::text IN('PENDING','ACCEPTED')) INTO v_existing_count
 FROM public."LeaguePromotionOffer" WHERE "leagueId"=v_offer."leagueId";
 IF v_existing_count<2 THEN
  SELECT ce."clubId",c."ownerId",row_number() OVER(ORDER BY ce.points DESC,(ce."goalsFor"-ce."goalsAgainst") DESC,
   ce."goalsFor" DESC,ce.won DESC,c.id ASC) AS position INTO v_replacement
  FROM public."CompetitionEntry" ce JOIN public."Club" c ON c.id=ce."clubId"
  WHERE ce."competitionId"=(SELECT "competitionId" FROM public."PyramidLeague" WHERE id=v_offer."leagueId")
   AND NOT EXISTS(SELECT 1 FROM public."LeaguePromotionOffer" old WHERE old."leagueId"=v_offer."leagueId" AND old."clubId"=ce."clubId")
  ORDER BY position LIMIT 1;
  IF FOUND THEN
   v_new_id:='promotion_offer_'||replace(gen_random_uuid()::text,'-','');
   INSERT INTO public."LeaguePromotionOffer"(id,"leagueId","clubId","targetTier","finalPosition","status","offeredAt","expiresAt")
   VALUES(v_new_id,v_offer."leagueId",v_replacement."clubId",v_offer."targetTier",v_replacement.position,'PENDING',
    (p_now AT TIME ZONE 'UTC'),(p_now+interval '24 hours') AT TIME ZONE 'UTC');
   INSERT INTO public."LeagueNotice"(id,"userId",kind,title,body,"referenceId","createdAt")
   VALUES('league_notice_'||replace(gen_random_uuid()::text,'-',''),v_replacement."ownerId",'PROMOTION_REPLACEMENT','فرصت صعود به شما رسید',
    'به‌دلیل انصراف تیم بالاتر، سهمیه صعود به تیم شما پیشنهاد شده است. برای پذیرش یا رد، وارد بخش لیگ‌ها شوید.',v_new_id,(p_now AT TIME ZONE 'UTC')),
    ('league_notice_'||replace(gen_random_uuid()::text,'-',''),p_user_id,'PROMOTION_REPLACEMENT_NOTIFIED','تیم جایگزین مطلع شد',
    'تیم بعدی جدول از پیشنهاد صعود مطلع شد.',v_new_id,(p_now AT TIME ZONE 'UTC'));
   RETURN jsonb_build_object('offer',to_jsonb(v_offer),'accepted',false,'replacementOfferId',v_new_id,
    'replacementClubId',v_replacement."clubId",'replayed',false);
  END IF;
 END IF;
 RETURN jsonb_build_object('offer',to_jsonb(v_offer),'accepted',false,'replacementClubId',NULL,'replayed',false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.process_due_pyramid_work_http(p_now timestamptz,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp
AS $fn$
DECLARE v_row record; v_result jsonb; v_completed integer:=0; v_due integer:=0; v_accepted integer:=0;
 v_season integer; v_owner text; v_tier_name text; v_queue jsonb;
BEGIN
 IF p_now IS NULL OR p_limit IS NULL OR p_limit<1 THEN RAISE EXCEPTION USING MESSAGE='INVALID_PYRAMID_BATCH',ERRCODE='P0001'; END IF;
 FOR v_row IN SELECT pl."competitionId" FROM public."PyramidLeague" pl JOIN public."Competition" c ON c.id=pl."competitionId"
  WHERE pl."promotionProcessedAt" IS NULL AND c.status::text='COMPLETED'
  ORDER BY pl."createdAt" LIMIT LEAST(p_limit,100) FOR UPDATE OF pl SKIP LOCKED
 LOOP
  v_result:=public.finalize_pyramid_league_http(v_row."competitionId",p_now);
  IF COALESCE((v_result->>'processed')::boolean,false) THEN v_completed:=v_completed+1; END IF;
 END LOOP;
 FOR v_row IN SELECT o.id,o."clubId",o."targetTier",o."leagueId",pl.tier,pl.season,c."ownerId"
  FROM public."LeaguePromotionOffer" o JOIN public."PyramidLeague" pl ON pl.id=o."leagueId"
  JOIN public."Club" c ON c.id=o."clubId"
  WHERE o.status::text='PENDING' AND o."expiresAt"<=(p_now AT TIME ZONE 'UTC')
  ORDER BY o."expiresAt" LIMIT LEAST(p_limit,100) FOR UPDATE OF o SKIP LOCKED
 LOOP
  UPDATE public."LeaguePromotionOffer" SET status='ACCEPTED',"resolvedAt"=(p_now AT TIME ZONE 'UTC')
  WHERE id=v_row.id AND status='PENDING' AND "expiresAt"<=(p_now AT TIME ZONE 'UTC');
  IF NOT FOUND THEN CONTINUE; END IF;
  v_season:=v_row.season+1;v_tier_name:=public.pyramid_tier_name_http(v_row."targetTier");
  INSERT INTO public."PyramidLeagueApplication"(id,"userId","clubId",tier,season,status,"appliedAt")
  VALUES('pyramid_application_'||replace(gen_random_uuid()::text,'-',''),v_row."ownerId",v_row."clubId",v_row."targetTier",v_season,'QUEUED',(p_now AT TIME ZONE 'UTC'))
  ON CONFLICT("clubId",tier,season) DO UPDATE SET status='QUEUED',"appliedAt"=EXCLUDED."appliedAt";
  PERFORM public.adjust_pyramid_club_values_http(v_row."clubId",v_row.tier,v_row."targetTier");
  INSERT INTO public."LeagueNotice"(id,"userId",kind,title,body,"referenceId","createdAt")
  VALUES('league_notice_'||replace(gen_random_uuid()::text,'-',''),v_row."ownerId",'PROMOTION_AUTO_ACCEPTED','صعود به‌صورت خودکار تأیید شد',
   'مهلت پاسخ به پیشنهاد صعود پایان یافت؛ تیم شما در فصل '||v_season||' به '||v_tier_name||' منتقل شد.',v_row.id,(p_now AT TIME ZONE 'UTC'));
  v_queue:=public.assign_pyramid_queue_http(v_row."targetTier",v_season,p_now);
  v_accepted:=v_accepted+1;v_due:=v_due+1;
 END LOOP;
 RETURN jsonb_build_object('completedLeagues',v_completed,'processed',v_due,'accepted',v_accepted);
END;
$fn$;

REVOKE ALL ON FUNCTION public.pyramid_tier_name_http(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pyramid_tier_bps_http(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.adjust_pyramid_club_values_http(text,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.assign_pyramid_queue_http(integer,integer,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finalize_pyramid_league_http(text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.respond_promotion_offer_http(text,text,boolean,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.process_due_pyramid_work_http(timestamptz,integer) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.finalize_pyramid_league_http(text,timestamptz) TO service_role;
  GRANT EXECUTE ON FUNCTION public.respond_promotion_offer_http(text,text,boolean,timestamptz) TO service_role;
  GRANT EXECUTE ON FUNCTION public.process_due_pyramid_work_http(timestamptz,integer) TO service_role;
 END IF;
END;
$grant$;
