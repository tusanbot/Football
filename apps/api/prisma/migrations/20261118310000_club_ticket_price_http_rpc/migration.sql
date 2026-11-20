-- Compare-and-set stadium ticket price under a row lock; ownership is derived from the verified user id.
CREATE OR REPLACE FUNCTION public.update_club_ticket_price(
  p_user_id text,
  p_ticket_price bigint,
  p_expected_ticket_price bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  club_row public."Club"%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) NOT BETWEEN 1 AND 128
    OR p_ticket_price NOT BETWEEN 10 AND 500
    OR p_expected_ticket_price NOT BETWEEN 0 AND 999 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_TICKET_PRICE', ERRCODE = '22023';
  END IF;

  SELECT * INTO club_row
  FROM public."Club"
  WHERE "ownerId" = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0002';
  END IF;

  IF club_row."ticketPrice" = p_ticket_price THEN
    RETURN jsonb_build_object('ticketPrice', p_ticket_price::text,
      'previousTicketPrice', p_expected_ticket_price::text, 'replayed', true);
  END IF;

  IF club_row."ticketPrice" <> p_expected_ticket_price THEN
    RAISE EXCEPTION USING MESSAGE = 'TICKET_PRICE_CONFLICT', ERRCODE = '40001';
  END IF;

  UPDATE public."Club"
  SET "ticketPrice" = p_ticket_price, "updatedAt" = now()
  WHERE id = club_row.id AND "ownerId" = p_user_id;

  RETURN jsonb_build_object('ticketPrice', p_ticket_price::text,
    'previousTicketPrice', club_row."ticketPrice"::text, 'replayed', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_club_ticket_price(text, bigint, bigint) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_club_ticket_price(text, bigint, bigint) TO service_role';
  END IF;
END;
$grant$;
