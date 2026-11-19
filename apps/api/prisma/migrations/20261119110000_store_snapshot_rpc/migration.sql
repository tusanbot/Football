-- Read-only store snapshot for the Supabase HTTP runtime.
CREATE OR REPLACE FUNCTION public.get_store_snapshot(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_USER', ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object(
    'wallets', COALESCE((SELECT jsonb_agg(jsonb_build_object('asset', w.asset::text, 'balance', w.balance::text) ORDER BY w.asset::text)
      FROM public."Wallet" w WHERE w."userId" = p_user_id), '[]'::jsonb),
    'inventory', COALESCE((SELECT jsonb_agg(jsonb_build_object('itemKey', i."itemKey", 'quantity', i.quantity, 'updatedAt', i."updatedAt") ORDER BY i."updatedAt" DESC)
      FROM public."StoreInventoryItem" i WHERE i."userId" = p_user_id AND i.quantity > 0), '[]'::jsonb),
    'specialPlayers', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'fullName', p."fullName", 'nationality', p.nationality,
      'positions', p.positions, 'rarity', p.rarity::text, 'overall', p.overall, 'potential', p.potential)
      ORDER BY p.rarity DESC, p.overall DESC)
      FROM (SELECT * FROM public."SpecialPlayer" WHERE active ORDER BY rarity DESC, overall DESC LIMIT 60) p), '[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_store_snapshot(text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_store_snapshot(text) TO service_role';
  END IF;
END;
$grant$;
