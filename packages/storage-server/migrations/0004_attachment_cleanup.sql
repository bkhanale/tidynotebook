-- Reclaim functions for abandoned temporary and unreferenced finalized attachments.
--
-- Background cleanup runs across all workspaces, so queries need to read and update
-- rows without being restricted by single-user membership checks. These SECURITY DEFINER
-- functions allow notesapp_app to identify and purge expired unreferenced attachment
-- records while preserving user isolation on regular tables.

CREATE FUNCTION public.notesapp_reclaim_attachments(p_cutoff timestamptz)
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
		WHERE (ao.state = 'temporary' AND ao.created_at < p_cutoff)
		   OR (ao.state = 'finalized' AND ao.finalized_at < p_cutoff
		       AND NOT EXISTS (
		           SELECT 1 FROM public.contents c
		           WHERE c.workspace_id = ao.workspace_id AND c.object_id = ao.id
		       ));
	$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_reclaim_attachments(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_reclaim_attachments(timestamptz) TO notesapp_app;--> statement-breakpoint

CREATE FUNCTION public.notesapp_has_attachment_content_ref(p_workspace_id uuid, p_id uuid)
	RETURNS boolean
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT EXISTS (
			SELECT 1 FROM public.contents
			WHERE workspace_id = p_workspace_id AND object_id = p_id
		);
	$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_has_attachment_content_ref(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_has_attachment_content_ref(uuid, uuid) TO notesapp_app;--> statement-breakpoint

CREATE FUNCTION public.notesapp_mark_attachment_unavailable(p_workspace_id uuid, p_id uuid)
	RETURNS boolean
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		v_updated boolean := false;
	BEGIN
		UPDATE public.attachment_objects
		SET state = 'unavailable'
		WHERE workspace_id = p_workspace_id AND id = p_id AND state != 'unavailable';
		GET DIAGNOSTICS v_updated = ROW_COUNT;
		RETURN v_updated;
	END;
	$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_mark_attachment_unavailable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_mark_attachment_unavailable(uuid, uuid) TO notesapp_app;--> statement-breakpoint

CREATE FUNCTION public.notesapp_is_attachment_digest_used(p_workspace_id uuid, p_digest text)
	RETURNS boolean
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT EXISTS (
			SELECT 1 FROM public.attachment_objects
			WHERE workspace_id = p_workspace_id
			  AND digest = p_digest
			  AND state != 'unavailable'
		);
	$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_is_attachment_digest_used(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_is_attachment_digest_used(uuid, text) TO notesapp_app;
