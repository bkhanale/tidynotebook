-- Public share access and administrator-only row changes.
DROP POLICY shares_member_policy ON public.shares;--> statement-breakpoint

CREATE POLICY shares_read_policy ON public.shares
	FOR SELECT TO notesapp_app
	USING (public.notesapp_is_member(workspace_id));--> statement-breakpoint

CREATE POLICY shares_insert_policy ON public.shares
	FOR INSERT TO notesapp_app
	WITH CHECK (
		public.notesapp_member_role(workspace_id) IN ('owner', 'admin')
		AND creator_account_id = public.notesapp_current_account()
	);--> statement-breakpoint

CREATE POLICY shares_update_policy ON public.shares
	FOR UPDATE TO notesapp_app
	USING (public.notesapp_member_role(workspace_id) IN ('owner', 'admin'))
	WITH CHECK (public.notesapp_member_role(workspace_id) IN ('owner', 'admin'));--> statement-breakpoint

-- Resolves one active token. The creator must still have sharing permission.
CREATE OR REPLACE FUNCTION public.notesapp_share_lookup(p_token_hash text)
	RETURNS TABLE (
		workspace_id uuid,
		share_id uuid,
		file_id uuid,
		pinned_revision_id uuid,
		allowed_attachment_revision_ids uuid[],
		path text,
		content_kind text,
		content_digest text,
		markdown text,
		object_id uuid
	)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT
			s.workspace_id,
			s.id,
			s.file_id,
			s.pinned_revision_id,
			s.allowed_attachment_revision_ids,
			r.path,
			c.kind::text,
			c.digest,
			c.markdown,
			c.object_id
		FROM public.shares s
		JOIN public.memberships creator
			ON creator.workspace_id = s.workspace_id
			AND creator.account_id = s.creator_account_id
			AND creator.role IN ('owner', 'admin')
		JOIN public.files f
			ON f.workspace_id = s.workspace_id AND f.id = s.file_id
		JOIN public.revisions r
			ON r.workspace_id = s.workspace_id AND r.id = s.pinned_revision_id
		JOIN public.contents c
			ON c.workspace_id = r.workspace_id AND c.digest = r.content_digest
		WHERE s.token_hash = p_token_hash
			AND s.revoked_at IS NULL
			AND (s.expires_at IS NULL OR s.expires_at > now())
			AND f.deleted = false
			AND r.deleted = false
			AND c.kind = 'markdown'
	$$;--> statement-breakpoint

-- Resolves bytes only when the active share pinned a note that references the
-- requested accepted attachment revision.
CREATE FUNCTION public.notesapp_share_attachment_lookup(
	p_token_hash text,
	p_revision_id uuid
)
	RETURNS TABLE (
		workspace_id uuid,
		digest text,
		size bigint,
		media_type text
	)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT s.workspace_id, object.digest, object.size, object.media_type
		FROM public.shares s
		JOIN public.memberships creator
			ON creator.workspace_id = s.workspace_id
			AND creator.account_id = s.creator_account_id
			AND creator.role IN ('owner', 'admin')
		JOIN public.files note
			ON note.workspace_id = s.workspace_id AND note.id = s.file_id
		JOIN public.revisions attachment_revision
			ON attachment_revision.workspace_id = s.workspace_id
			AND attachment_revision.id = p_revision_id
		JOIN public.files attachment_file
			ON attachment_file.workspace_id = attachment_revision.workspace_id
			AND attachment_file.id = attachment_revision.file_id
		JOIN public.contents content
			ON content.workspace_id = attachment_revision.workspace_id
			AND content.digest = attachment_revision.content_digest
		JOIN public.attachment_objects object
			ON object.workspace_id = content.workspace_id
			AND object.id = content.object_id
		WHERE s.token_hash = p_token_hash
			AND s.revoked_at IS NULL
			AND (s.expires_at IS NULL OR s.expires_at > now())
			AND note.deleted = false
			AND attachment_file.deleted = false
			AND p_revision_id = ANY(s.allowed_attachment_revision_ids)
			AND attachment_revision.deleted = false
			AND content.kind = 'attachment'
			AND object.state = 'finalized'
	$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_share_attachment_lookup(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_share_attachment_lookup(text, uuid) TO notesapp_app;--> statement-breakpoint

-- A creator who loses the share role loses every live public link at the same
-- commit-ordered workspace position as the membership change.
CREATE FUNCTION public.notesapp_revoke_shares_after_membership_loss()
	RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		item record;
	BEGIN
		IF OLD.role NOT IN ('owner', 'admin') OR
			(TG_OP = 'UPDATE' AND NEW.role IN ('owner', 'admin')) THEN
			RETURN COALESCE(NEW, OLD);
		END IF;
		FOR item IN
			UPDATE public.shares
				SET revoked_at = now()
			WHERE workspace_id = OLD.workspace_id
				AND creator_account_id = OLD.account_id
				AND revoked_at IS NULL
			RETURNING id
		LOOP
			INSERT INTO public.sync_changes
				(workspace_id, cursor, entity_kind, entity_id, revision_id, deleted)
			VALUES (
				OLD.workspace_id,
				public.notesapp_next_cursor(OLD.workspace_id),
				'share', item.id, NULL, true
			);
		END LOOP;
		RETURN COALESCE(NEW, OLD);
	END
	$$;--> statement-breakpoint

CREATE TRIGGER memberships_revoke_shares
	AFTER UPDATE OF role OR DELETE ON public.memberships
	FOR EACH ROW EXECUTE FUNCTION public.notesapp_revoke_shares_after_membership_loss();--> statement-breakpoint

-- Keep workspace deletion valid after the search index was added.
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

-- Keep file purge valid after the search index was added.
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
