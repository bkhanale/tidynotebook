-- The notice stream always runs, from record 0131. Every trigger sends its
-- hint with no switch, and the switch and its two functions go.

CREATE OR REPLACE FUNCTION public.notesapp_notify_sync_changes()
	RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		changed uuid;
	BEGIN
		FOR changed IN
			SELECT DISTINCT i.workspace_id FROM inserted i ORDER BY 1
		LOOP
			PERFORM pg_notify('notesapp_sync', 'w:' || changed::text);
		END LOOP;
		RETURN NULL;
	END
	$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.notesapp_notify_session_ended()
	RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		ended text;
	BEGIN
		FOR ended IN SELECT DISTINCT r.id FROM removed r ORDER BY 1 LOOP
			PERFORM pg_notify('notesapp_sync', 's:' || ended);
		END LOOP;
		RETURN NULL;
	END
	$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.notesapp_notify_account_changed()
	RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		changed uuid;
	BEGIN
		FOR changed IN
			SELECT DISTINCT n.id FROM new_rows n
			JOIN old_rows o ON o.id = n.id
			WHERE n.state IS DISTINCT FROM o.state
				OR n.removed_at IS DISTINCT FROM o.removed_at
			ORDER BY 1
		LOOP
			PERFORM pg_notify('notesapp_sync', 'a:' || changed::text);
		END LOOP;
		RETURN NULL;
	END
	$$;--> statement-breakpoint

DROP FUNCTION public.notesapp_set_notices_publishing(boolean);--> statement-breakpoint
DROP FUNCTION public.notesapp_notices_publishing();--> statement-breakpoint
DROP TABLE "sync_publishing" CASCADE;--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the twenty-first entry, so the function reports twenty-one.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 21;
$$;
