ALTER TABLE "daily_note_settings" ADD COLUMN "folder" text DEFAULT 'Daily notes' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_note_settings" ADD COLUMN "format" text DEFAULT 'YYYY-MM-DD' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_note_settings" ADD CONSTRAINT "daily_note_settings_folder_check" CHECK (char_length("daily_note_settings"."folder") <= 1024);--> statement-breakpoint
ALTER TABLE "daily_note_settings" ADD CONSTRAINT "daily_note_settings_format_check" CHECK (char_length("daily_note_settings"."format") between 1 and 255);;--> statement-breakpoint

-- The folder and the name format of daily notes, from record 0101.
--
-- A member changes both with the rest of their settings, so the runtime role
-- takes the update right of the two new columns beside the three it already
-- holds. The keys of a row stay fixed. The defaults are the fixed path of
-- record 0099, so every row written before this migration keeps its path.
GRANT UPDATE (folder, format) ON public.daily_note_settings TO notesapp_app;--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the eleventh entry, so the function reports eleven.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 11;
$$;
