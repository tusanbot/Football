-- Read-only, bounded opponent discovery for the Supabase HTTP runtime.
CREATE OR REPLACE FUNCTION public.list_match_opponents_http(p_user_id text, p_search text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_own_club_id text;
  v_query text := NULLIF(btrim(left(COALESCE(p_search, ''), 80)), '');
  v_opponents jsonb;
BEGIN
  IF p_user_id IS NULL OR length(btrim(p_user_id)) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_USER', ERRCODE = 'P0001';
  END IF;

  SELECT c.id INTO v_own_club_id
  FROM public."Club" c
  WHERE c."ownerId" = p_user_id
  LIMIT 1;
  IF v_own_club_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', candidate.id,
    'name', candidate.name,
    'level', candidate.level,
    'reputation', candidate.reputation,
    'ownerTelegramId', candidate."ownerTelegramId",
    'ownerUsername', candidate."ownerUsername",
    'lastActiveAt', candidate."lastActiveAt"
  ) ORDER BY
    CASE WHEN v_query IS NOT NULL THEN candidate.reputation END DESC NULLS LAST,
    CASE WHEN v_query IS NOT NULL THEN candidate.level END DESC NULLS LAST,
    CASE WHEN v_query IS NULL THEN candidate."lastActiveAt" END DESC NULLS LAST,
    CASE WHEN v_query IS NULL THEN candidate."createdAt" END DESC NULLS LAST
  ), '[]'::jsonb)
  INTO v_opponents
  FROM (
    SELECT c.id, c.name, c.level, c.reputation, c."createdAt",
      u."telegramId" AS "ownerTelegramId", u.username AS "ownerUsername", u."lastActiveAt"
    FROM public."Club" c
    JOIN public."User" u ON u.id = c."ownerId"
    WHERE c.id <> v_own_club_id
      AND EXISTS (
        SELECT 1 FROM public."Player" selected
        WHERE selected."clubId" = c.id AND selected.status::text = 'ACTIVE'
          AND selected."lineupSlot" IS NOT NULL
      )
      AND (
        SELECT count(*) FROM public."Player" eligible
        WHERE eligible."clubId" = c.id AND eligible.status::text = 'ACTIVE'
          AND eligible."suspensionMatchesRemaining" = 0
      ) >= 11
      AND EXISTS (
        SELECT 1 FROM public."Player" keeper
        WHERE keeper."clubId" = c.id AND keeper.status::text = 'ACTIVE'
          AND keeper."suspensionMatchesRemaining" = 0 AND keeper.position::text = 'GK'
      )
      AND (
        v_query IS NULL
        OR c.name ILIKE '%' || v_query || '%'
        OR u."telegramId" = regexp_replace(v_query, '^@', '')
        OR (left(v_query, 1) = '@' AND u.username = substr(v_query, 2))
      )
    ORDER BY
      CASE WHEN v_query IS NOT NULL THEN c.reputation END DESC NULLS LAST,
      CASE WHEN v_query IS NOT NULL THEN c.level END DESC NULLS LAST,
      CASE WHEN v_query IS NULL THEN u."lastActiveAt" END DESC NULLS LAST,
      CASE WHEN v_query IS NULL THEN c."createdAt" END DESC NULLS LAST
    LIMIT CASE WHEN v_query IS NULL THEN 10 ELSE 25 END
  ) candidate;
  RETURN v_opponents;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_match_opponents_http(text, text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.list_match_opponents_http(text, text) TO service_role';
  END IF;
END;
$grant$;
