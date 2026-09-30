-- Better Auth 1.7.3 and later key an account by its provider and its account
-- identifier, and never write an issuer, from record 0135. The old key goes
-- before its column, so no index is left on the remaining columns.
ALTER TABLE "auth_account" DROP CONSTRAINT "auth_account_key";--> statement-breakpoint
ALTER TABLE "auth_account" DROP COLUMN "issuer";--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_key" UNIQUE("provider_id","account_id");--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the twenty-second entry, so the function reports twenty-two.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 22;
$$;
