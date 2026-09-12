ALTER TABLE "account_preferences" ALTER COLUMN "theme_family" SET DEFAULT 'ink';--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the third entry, so the function reports three. Rights survive
-- a replacement, so the grants of the initial migration still apply.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 3;
$$;
