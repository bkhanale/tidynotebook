-- Purge safety for attachment objects, and one path that deletes their bytes.
--
-- Three defects are closed here.
--
-- 1. `notesapp_purge_files` marked every attachment object that had no
--    `contents` reference unavailable, with no state filter and no age
--    filter. A `temporary` object of an upload that was still in flight was
--    destroyed by a purge of an unrelated note. The purge now selects only a
--    `finalized` object that is older than the reclaim window, which is the
--    rule the background job already applies. A `temporary` object is never
--    touched by a purge.
--
-- 2. Nothing deleted the bytes of an object that a purge or a workspace
--    deletion left unreferenced. `notesapp_reclaim_attachments` now also
--    reports an `unavailable` object whose bytes are still on disk, and
--    `notesapp_delete_workspace` records the attachment digests of the
--    workspace in `attachment_reclaim_queue` before it removes the rows. The
--    background reclaim stays the only code that deletes attachment bytes.
--
-- 3. `attachment_objects.reclaimed_at` marks the row whose bytes the reclaim
--    has already handled. The mark claims the row once, so a repeated reclaim
--    run neither counts nor unlinks the same object twice.

ALTER TABLE public.attachment_objects
	ADD COLUMN IF NOT EXISTS reclaimed_at timestamptz;--> statement-breakpoint

-- Bytes of a deleted workspace. The row outlives the workspace row, so it
-- carries no foreign key. Only the SECURITY DEFINER functions below reach it.
CREATE TABLE public.attachment_reclaim_queue (
	workspace_id uuid NOT NULL,
	object_id uuid NOT NULL,
	digest text NOT NULL,
	queued_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT attachment_reclaim_queue_pk PRIMARY KEY (workspace_id, object_id)
);--> statement-breakpoint

ALTER TABLE public.attachment_reclaim_queue ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.attachment_reclaim_queue FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
BEGIN
	EXECUTE format(
		'CREATE POLICY attachment_reclaim_queue_owner_policy '
		'ON public.attachment_reclaim_queue FOR ALL TO %I '
		'USING (true) WITH CHECK (true)', current_user);
END
$$;--> statement-breakpoint

-- The reclaim also takes an object that a purge marked unavailable. Without
-- this the bytes of a permanently deleted note stayed on disk forever.
CREATE OR REPLACE FUNCTION public.notesapp_reclaim_attachments(p_cutoff timestamptz)
	RETURNS TABLE (
		id uuid,
		workspace_id uuid,
		digest text,
		state text
	)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT ao.id, ao.workspace_id, ao.digest, ao.state
		FROM public.attachment_objects ao
		WHERE ao.reclaimed_at IS NULL
		  AND (
		       ao.state = 'unavailable'
		    OR (ao.state = 'temporary' AND ao.created_at < p_cutoff)
		    OR (ao.state = 'finalized' AND ao.finalized_at < p_cutoff
		        AND NOT EXISTS (
		            SELECT 1 FROM public.contents c
		            WHERE c.workspace_id = ao.workspace_id AND c.object_id = ao.id
		        ))
		  );
	$$;--> statement-breakpoint

-- The mark claims one row for one reclaim run. `reclaimed_at` records that
-- the bytes of the row were handled, so the row is never claimed again.
CREATE OR REPLACE FUNCTION public.notesapp_mark_attachment_unavailable(p_workspace_id uuid, p_id uuid)
	RETURNS boolean
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		v_updated boolean := false;
	BEGIN
		UPDATE public.attachment_objects
		SET state = 'unavailable', reclaimed_at = clock_timestamp()
		WHERE workspace_id = p_workspace_id AND id = p_id
		  AND reclaimed_at IS NULL;
		GET DIAGNOSTICS v_updated = ROW_COUNT;
		RETURN v_updated;
	END;
	$$;--> statement-breakpoint

-- Takes the queued rows of deleted workspaces. The caller unlinks the bytes
-- inside the same transaction, so a failed unlink returns the rows.
CREATE FUNCTION public.notesapp_take_attachment_reclaim(p_limit integer)
	RETURNS TABLE (
		workspace_id uuid,
		object_id uuid,
		digest text
	)
	LANGUAGE sql
	VOLATILE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		DELETE FROM public.attachment_reclaim_queue q
		WHERE (q.workspace_id, q.object_id) IN (
			SELECT t.workspace_id, t.object_id
			FROM public.attachment_reclaim_queue t
			ORDER BY t.queued_at, t.workspace_id, t.object_id
			LIMIT greatest(p_limit, 0)
		)
		RETURNING q.workspace_id, q.object_id, q.digest;
	$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_take_attachment_reclaim(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_take_attachment_reclaim(integer) TO notesapp_app;--> statement-breakpoint

-- A workspace deletion removes the attachment rows, so it queues the digests
-- first. Only the last statement group differs from the body in 0008.
CREATE OR REPLACE FUNCTION public.notesapp_delete_workspace(p_workspace_id uuid)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		IF public.notesapp_member_role(p_workspace_id) IS DISTINCT FROM 'owner' THEN
			RAISE EXCEPTION 'notesapp: only an owner can delete a workspace'
				USING ERRCODE = '42501';
		END IF;
		PERFORM set_config('notesapp.purge', 'on', true);
		DELETE FROM public.search_index WHERE workspace_id = p_workspace_id;
		DELETE FROM public.link_index WHERE workspace_id = p_workspace_id;
		DELETE FROM public.snapshot_items WHERE workspace_id = p_workspace_id;
		DELETE FROM public.snapshots WHERE workspace_id = p_workspace_id;
		DELETE FROM public.shares WHERE workspace_id = p_workspace_id;
		DELETE FROM public.branches WHERE workspace_id = p_workspace_id;
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
		DELETE FROM public.audit_events WHERE workspace_id = p_workspace_id;
		DELETE FROM public.invitations WHERE workspace_id = p_workspace_id;
		DELETE FROM public.memberships WHERE workspace_id = p_workspace_id;
		DELETE FROM public.workspace_cursors WHERE workspace_id = p_workspace_id;
		DELETE FROM public.workspace_usage WHERE workspace_id = p_workspace_id;
		DELETE FROM public.workspaces WHERE id = p_workspace_id;
		PERFORM set_config('notesapp.purge', 'off', true);
	END
	$$;--> statement-breakpoint

-- A purge no longer destroys an upload that is still in flight. Only the
-- statement that selects the unreferenced objects differs from 0008.
CREATE OR REPLACE FUNCTION public.notesapp_purge_files(
	p_workspace_id uuid,
	p_file_ids uuid[]
)
RETURNS TABLE (
	purged_file_ids uuid[],
	purged_revision_ids uuid[],
	reclaimed_bytes bigint,
	unreferenced_object_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
	v_blocking_count integer;
	v_purged_file_ids uuid[];
	v_purged_revision_ids uuid[];
	v_attachment_object_ids uuid[];
	v_reclaimed_content_bytes bigint := 0;
	v_reclaimed_overhead_bytes bigint := 0;
	v_total_reclaimed bigint := 0;
	v_unreferenced_objects uuid[];
BEGIN
	IF public.notesapp_member_role(p_workspace_id) IS DISTINCT FROM 'owner' THEN
		RAISE EXCEPTION 'notesapp: only an owner can purge files'
			USING ERRCODE = '42501';
	END IF;

	SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_purged_file_ids
	FROM public.files
	WHERE workspace_id = p_workspace_id AND id = ANY(p_file_ids);

	SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_purged_revision_ids
	FROM public.revisions
	WHERE workspace_id = p_workspace_id AND file_id = ANY(p_file_ids);

	SELECT coalesce(array_agg(DISTINCT c.object_id), ARRAY[]::uuid[]) INTO v_attachment_object_ids
	FROM public.contents c
	JOIN public.revisions r ON r.workspace_id = c.workspace_id AND r.content_digest = c.digest
	WHERE c.workspace_id = p_workspace_id
	  AND r.file_id = ANY(p_file_ids)
	  AND c.object_id IS NOT NULL;

	-- Validate no external revisions reference these attachment objects
	IF array_length(v_attachment_object_ids, 1) > 0 THEN
		SELECT count(*) INTO v_blocking_count
		FROM public.contents c
		JOIN public.revisions r ON r.workspace_id = c.workspace_id AND r.content_digest = c.digest
		WHERE c.workspace_id = p_workspace_id
		  AND c.object_id = ANY(v_attachment_object_ids)
		  AND NOT (r.file_id = ANY(p_file_ids));

		IF v_blocking_count > 0 THEN
			RAISE EXCEPTION 'notesapp: attachment is referenced outside the purge set'
				USING ERRCODE = '23503';
		END IF;
	END IF;

	-- Validate no external branches reference these revisions
	IF array_length(v_purged_revision_ids, 1) > 0 THEN
		SELECT count(*) INTO v_blocking_count
		FROM public.branches b
		WHERE b.workspace_id = p_workspace_id
		  AND NOT (b.file_id = ANY(p_file_ids))
		  AND (b.base_revision_id = ANY(v_purged_revision_ids) OR b.tip_revision_id = ANY(v_purged_revision_ids));

		IF v_blocking_count > 0 THEN
			RAISE EXCEPTION 'notesapp: branch outside purge set references revision in purge set'
				USING ERRCODE = '23503';
		END IF;
	END IF;

	PERFORM set_config('notesapp.purge', 'on', true);

	DELETE FROM public.search_index
	WHERE workspace_id = p_workspace_id AND file_id = ANY(p_file_ids);

	DELETE FROM public.link_index
	WHERE workspace_id = p_workspace_id
	  AND (source_file_id = ANY(p_file_ids) OR target_file_id = ANY(p_file_ids));

	DELETE FROM public.shares
	WHERE workspace_id = p_workspace_id AND file_id = ANY(p_file_ids);

	DELETE FROM public.branches
	WHERE workspace_id = p_workspace_id AND file_id = ANY(p_file_ids);

	DELETE FROM public.live_paths
	WHERE workspace_id = p_workspace_id AND file_id = ANY(p_file_ids);

	UPDATE public.files
	SET head_revision_id = NULL
	WHERE workspace_id = p_workspace_id AND id = ANY(p_file_ids);

	DELETE FROM public.revision_parents
	WHERE workspace_id = p_workspace_id
	  AND (child_id = ANY(v_purged_revision_ids) OR parent_id = ANY(v_purged_revision_ids));

	DELETE FROM public.revisions
	WHERE workspace_id = p_workspace_id AND file_id = ANY(p_file_ids);

	DELETE FROM public.files
	WHERE workspace_id = p_workspace_id AND id = ANY(p_file_ids);

	INSERT INTO public.purge_markers (workspace_id, file_id, purged_at)
	SELECT p_workspace_id, unnest(p_file_ids), clock_timestamp()
	ON CONFLICT (workspace_id, file_id) DO NOTHING;

	-- Reclaim orphaned content bytes
	SELECT coalesce(sum(size), 0) INTO v_reclaimed_content_bytes
	FROM public.contents c
	WHERE c.workspace_id = p_workspace_id
	  AND NOT EXISTS (
		SELECT 1 FROM public.revisions r
		WHERE r.workspace_id = p_workspace_id AND r.content_digest = c.digest
	  );

	-- Find unreferenced attachment objects. A `temporary` object belongs to an
	-- upload that is still in flight, and an object that was finalized inside
	-- the reclaim window is between its finalize call and the commit that
	-- references it. Neither is dead, so a purge leaves both alone and the
	-- background reclaim decides about them later.
	SELECT coalesce(array_agg(ao.id), ARRAY[]::uuid[]) INTO v_unreferenced_objects
	FROM public.attachment_objects ao
	WHERE ao.workspace_id = p_workspace_id
	  AND ao.state = 'finalized'
	  AND ao.finalized_at < clock_timestamp() - interval '24 hours'
	  AND NOT EXISTS (
		SELECT 1 FROM public.contents c
		WHERE c.workspace_id = p_workspace_id AND c.object_id = ao.id
	  );

	UPDATE public.attachment_objects
	SET state = 'unavailable'
	WHERE workspace_id = p_workspace_id AND id = ANY(v_unreferenced_objects);

	DELETE FROM public.contents c
	WHERE c.workspace_id = p_workspace_id
	  AND NOT EXISTS (
		SELECT 1 FROM public.revisions r
		WHERE r.workspace_id = p_workspace_id AND r.content_digest = c.digest
	  );

	v_reclaimed_overhead_bytes := coalesce(array_length(v_purged_revision_ids, 1), 0)::bigint * 1024;
	v_total_reclaimed := v_reclaimed_content_bytes + v_reclaimed_overhead_bytes;

	IF v_total_reclaimed > 0 THEN
		UPDATE public.workspace_usage
		SET bytes_used = greatest(0, bytes_used - v_total_reclaimed)
		WHERE workspace_id = p_workspace_id;
	END IF;

	PERFORM set_config('notesapp.purge', 'off', true);

	RETURN QUERY SELECT
		v_purged_file_ids,
		v_purged_revision_ids,
		v_total_reclaimed,
		v_unreferenced_objects;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_purge_files(uuid, uuid[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_purge_files(uuid, uuid[]) TO notesapp_app;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_delete_workspace(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_delete_workspace(uuid) TO notesapp_app;
