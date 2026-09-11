ALTER TABLE "account_preferences" ADD COLUMN "theme_family" text DEFAULT 'tokyo-night' NOT NULL;--> statement-breakpoint

-- Roles, rights, row level security, immutability, and the stored functions
--
-- The schema version is the number of entries in the migration journal. This
-- migration is the second entry, so the function reports two. Rights survive
-- a replacement, so the grants of the initial migration still apply.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 2;
$$;
