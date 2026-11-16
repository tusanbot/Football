-- Run after Prisma migrations. Fails CI if any public table is exposed
-- to Supabase's browser-facing roles or lacks row-level security.
DO $$
DECLARE
  missing_rls text;
  exposed_table text;
  exposed_sequence text;
BEGIN
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

  SELECT string_agg(format('%I (%s)', object_name, grantee), ', ')
    INTO exposed_sequence
  FROM information_schema.role_usage_grants
  WHERE object_schema = 'public'
    AND grantee IN ('anon', 'authenticated');

  IF exposed_sequence IS NOT NULL THEN
    RAISE EXCEPTION 'Public sequence USAGE grants remain: %', exposed_sequence;
  END IF;
END $$;
