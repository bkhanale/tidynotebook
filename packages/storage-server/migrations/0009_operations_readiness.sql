-- Runtime-visible deployment schema version.
-- The application role cannot read Drizzle's private migration table. This
-- narrow function proves that the complete reviewed migration set applied.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 10;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_schema_version() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_schema_version() TO notesapp_app;
