-- Index-backed search behind one membership check.
--
-- Row level security protects the table for ordinary access. Its policy is a
-- security barrier, so PostgreSQL cannot use the functional GIN index before
-- it evaluates membership for each candidate row. This function checks the
-- transaction identity once, then searches as the schema owner. The owner is
-- still subject to FORCE ROW LEVEL SECURITY and has an explicit true policy.
CREATE FUNCTION public.notesapp_search(
  p_workspace_id uuid,
  p_query text,
  p_limit integer
)
RETURNS TABLE (
  file_id uuid,
  path text,
  revision_id uuid,
  excerpt text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  needle tsquery;
BEGIN
  IF NOT public.notesapp_is_member(p_workspace_id) THEN
    RETURN;
  END IF;
  IF btrim(p_query) = '' THEN
    RETURN;
  END IF;
  needle := websearch_to_tsquery('simple', p_query);

  RETURN QUERY
    WITH matches AS MATERIALIZED (
      SELECT indexed.file_id,
             indexed.path,
             indexed.revision_id,
             indexed.search_text
        FROM public.search_index indexed
       WHERE indexed.workspace_id = p_workspace_id
         AND to_tsvector('simple', indexed.search_text) @@ needle
       ORDER BY indexed.path, indexed.file_id
       LIMIT least(greatest(coalesce(p_limit, 1), 1), 100)
    )
    SELECT matches.file_id,
           matches.path,
           matches.revision_id,
           left(matches.search_text, 1024) AS excerpt
      FROM matches;
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_search(uuid, text, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_search(uuid, text, integer) TO notesapp_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 11;
$$;
