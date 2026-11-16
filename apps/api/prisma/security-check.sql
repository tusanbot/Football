-- Run after Prisma migrations. Fails CI if any public table is exposed
-- to Supabase's browser-facing roles or lacks row-level security.
DO $$
DECLARE
  missing_rls text;
  exposed_table text;
  exposed_sequence text;
  exposed_function text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'The server-side migration/API role must bypass RLS';
  END IF;

  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ')
    INTO missing_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relrowsecurity;

  IF missing_rls IS NOT NULL THEN
    RAISE EXCEPTION 'RLS is disabled on public tables: %', missing_rls;
  END IF;

  SELECT string_agg(format('%I.%I (%s)', table_name, grantee, privilege_type), ', ')
    INTO exposed_table
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('anon', 'authenticated');

  IF exposed_table IS NOT NULL THEN
    RAISE EXCEPTION 'Public table grants remain: %', exposed_table;
  END IF;

  SELECT string_agg(format('%I (%s)', c.relname, role_name), ', ')
    INTO exposed_sequence
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL (VALUES ('anon'), ('authenticated')) AS roles(role_name)
  WHERE n.nspname = 'public'
    AND c.relkind = 'S'
    AND (
      has_sequence_privilege(roles.role_name, c.oid, 'USAGE')
      OR has_sequence_privilege(roles.role_name, c.oid, 'SELECT')
      OR has_sequence_privilege(roles.role_name, c.oid, 'UPDATE')
    );

  IF exposed_sequence IS NOT NULL THEN
    RAISE EXCEPTION 'Public sequence privileges remain: %', exposed_sequence;
  END IF;

  SELECT string_agg(format('%I', p.proname), ', ')
    INTO exposed_function
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );

  IF exposed_function IS NOT NULL THEN
    RAISE EXCEPTION 'Public function EXECUTE privileges remain: %', exposed_function;
  END IF;
END $$;
