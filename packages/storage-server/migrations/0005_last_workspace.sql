-- An account always keeps one workspace.
--
-- See docs/decisions/0051-an-account-always-keeps-one-workspace.md. The domain
-- rule in packages/core/src/workspaces/service.ts refuses the same call and
-- answers the person with a typed result. This function is the second lock, so
-- a caller that reaches the store without that use case is refused as well.
--
-- The count reads the memberships of the calling account and not the workspace
-- table, because another account's workspace is no substitute for this
-- account's last one. The caller already holds the workspace advisory lock, so
-- two transactions that each delete one of the last two workspaces are ordered
-- and the second one reads the count that the first one left.
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
-- migration is the sixth entry, so the function reports six.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 6;
$$;
