-- The default theme family has no opinion.
--
-- See docs/decisions/0056-the-default-theme-has-no-opinion.md. The column holds
-- an opaque slug of the client theme registry and never a colour, so this
-- default and defaultThemeFamilyId in packages/ui/src/themes/index.ts state one
-- fact in two places and move together.
--
-- A stored row keeps the family it already names. The default answers a row
-- that is written without one.
ALTER TABLE "account_preferences" ALTER COLUMN "theme_family" SET DEFAULT 'default';--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the seventh entry, so the function reports seven.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 7;
$$;
