-- Read-only catalog of active special players for the Cloudflare HTTP runtime.
CREATE OR REPLACE FUNCTION public.get_active_special_players()
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'id', player.id, 'slug', player.slug, 'fullName', player."fullName",
    'nationality', player.nationality, 'birthDate', player."birthDate",
    'positions', player.positions, 'rarity', player.rarity::text,
    'overall', player.overall, 'potential', player.potential,
    'attributes', player.attributes, 'acquisitionMethods', player."acquisitionMethods"
  )
  FROM public."SpecialPlayer" AS player
  WHERE player.active = TRUE
  ORDER BY player.rarity DESC, player.overall DESC, player.id ASC;
$function$;

REVOKE ALL ON FUNCTION public.get_active_special_players() FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_active_special_players() TO service_role';
  END IF;
END;
$grant$;
