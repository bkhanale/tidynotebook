-- A workspace that holds a note can be deleted.
--
-- Migration 0007 added `note_documents`, whose rows reference `files`, and it
-- taught `notesapp_purge_files` to remove them. `notesapp_delete_workspace`
-- of migration 0005 was not taught the same, so PostgreSQL refused the delete
-- of `files` for every workspace that held a note. This body is the one of
-- migration 0005 with the documents removed before the files.
--
-- `tests/integration/workspaces.test.ts` reads every table with a
-- `workspace_id` column from the catalog after the delete, so a table that a
-- later migration adds and this function forgets fails that test.
--
-- Rights survive a replacement, so the grants of the initial migration still
-- apply.
CREATE OR REPLACE FUNCTION public.notesapp_delete_workspace(p_workspace_id uuid)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		caller uuid := public.notesapp_current_account();
		held integer;
	BEGIN
		-- A null role is not the owner role either, so the comparison has to be
		-- `IS DISTINCT FROM` and not `<>`.
		IF public.notesapp_member_role(p_workspace_id) IS DISTINCT FROM 'owner' THEN
			RAISE EXCEPTION 'notesapp: only an owner can delete a workspace'
				USING ERRCODE = '42501';
		END IF;
		SELECT count(*) INTO held FROM public.memberships m
			WHERE m.account_id = caller;
		IF held <= 1 THEN
			RAISE EXCEPTION 'notesapp: an account keeps its last workspace'
				USING ERRCODE = '42501';
		END IF;
		PERFORM set_config('notesapp.purge', 'on', true);
		DELETE FROM public.search_index WHERE workspace_id = p_workspace_id;
		DELETE FROM public.snapshot_items WHERE workspace_id = p_workspace_id;
		DELETE FROM public.snapshots WHERE workspace_id = p_workspace_id;
		DELETE FROM public.sync_changes WHERE workspace_id = p_workspace_id;
		DELETE FROM public.live_paths WHERE workspace_id = p_workspace_id;
		UPDATE public.files SET head_revision_id = NULL
			WHERE workspace_id = p_workspace_id;
		DELETE FROM public.revision_parents WHERE workspace_id = p_workspace_id;
		DELETE FROM public.revisions WHERE workspace_id = p_workspace_id;
		DELETE FROM public.mutation_receipts WHERE workspace_id = p_workspace_id;
		DELETE FROM public.changesets WHERE workspace_id = p_workspace_id;
		DELETE FROM public.contents WHERE workspace_id = p_workspace_id;
		DELETE FROM public.note_documents WHERE workspace_id = p_workspace_id;
		DELETE FROM public.files WHERE workspace_id = p_workspace_id;
		INSERT INTO public.attachment_reclaim_queue (workspace_id, object_id, digest)
		SELECT ao.workspace_id, ao.id, ao.digest
		FROM public.attachment_objects ao
		WHERE ao.workspace_id = p_workspace_id AND ao.reclaimed_at IS NULL
		ON CONFLICT (workspace_id, object_id) DO NOTHING;
		DELETE FROM public.attachment_objects WHERE workspace_id = p_workspace_id;
		DELETE FROM public.purge_markers WHERE workspace_id = p_workspace_id;
		DELETE FROM public.memberships WHERE workspace_id = p_workspace_id;
		DELETE FROM public.workspace_cursors WHERE workspace_id = p_workspace_id;
		DELETE FROM public.workspace_usage WHERE workspace_id = p_workspace_id;
		DELETE FROM public.workspaces WHERE id = p_workspace_id;
		PERFORM set_config('notesapp.purge', 'off', true);
	END
	$$;--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the ninth entry, so the function reports nine.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 9;
$$;
