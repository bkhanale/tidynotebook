-- Retention cleanup for sync snapshots and incremental change records.
--
-- A snapshot is a short lived materialized download state: its items are paged
-- without holding a database transaction open, and the rows expire after 15
-- minutes. Incremental change records are kept for 90 days; an older cursor
-- needs a fresh snapshot. This SECURITY DEFINER function removes both, because
-- the runtime role holds no DELETE right on `sync_changes` and a cleanup run
-- carries no single workspace membership. Snapshot items vanish through the
-- delete cascade on `snapshots.token_hash`.
--
-- The function never touches revisions, contents, branches, shares, receipts,
-- or purge markers, so saved history stays valid beyond the event window.

CREATE FUNCTION public.notesapp_cleanup_sync(p_snapshot_cutoff timestamptz, p_changes_cutoff timestamptz)
	RETURNS TABLE (
		expired_snapshots bigint,
		old_changes bigint
	)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		v_snapshots bigint := 0;
		v_changes bigint := 0;
	BEGIN
		DELETE FROM public.snapshots WHERE expires_at < p_snapshot_cutoff;
		GET DIAGNOSTICS v_snapshots = ROW_COUNT;
		DELETE FROM public.sync_changes WHERE committed_at < p_changes_cutoff;
		GET DIAGNOSTICS v_changes = ROW_COUNT;
		RETURN QUERY SELECT v_snapshots, v_changes;
	END;
	$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_cleanup_sync(timestamptz, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_cleanup_sync(timestamptz, timestamptz) TO notesapp_app;
