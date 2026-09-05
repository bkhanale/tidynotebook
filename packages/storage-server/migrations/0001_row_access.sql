-- Roles, row level security, immutability, and the deferrable accepted path.
--
-- Drizzle cannot express these objects, so this is a reviewed custom migration
-- created with `drizzle-kit generate --custom`. It is handwritten SQL, not
-- generated output. See docs/development/database.md for the design.
--
-- The role that runs this migration owns the schema. It needs CREATEROLE,
-- because the statements below create the runtime role. The runtime role gets
-- no DDL right, no row security bypass, and no UPDATE or DELETE right on an
-- immutable table.

-- The runtime role. The migration creates it without a password; the migration
-- command sets the password from a protected environment value afterwards.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'notesapp_app') THEN
		CREATE ROLE notesapp_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
	ELSE
		ALTER ROLE notesapp_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
	END IF;
END
$$;--> statement-breakpoint

-- Only the schema owner may create objects, and only the runtime role and the
-- owner may connect.
DO $$
BEGIN
	EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
	EXECUTE format('GRANT CONNECT ON DATABASE %I TO notesapp_app', current_database());
END
$$;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO notesapp_app;--> statement-breakpoint

-- The identity of the current transaction. `set_config(..., true)` makes the
-- setting transaction local, so it disappears at commit or rollback and cannot
-- leak to the next user of a pooled connection. An unset value means anonymous.
CREATE FUNCTION public.notesapp_current_account() RETURNS uuid
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
	AS $$
		SELECT nullif(current_setting('notesapp.account_id', true), '')::uuid
	$$;--> statement-breakpoint

-- Membership lookup for the policies below.
--
-- The function is SECURITY DEFINER, so it runs as the schema owner. The owner
-- policy on `memberships` is a plain `true`, so the lookup never evaluates the
-- member policy that calls this function. That is what keeps the membership
-- policy non-recursive. The fixed search path stops a caller from resolving
-- `memberships` to another table.
CREATE FUNCTION public.notesapp_is_member(p_workspace_id uuid) RETURNS boolean
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT EXISTS (
			SELECT 1
			FROM public.memberships m
			WHERE m.workspace_id = p_workspace_id
				AND m.account_id = public.notesapp_current_account()
		)
	$$;--> statement-breakpoint

-- Rows are immutable. The runtime role holds no UPDATE or DELETE right on the
-- tables that use this trigger, so it cannot reach the trigger at all. A role
-- that does hold those rights, such as the schema owner during an explicit
-- purge, must set `notesapp.purge` inside its transaction first.
CREATE FUNCTION public.notesapp_reject_row_change() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		IF current_setting('notesapp.purge', true) = 'on' THEN
			IF TG_OP = 'DELETE' THEN
				RETURN OLD;
			END IF;
			RETURN NEW;
		END IF;
		RAISE EXCEPTION 'notesapp: % on table % is rejected because its rows are immutable', TG_OP, TG_TABLE_NAME
			USING ERRCODE = '23001';
	END
	$$;--> statement-breakpoint

CREATE TRIGGER contents_immutable BEFORE UPDATE OR DELETE ON public.contents
	FOR EACH ROW EXECUTE FUNCTION public.notesapp_reject_row_change();--> statement-breakpoint
CREATE TRIGGER revisions_immutable BEFORE UPDATE OR DELETE ON public.revisions
	FOR EACH ROW EXECUTE FUNCTION public.notesapp_reject_row_change();--> statement-breakpoint
CREATE TRIGGER revision_parents_immutable BEFORE UPDATE OR DELETE ON public.revision_parents
	FOR EACH ROW EXECUTE FUNCTION public.notesapp_reject_row_change();--> statement-breakpoint
CREATE TRIGGER changesets_immutable BEFORE UPDATE OR DELETE ON public.changesets
	FOR EACH ROW EXECUTE FUNCTION public.notesapp_reject_row_change();--> statement-breakpoint
CREATE TRIGGER mutation_receipts_immutable BEFORE UPDATE OR DELETE ON public.mutation_receipts
	FOR EACH ROW EXECUTE FUNCTION public.notesapp_reject_row_change();--> statement-breakpoint

-- Accepted path uniqueness. A partial unique index cannot be deferred, so the
-- accepted paths live in their own table and the constraint is deferred to the
-- end of the transaction. Two files can therefore swap paths in one changeset.
-- A file holds a row here only while it is live, so a deleted file and a
-- branch only file occupy no accepted path.
ALTER TABLE public.live_paths
	ADD CONSTRAINT live_paths_path_key UNIQUE (workspace_id, path) DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- The accepted head of a file must be a revision of the same workspace. The
-- constraint is deferred, because a changeset writes revisions and advances
-- heads in the same transaction.
ALTER TABLE public.files
	ADD CONSTRAINT files_head_revision_fk FOREIGN KEY (workspace_id, head_revision_id)
	REFERENCES public.revisions (workspace_id, id) DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- Table rights of the runtime role. An immutable table gets SELECT and INSERT
-- only.
GRANT SELECT ON public.accounts TO notesapp_app;--> statement-breakpoint
GRANT SELECT, UPDATE ON public.workspaces TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships TO notesapp_app;--> statement-breakpoint
GRANT SELECT, UPDATE ON public.workspace_usage TO notesapp_app;--> statement-breakpoint
GRANT SELECT, UPDATE ON public.workspace_cursors TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.files TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_paths TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.contents TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.revisions TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.revision_parents TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.changesets TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.mutation_receipts TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.branches TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.purge_markers TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.audit_events TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.sync_changes TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.snapshots TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.snapshot_items TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.link_index TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shares TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.attachment_objects TO notesapp_app;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_current_account() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_is_member(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_current_account() TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_is_member(uuid) TO notesapp_app;--> statement-breakpoint

-- Row level security. Every workspace scoped table is enabled and forced. Each
-- table gets two policies:
--
--   <table>_owner_policy   the schema owner, which runs migrations, account and
--                          workspace provisioning, and the SECURITY DEFINER
--                          helpers above.
--   <table>_member_policy  the runtime role, restricted to the workspaces of
--                          the account in the transaction identity setting.
--
-- A role that matches no policy sees nothing, so an anonymous transaction with
-- no identity setting reads no row and writes no row.
DO $$
DECLARE
	scoped text[] := ARRAY[
		'memberships', 'workspace_usage', 'workspace_cursors', 'files',
		'live_paths', 'contents', 'revisions', 'revision_parents', 'changesets',
		'branches', 'purge_markers', 'audit_events', 'sync_changes', 'snapshots',
		'snapshot_items', 'link_index', 'shares', 'attachment_objects'
	];
	name text;
	owner_role text := current_user;
BEGIN
	FOREACH name IN ARRAY scoped LOOP
		EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', name);
		EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', name);
		EXECUTE format(
			'CREATE POLICY %I ON public.%I FOR ALL TO %I USING (true) WITH CHECK (true)',
			name || '_owner_policy', name, owner_role);
		EXECUTE format(
			'CREATE POLICY %I ON public.%I FOR ALL TO notesapp_app '
			'USING (public.notesapp_is_member(workspace_id)) '
			'WITH CHECK (public.notesapp_is_member(workspace_id))',
			name || '_member_policy', name);
	END LOOP;

	-- A receipt is also bound to the actor, so a replay cannot read the stored
	-- outcome of another account.
	EXECUTE 'ALTER TABLE public.mutation_receipts ENABLE ROW LEVEL SECURITY';
	EXECUTE 'ALTER TABLE public.mutation_receipts FORCE ROW LEVEL SECURITY';
	EXECUTE format(
		'CREATE POLICY mutation_receipts_owner_policy ON public.mutation_receipts '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', owner_role);
	EXECUTE
		'CREATE POLICY mutation_receipts_member_policy ON public.mutation_receipts '
		'FOR ALL TO notesapp_app '
		'USING (public.notesapp_is_member(workspace_id) '
		'  AND actor_account_id = public.notesapp_current_account()) '
		'WITH CHECK (public.notesapp_is_member(workspace_id) '
		'  AND actor_account_id = public.notesapp_current_account())';

	-- A workspace row is visible to its members only.
	EXECUTE 'ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY';
	EXECUTE 'ALTER TABLE public.workspaces FORCE ROW LEVEL SECURITY';
	EXECUTE format(
		'CREATE POLICY workspaces_owner_policy ON public.workspaces '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', owner_role);
	EXECUTE
		'CREATE POLICY workspaces_member_policy ON public.workspaces '
		'FOR ALL TO notesapp_app '
		'USING (public.notesapp_is_member(id)) '
		'WITH CHECK (public.notesapp_is_member(id))';

	-- An account row is visible to that account only. Task 5 widens this to the
	-- co-members that a membership list must show.
	EXECUTE 'ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY';
	EXECUTE 'ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY';
	EXECUTE format(
		'CREATE POLICY accounts_owner_policy ON public.accounts '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', owner_role);
	EXECUTE
		'CREATE POLICY accounts_member_policy ON public.accounts '
		'FOR ALL TO notesapp_app '
		'USING (id = public.notesapp_current_account()) '
		'WITH CHECK (id = public.notesapp_current_account())';
END
$$;--> statement-breakpoint

-- The public share path.
--
-- An anonymous reader has no identity setting and no table right. This is the
-- only way it can reach content, it resolves a token hash to exactly one
-- pinned revision, and it returns nothing for a revoked, expired, or deleted
-- target. The allowed attachment revisions travel with the row, so a public
-- image request can be checked against that list.
CREATE FUNCTION public.notesapp_share_lookup(p_token_hash text)
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
	$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_share_lookup(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_share_lookup(text) TO notesapp_app;
