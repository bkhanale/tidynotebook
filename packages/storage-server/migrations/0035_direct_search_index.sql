-- Pending GIN entries increase the cost of every search between maintenance
-- runs and can make the planner scan every stored vector instead (issue 326).
-- Direct writes keep the index ready for a search. This changes no query,
-- text rule, rank, excerpt, membership check, or row access policy.
ALTER INDEX public.search_index_document_idx SET (fastupdate = false);--> statement-breakpoint

-- Turning fastupdate off affects future writes only. Drain the entries that
-- an earlier release left before this migration completes. The migration
-- role owns the index, so this needs no superuser or added role right.
SELECT pg_catalog.gin_clean_pending_list('public.search_index_document_idx'::regclass);--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT 36; $$;
