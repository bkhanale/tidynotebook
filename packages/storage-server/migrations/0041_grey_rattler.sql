ALTER TABLE "workspace_welcome_notes" ADD COLUMN "attempted_at" timestamp with time zone;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notesapp_schema_version() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT 42; $$;
