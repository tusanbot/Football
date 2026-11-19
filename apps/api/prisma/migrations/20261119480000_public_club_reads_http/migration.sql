CREATE OR REPLACE FUNCTION public.public_club_history_http(p_club_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'finalPosition', ple."finalPosition",
      'league', jsonb_build_object(
        'season', pl.season,
        'tier', pl.tier,
        'competition', jsonb_build_object('status', co.status::text),
        'awards', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'clubId', la."clubId", 'placement', la.placement,
            'awardName', la."awardName", 'awardType', la."awardType"
          ) ORDER BY la.placement)
          FROM public."LeagueAward" la WHERE la."leagueId" = pl.id
        ), '[]'::jsonb),
        'promotionOffers', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'clubId', po."clubId", 'status', po.status::text,
            'targetTier', po."targetTier", 'finalPosition', po."finalPosition",
            'resolvedAt', po."resolvedAt"
          ) ORDER BY po."offeredAt")
          FROM public."LeaguePromotionOffer" po WHERE po."leagueId" = pl.id
        ), '[]'::jsonb)
      )
    ) ORDER BY ple."joinedAt" DESC
  ), '[]'::jsonb)
  FROM public."PyramidLeagueEntry" ple
  JOIN public."PyramidLeague" pl ON pl.id = ple."leagueId"
  JOIN public."Competition" co ON co.id = pl."competitionId"
  WHERE ple."clubId" = p_club_id AND ple."finalPosition" IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.get_public_clubs_http(p_query text DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE v_clubs jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR (p_query IS NOT NULL AND length(p_query) > 40) THEN
    RAISE EXCEPTION USING MESSAGE='INVALID_CLUB_QUERY', ERRCODE='22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'level', c.level,
    'reputation', c.reputation, 'logoMime', c."logoMime",
    'pyramidLeagueEntries', public.public_club_history_http(c.id)
  ) ORDER BY c.name), '[]'::jsonb)
  INTO v_clubs
  FROM (
    SELECT id, name, level, reputation, "logoMime"
    FROM public."Club"
    WHERE p_query IS NULL OR name ILIKE '%' || p_query || '%'
    ORDER BY name, id
    LIMIT 200
  ) c;
  RETURN jsonb_build_object('clubs', v_clubs, 'limit', p_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_club_profile_http(p_club_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', c.id, 'name', c.name, 'slug', c.slug, 'level', c.level,
    'reputation', c.reputation, 'logoMime', c."logoMime",
    'createdAt', c."createdAt",
    'pyramidLeagueEntries', public.public_club_history_http(c.id)
  ) END
  FROM (SELECT id, name, slug, level, reputation, "logoMime", "createdAt"
        FROM public."Club" WHERE id = p_club_id) c
  RIGHT JOIN (SELECT 1) seed ON true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.compare_public_clubs_http(p_first text, p_second text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE v_first jsonb; v_second jsonb; v_matches jsonb;
BEGIN
  IF p_first IS NULL OR p_second IS NULL OR p_first = p_second THEN
    RAISE EXCEPTION USING MESSAGE='INVALID_CLUB_COMPARISON', ERRCODE='22023';
  END IF;
  SELECT jsonb_build_object('id',id,'name',name,'level',level,'reputation',reputation,'logoMime', "logoMime")
  INTO v_first FROM public."Club" WHERE id=p_first;
  SELECT jsonb_build_object('id',id,'name',name,'level',level,'reputation',reputation,'logoMime', "logoMime")
  INTO v_second FROM public."Club" WHERE id=p_second;
  IF v_first IS NULL OR v_second IS NULL THEN
    RETURN jsonb_build_object('clubs', NULL, 'matches', '[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', m.id, 'scheduledAt', m."scheduledAt", 'completedAt', m."completedAt",
    'homeClubId', m."homeClubId", 'awayClubId', m."awayClubId",
    'homeScore', m."homeScore", 'awayScore', m."awayScore", 'type', m.type::text,
    'homeClub', jsonb_build_object('name', hc.name),
    'awayClub', jsonb_build_object('name', ac.name),
    'competition', CASE WHEN co.id IS NULL THEN NULL ELSE jsonb_build_object('name',co.name,'season',co.season) END
  ) ORDER BY m."completedAt" DESC NULLS LAST, m."scheduledAt" DESC), '[]'::jsonb)
  INTO v_matches
  FROM public."FootballMatch" m
  JOIN public."Club" hc ON hc.id=m."homeClubId"
  JOIN public."Club" ac ON ac.id=m."awayClubId"
  LEFT JOIN public."Competition" co ON co.id=m."competitionId"
  WHERE m.status::text='COMPLETED'
    AND ((m."homeClubId"=p_first AND m."awayClubId"=p_second)
      OR (m."homeClubId"=p_second AND m."awayClubId"=p_first));
  RETURN jsonb_build_object('clubs', jsonb_build_array(v_first,v_second), 'matches', v_matches);
END;
$$;

REVOKE ALL ON FUNCTION public.public_club_history_http(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_clubs_http(text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_club_profile_http(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compare_public_clubs_http(text,text) FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT EXECUTE ON FUNCTION public.public_club_history_http(text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.get_public_clubs_http(text,integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.get_public_club_profile_http(text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.compare_public_clubs_http(text,text) TO service_role;
  END IF;
END $$;
