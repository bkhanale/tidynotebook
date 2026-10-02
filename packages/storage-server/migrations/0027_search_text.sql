-- One text search configuration for every language (record 0167).
--
-- `simple` keeps each word as it is written, with no stemming and no stop
-- words of one language, and the `unaccent` filter lets a letter with an
-- accent match the same letter without one. `unaccent` is a trusted
-- extension, so the migration role installs it and no superuser is needed,
-- as for `btree_gin` in the first migration. It goes into `public`. An
-- installation that already holds it in another schema keeps it there, and
-- the configuration names the dictionary in that schema.
DO $$
DECLARE
	dictionary_schema name;
BEGIN
	SELECT n.nspname INTO dictionary_schema
		FROM pg_catalog.pg_extension e
		JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
		WHERE e.extname = 'unaccent';
	IF dictionary_schema IS NULL THEN
		CREATE EXTENSION unaccent SCHEMA public;
		dictionary_schema := 'public';
	END IF;
	CREATE TEXT SEARCH CONFIGURATION public.notesapp_text (COPY = pg_catalog.simple);
	EXECUTE format(
		'ALTER TEXT SEARCH CONFIGURATION public.notesapp_text '
		'ALTER MAPPING FOR hword, hword_part, word WITH %I.unaccent, pg_catalog.simple',
		dictionary_schema);
END
$$;--> statement-breakpoint

-- The table is rewritten once. The rows of the earlier rule hold raw
-- Markdown, so they go now, and `src/search-index-migration.ts` writes the
-- row of every live note again, in short batches, after the SQL (record
-- 0167). On the empty table the new stored vector and its index cost
-- nothing, so this migration holds its lock for a moment only. Search
-- answers the notes that the rebuild has reached until it ends, and the
-- server serves only after the migrations.
TRUNCATE TABLE "search_index";--> statement-breakpoint
ALTER TABLE "search_index" drop column "document";--> statement-breakpoint
ALTER TABLE "search_index" ADD COLUMN "document" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('public.notesapp_text'::regconfig, title), 'A') || setweight(to_tsvector('public.notesapp_text'::regconfig, body), 'B')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "search_index" ADD COLUMN "text_rule" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- The drop of the column took its index with it.
CREATE INDEX "search_index_document_idx" ON "search_index" USING gin ("workspace_id","document");--> statement-breakpoint

-- Search with the one configuration (record 0167). The rules that change
-- from migration 0022:
--
-- - The words of the query come from the parser and the configuration of the
--   index, through `ts_debug`, so a host such as example.com, a number such
--   as 3.14 and a word in any script read as the index reads them.
-- - A word of three characters or more matches as a prefix, which takes the
--   place of stemming. A shorter word matches only itself, so one letter
--   never reads most of the index.
-- - The body is the readable text of the note, so the excerpt quotes what a
--   reader sees.
-- - The excerpt reads a window of the body around the first place where a
--   query word starts, never the whole body. `ts_headline` parses all of the
--   text that it gets, and a long note cost most of the time of a search for
--   a common word (issue 265). The place is a match at the start of a word,
--   in any case, on the body as it is stored, so no position comes from a
--   folded copy. A body that is shorter than the window is read whole, and a
--   body with no such place shows its start.
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
  word record;
  quoted text;
  part tsquery;
  needle tsquery := NULL;
  patterns text[] := '{}';
  -- The window of the excerpt, and how much of it comes before the match.
  window_length constant integer := 1024;
  window_lead constant integer := 256;
  -- A word shorter than this matches only itself.
  prefix_length constant integer := 3;
BEGIN
  IF NOT public.notesapp_is_member(p_workspace_id) THEN
    RETURN;
  END IF;

  FOR word IN
    SELECT DISTINCT ON (lexeme) debug.token, lexeme
      FROM ts_debug('public.notesapp_text', left(coalesce(p_query, ''), 256))
             AS debug,
           unnest(debug.lexemes) AS lexeme
     WHERE lexeme <> ''
     LIMIT 16
  LOOP
    -- A lexeme reaches the query as one quoted lexeme, so no character of it
    -- is an operator.
    quoted := ''''
      || replace(replace(word.lexeme, '\', '\\'), '''', '''''')
      || '''';
    part := CASE
      WHEN char_length(word.lexeme) < prefix_length THEN quoted::tsquery
      ELSE (quoted || ':*')::tsquery
    END;
    needle := CASE WHEN needle IS NULL THEN part ELSE needle && part END;
    -- The place of the word in the body: the word as the person typed it, or
    -- its lexeme, at the start of a word. Every character that is not a
    -- letter or a digit is escaped, so it reads as itself.
    patterns := patterns || (
      '\m('
      || regexp_replace(word.token, '([^[:alnum:]_])', '\\\1', 'g')
      || '|'
      || regexp_replace(word.lexeme, '([^[:alnum:]_])', '\\\1', 'g')
      || ')'
      || CASE WHEN char_length(word.lexeme) < prefix_length THEN '\M' ELSE '' END
    );
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
      -- The size test reads the stored size and not the text.
      SELECT page.*,
             CASE
               WHEN octet_length(page.body) <= window_length THEN page.body
               ELSE substr(
                 page.body,
                 greatest(
                   1,
                   coalesce(
                     (SELECT min(at)
                        FROM unnest(patterns) AS pattern,
                             LATERAL regexp_instr(page.body, pattern, 1, 1, 0, 'i')
                               AS at
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
