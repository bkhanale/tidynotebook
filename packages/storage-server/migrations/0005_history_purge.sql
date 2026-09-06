-- Functions for owner file purge and purge preview.
--
-- File purge permanently deletes specified files, their revisions, and unreferenced
-- content. It bypasses immutability triggers under owner authorization and sets
-- purge markers to prevent late offline writes.

CREATE OR REPLACE FUNCTION public.notesapp_preview_purge(
	p_workspace_id uuid,
	p_file_ids uuid[]
)
RETURNS TABLE (
	file_ids uuid[],
	revision_ids uuid[],
	content_digests text[],
	attachment_object_ids uuid[],
	blocking_kind text[],
	blocking_target_id text[],
	blocking_referrer_id text[],
	blocking_description text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
	v_file_ids uuid[];
	v_revision_ids uuid[];
	v_content_digests text[];
	v_attachment_object_ids uuid[];
	v_blocking_kind text[] := ARRAY[]::text[];
	v_blocking_target_id text[] := ARRAY[]::text[];
	v_blocking_referrer_id text[] := ARRAY[]::text[];
	v_blocking_description text[] := ARRAY[]::text[];
	v_ref RECORD;
BEGIN
	IF public.notesapp_member_role(p_workspace_id) IS DISTINCT FROM 'owner' THEN
		RAISE EXCEPTION 'notesapp: only an owner can preview purge'
			USING ERRCODE = '42501';
	END IF;

	SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_file_ids
	FROM public.files
	WHERE workspace_id = p_workspace_id AND id = ANY(p_file_ids);

	SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_revision_ids
	FROM public.revisions
	WHERE workspace_id = p_workspace_id AND file_id = ANY(p_file_ids);

	SELECT coalesce(array_agg(DISTINCT content_digest), ARRAY[]::text[]) INTO v_content_digests
	FROM public.revisions
	WHERE workspace_id = p_workspace_id AND file_id = ANY(p_file_ids);

	SELECT coalesce(array_agg(DISTINCT c.object_id), ARRAY[]::uuid[]) INTO v_attachment_object_ids
	FROM public.contents c
	JOIN public.revisions r ON r.workspace_id = c.workspace_id AND r.content_digest = c.digest
	WHERE c.workspace_id = p_workspace_id
	  AND r.file_id = ANY(p_file_ids)
	  AND c.object_id IS NOT NULL;

	-- Check for external revisions referencing these attachment objects
	FOR v_ref IN
		SELECT DISTINCT c.object_id as target_id, r.id as referrer_id
		FROM public.contents c
		JOIN public.revisions r ON r.workspace_id = c.workspace_id AND r.content_digest = c.digest
		WHERE c.workspace_id = p_workspace_id
		  AND c.object_id = ANY(v_attachment_object_ids)
		  AND NOT (r.file_id = ANY(p_file_ids))
	LOOP
		v_blocking_kind := array_append(v_blocking_kind, 'revision');
		v_blocking_target_id := array_append(v_blocking_target_id, v_ref.target_id::text);
		v_blocking_referrer_id := array_append(v_blocking_referrer_id, v_ref.referrer_id::text);
		v_blocking_description := array_append(v_blocking_description, 'Attachment is referenced by a revision outside the purge set.');
	END LOOP;

	-- Check for branches outside the purge set referencing revisions in the purge set
	FOR v_ref IN
		SELECT b.id as referrer_id, b.tip_revision_id as target_id
		FROM public.branches b
		WHERE b.workspace_id = p_workspace_id
		  AND NOT (b.file_id = ANY(p_file_ids))
		  AND (b.base_revision_id = ANY(v_revision_ids) OR b.tip_revision_id = ANY(v_revision_ids))
	LOOP
		v_blocking_kind := array_append(v_blocking_kind, 'branch');
		v_blocking_target_id := array_append(v_blocking_target_id, v_ref.target_id::text);
		v_blocking_referrer_id := array_append(v_blocking_referrer_id, v_ref.referrer_id::text);
		v_blocking_description := array_append(v_blocking_description, 'A branch outside the purge set references a revision in the purge set.');
	END LOOP;

	-- Check for shares outside the purge set referencing revisions in the purge set
	FOR v_ref IN
		SELECT s.id as referrer_id, s.pinned_revision_id as target_id
		FROM public.shares s
		WHERE s.workspace_id = p_workspace_id
		  AND NOT (s.file_id = ANY(p_file_ids))
		  AND (s.pinned_revision_id = ANY(v_revision_ids) OR s.allowed_attachment_revision_ids && v_revision_ids)
	LOOP
		v_blocking_kind := array_append(v_blocking_kind, 'share');
		v_blocking_target_id := array_append(v_blocking_target_id, v_ref.target_id::text);
		v_blocking_referrer_id := array_append(v_blocking_referrer_id, v_ref.referrer_id::text);
		v_blocking_description := array_append(v_blocking_description, 'A share outside the purge set references a revision in the purge set.');
	END LOOP;

	RETURN QUERY SELECT
		v_file_ids,
		v_revision_ids,
		v_content_digests,
		v_attachment_object_ids,
		v_blocking_kind,
		v_blocking_target_id,
		v_blocking_referrer_id,
		v_blocking_description;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_preview_purge(uuid, uuid[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_preview_purge(uuid, uuid[]) TO notesapp_app;--> statement-breakpoint

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

	-- Find unreferenced attachment objects
	SELECT coalesce(array_agg(ao.id), ARRAY[]::uuid[]) INTO v_unreferenced_objects
	FROM public.attachment_objects ao
	WHERE ao.workspace_id = p_workspace_id
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
GRANT EXECUTE ON FUNCTION public.notesapp_purge_files(uuid, uuid[]) TO notesapp_app;
