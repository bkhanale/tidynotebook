ALTER TABLE "account_preferences" ADD COLUMN "spell_check" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- The spell check of the editor, from record 0103.
--
-- An account that never chose has its spelling checked, so every row written
-- before this migration takes the default. The default and defaultSpellCheck
-- in packages/core state one fact in two places and move together. The
-- runtime role already holds the update right of the whole table.

-- The schema version is the number of entries in the migration journal. This
-- migration is the twelfth entry, so the function reports twelve.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 12;
$$;
