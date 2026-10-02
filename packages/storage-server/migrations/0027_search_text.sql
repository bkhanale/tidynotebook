-- One text search configuration for every language (record 0167).
--
-- `simple` keeps each word as it is written, with no stemming and no stop
-- words of one language, and the `unaccent` filter lets a letter with an
-- accent match the same letter without one. `unaccent` is a trusted
-- extension, so the migration role installs it and no superuser is needed,
-- as for `btree_gin` in the first migration.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION public.notesapp_text (COPY = pg_catalog.simple);--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION public.notesapp_text
	ALTER MAPPING FOR hword, hword_part, word WITH public.unaccent, pg_catalog.simple;--> statement-breakpoint
ALTER TABLE "search_index" drop column "document";--> statement-breakpoint
ALTER TABLE "search_index" ADD COLUMN "document" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('public.notesapp_text'::regconfig, title), 'A') || setweight(to_tsvector('public.notesapp_text'::regconfig, body), 'B')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "search_index" ADD COLUMN "text_rule" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- The drop of the column took its index with it.
CREATE INDEX "search_index_document_idx" ON "search_index" USING gin ("workspace_id","document");--> statement-breakpoint

-- Search with the one configuration (record 0167). Three rules change from
-- migration 0022:
--
-- - Every word matches as a prefix, which takes the place of stemming.
-- - The body is the readable text of the note, so the excerpt quotes what a
--   reader sees.
-- - The excerpt reads a window of the body around the first place of a query
--   word, never the whole body. `ts_headline` parses all of the text that it
--   gets, and a long note cost most of the time of a search for a common word
--   (issue 265). A body that is shorter than the window is read whole.
CREATE OR REPLACE FUNCTION public.notesapp_search(
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
SET client_min_messages = warning
AS $$
DECLARE
  terms text[];
  term text;
  part tsquery;
  needle tsquery := NULL;
  -- The window of the excerpt, and how much of it comes before the match.
  window_length constant integer := 1024;
  window_lead constant integer := 256;
BEGIN
  IF NOT public.notesapp_is_member(p_workspace_id) THEN
    RETURN;
  END IF;

  terms := ARRAY(
    SELECT left(word, 64)
      FROM unnest(
             regexp_split_to_array(lower(coalesce(p_query, '')), '[^[:alnum:]]+')
           ) AS word
     WHERE word <> ''
     LIMIT 16
  );

  FOREACH term IN ARRAY terms LOOP
    -- A term holds letters and digits only, so the text reaches the parser as
    -- a word and never as an operator.
    part := to_tsquery('public.notesapp_text', term || ':*');
    IF part::text <> '' THEN
      needle := CASE WHEN needle IS NULL THEN part ELSE needle && part END;
    END IF;
  END LOOP;

  IF needle IS NULL THEN
    RETURN;
  END IF;

  -- The page is ranked and cut first, and only its rows build an excerpt.
  -- The match, the rank and the title test read the stored vector, so no
  -- row parses its text again.
  RETURN QUERY
    WITH page AS MATERIALIZED (
      SELECT indexed.file_id,
             indexed.path,
             indexed.body,
             indexed.revision_id,
             ts_filter(indexed.document, '{a}') @@ needle AS named,
             ts_rank_cd(
               '{0.1, 0.2, 0.4, 1.0}'::float4[],
               indexed.document,
               needle
             ) AS rank
        FROM public.search_index indexed
       WHERE indexed.workspace_id = p_workspace_id
         AND indexed.document @@ needle
       ORDER BY named DESC, rank DESC, indexed.path, indexed.file_id
       LIMIT least(greatest(coalesce(p_limit, 1), 1), 100)
    ),
    windowed AS (
      -- The size test reads the stored size and not the text. A long body
      -- finds the first place of a query word as it is written first, which
      -- stops at the first hit. Only a body with no such place reads its
      -- whole text folded, for a word in another case or with an accent.
      -- A body with no place at all shows its start.
      SELECT page.*,
             CASE
               WHEN octet_length(page.body) <= window_length THEN page.body
               ELSE substr(
                 page.body,
                 greatest(
                   1,
                   coalesce(
                     (SELECT min(at)
                        FROM unnest(terms) AS word,
                             LATERAL strpos(page.body, word) AS at
                       WHERE at > 0),
                     (SELECT min(at)
                        FROM (SELECT public.unaccent(lower(page.body)) AS text) AS folded,
                             unnest(terms) AS word,
                             LATERAL strpos(folded.text, public.unaccent(word)) AS at
                       WHERE at > 0),
                     1
                   ) - window_lead
                 ),
                 window_length
               )
             END AS source
        FROM page
    )
    SELECT windowed.file_id,
           windowed.path,
           windowed.revision_id,
           ts_headline(
             'public.notesapp_text',
             translate(windowed.source, chr(1) || chr(2), ''),
             needle,
             'StartSel="' || chr(1) || '", StopSel="' || chr(2) || '",'
               || ' MaxWords=28, MinWords=10, ShortWord=2, MaxFragments=2,'
               || ' FragmentDelimiter=" ... "'
           ) AS excerpt
      FROM windowed
     ORDER BY windowed.named DESC, windowed.rank DESC, windowed.path, windowed.file_id;
END
$$;--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the twenty-eighth entry, so the function reports twenty-eight.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 28;
$$;
