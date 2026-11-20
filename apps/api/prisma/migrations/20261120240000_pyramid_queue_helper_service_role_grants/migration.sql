-- Pyramid finalization and queue RPCs are SECURITY INVOKER. Grant their
-- internal helper functions to service_role explicitly after PUBLIC is revoked.
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.pyramid_tier_name_http(integer) TO service_role;
  GRANT EXECUTE ON FUNCTION public.pyramid_tier_bps_http(integer) TO service_role;
  GRANT EXECUTE ON FUNCTION public.adjust_pyramid_club_values_http(text,integer,integer) TO service_role;
  GRANT EXECUTE ON FUNCTION public.assign_pyramid_queue_http(integer,integer,timestamptz) TO service_role;
 END IF;
END;
$grant$;
