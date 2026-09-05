-- Access rules of the identity tables that Task 5 adds.
--
-- Drizzle cannot express roles, row level security, or a trigger, so this is a
-- reviewed custom migration created with `drizzle-kit generate --custom`. It is
-- handwritten SQL, not generated output. See docs/development/identity.md.
--
-- Two kinds of table arrive with identity:
--
--   * The four Better Auth tables. They hold session tokens, password hashes,
--     reset tokens, and provider tokens. They are not scoped by a workspace,
--     because sign-in must find a user by an address before any identity
--     exists, so no row policy can narrow them by the account of the
--     transaction. A second database role owns them instead: `notesapp_auth`
--     holds every right on those four tables and on nothing else, and
--     `notesapp_app` holds no right on them at all. The application therefore
--     cannot read a session token, a password hash, a reset token, or a
--     provider token through any query, however it sets its identity.
--   * The application's own identity tables: the account map, preferences,
--     agent tokens, and invitations. They carry an account or a workspace, so
--     their policies are the normal ones.
--
-- Every write that creates or removes a workspace, moves ownership, or
-- consumes an invitation goes through a SECURITY DEFINER function, because the
-- runtime role holds no right to insert a workspace, an account, or another
-- account's membership row. The few facts that the application needs from the
-- identity tables come from named SECURITY DEFINER functions that return those
-- columns and nothing else.

-- The identity role.
--
-- It is created exactly like `notesapp_app` in migration 0001: no superuser, no
-- row security bypass, no replication. `migrate.ts` sets its password, so no
-- password is stored in a committed SQL file.
DO $$
DECLARE
	existing pg_catalog.pg_roles%ROWTYPE;
BEGIN
	SELECT * INTO existing FROM pg_catalog.pg_roles WHERE rolname = 'notesapp_auth';
	IF NOT FOUND THEN
		CREATE ROLE notesapp_auth LOGIN NOINHERIT;
	ELSIF existing.rolsuper OR existing.rolbypassrls OR existing.rolreplication THEN
		RAISE EXCEPTION 'notesapp: the role notesapp_auth must not be SUPERUSER, BYPASSRLS, or REPLICATION';
	END IF;
END
$$;--> statement-breakpoint

DO $$
BEGIN
	EXECUTE format('GRANT CONNECT ON DATABASE %I TO notesapp_auth', current_database());
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO notesapp_auth;--> statement-breakpoint

-- Table rights. The four Better Auth tables belong to the identity role only.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_user TO notesapp_auth;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_session TO notesapp_auth;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_account TO notesapp_auth;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_verification TO notesapp_auth;--> statement-breakpoint
REVOKE ALL ON public.auth_user FROM notesapp_app;--> statement-breakpoint
REVOKE ALL ON public.auth_session FROM notesapp_app;--> statement-breakpoint
REVOKE ALL ON public.auth_account FROM notesapp_app;--> statement-breakpoint
REVOKE ALL ON public.auth_verification FROM notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.account_preferences TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.account_audit_events TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.agent_tokens TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.invitations TO notesapp_app;--> statement-breakpoint

-- True when the account belongs to the transaction identity, or shares a
-- workspace with it.
--
-- The function is SECURITY DEFINER, so its own reads are not filtered by the
-- policies that call it. That is what keeps those policies non-recursive.
CREATE FUNCTION public.notesapp_shares_workspace_with(p_account_id uuid)
	RETURNS boolean
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT p_account_id = public.notesapp_current_account()
			OR EXISTS (
				SELECT 1
				FROM public.memberships mine
				JOIN public.memberships theirs
					ON theirs.workspace_id = mine.workspace_id
				WHERE mine.account_id = public.notesapp_current_account()
					AND theirs.account_id = p_account_id
			)
	$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_shares_workspace_with(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_shares_workspace_with(uuid) TO notesapp_app;--> statement-breakpoint

-- Row level security of the identity tables.
DO $$
DECLARE
	owner_role text := current_user;
	name text;
BEGIN
	-- The four Better Auth tables belong to the identity role. The application
	-- role holds no right on them at all, so the policy below is the second
	-- control rather than the only one.
	FOREACH name IN ARRAY ARRAY['auth_user', 'auth_session', 'auth_account', 'auth_verification'] LOOP
		EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', name);
		EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', name);
		EXECUTE format(
			'CREATE POLICY %I ON public.%I FOR ALL TO %I USING (true) WITH CHECK (true)',
			name || '_owner_policy', name, owner_role);
		EXECUTE format(
			'CREATE POLICY %I ON public.%I FOR ALL TO notesapp_auth '
			'USING (true) WITH CHECK (true)',
			name || '_auth_policy', name);
	END LOOP;

	-- The account map joins an identity to an account. The application role
	-- holds no right on it: it learns an account through
	-- `notesapp_account_of` and a member directory through
	-- `notesapp_workspace_members`, and both return one narrow answer.
	EXECUTE 'ALTER TABLE public.account_identities ENABLE ROW LEVEL SECURITY';
	EXECUTE 'ALTER TABLE public.account_identities FORCE ROW LEVEL SECURITY';
	EXECUTE format(
		'CREATE POLICY account_identities_owner_policy ON public.account_identities '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', owner_role);

	-- The account audit trail belongs to one account and to nobody else. It is
	-- append only for the runtime role, like the workspace audit trail.
	EXECUTE 'ALTER TABLE public.account_audit_events ENABLE ROW LEVEL SECURITY';
	EXECUTE 'ALTER TABLE public.account_audit_events FORCE ROW LEVEL SECURITY';
	EXECUTE format(
		'CREATE POLICY account_audit_events_owner_policy ON public.account_audit_events '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', owner_role);
	EXECUTE
		'CREATE POLICY account_audit_events_member_policy ON public.account_audit_events '
		'FOR ALL TO notesapp_app '
		'USING (account_id = public.notesapp_current_account()) '
		'WITH CHECK (account_id = public.notesapp_current_account())';

	-- Settings belong to one account and to nobody else.
	EXECUTE 'ALTER TABLE public.account_preferences ENABLE ROW LEVEL SECURITY';
	EXECUTE 'ALTER TABLE public.account_preferences FORCE ROW LEVEL SECURITY';
	EXECUTE format(
		'CREATE POLICY account_preferences_owner_policy ON public.account_preferences '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', owner_role);
	EXECUTE
		'CREATE POLICY account_preferences_member_policy ON public.account_preferences '
		'FOR ALL TO notesapp_app '
		'USING (account_id = public.notesapp_current_account()) '
		'WITH CHECK (account_id = public.notesapp_current_account())';

	-- An agent token belongs to one account. The bearer lookup runs before any
	-- identity exists, so it uses the SECURITY DEFINER function below instead.
	EXECUTE 'ALTER TABLE public.agent_tokens ENABLE ROW LEVEL SECURITY';
	EXECUTE 'ALTER TABLE public.agent_tokens FORCE ROW LEVEL SECURITY';
	EXECUTE format(
		'CREATE POLICY agent_tokens_owner_policy ON public.agent_tokens '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', owner_role);
	EXECUTE
		'CREATE POLICY agent_tokens_member_policy ON public.agent_tokens '
		'FOR ALL TO notesapp_app '
		'USING (account_id = public.notesapp_current_account()) '
		'WITH CHECK (account_id = public.notesapp_current_account())';

	-- An invitation belongs to a workspace. Members read it; an owner or an
	-- administrator creates and revokes it. Acceptance uses the SECURITY
	-- DEFINER function below, because the invited account is not a member yet.
	EXECUTE 'ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY';
	EXECUTE 'ALTER TABLE public.invitations FORCE ROW LEVEL SECURITY';
	EXECUTE format(
		'CREATE POLICY invitations_owner_policy ON public.invitations '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', owner_role);
	EXECUTE
		'CREATE POLICY invitations_read_policy ON public.invitations '
		'FOR SELECT TO notesapp_app '
		'USING (public.notesapp_is_member(workspace_id))';
	EXECUTE
		'CREATE POLICY invitations_insert_policy ON public.invitations '
		'FOR INSERT TO notesapp_app '
		'WITH CHECK (public.notesapp_member_role(workspace_id) IN (''owner'', ''admin'') '
		'  AND role <> ''owner'')';
	EXECUTE
		'CREATE POLICY invitations_update_policy ON public.invitations '
		'FOR UPDATE TO notesapp_app '
		'USING (public.notesapp_member_role(workspace_id) IN (''owner'', ''admin'')) '
		'WITH CHECK (public.notesapp_member_role(workspace_id) IN (''owner'', ''admin''))';
END
$$;--> statement-breakpoint

-- The account row of a co-member becomes visible, so a member list can name
-- the accounts of one workspace. Migration 0001 records this widening as work
-- of Task 5.
DROP POLICY accounts_member_policy ON public.accounts;--> statement-breakpoint
CREATE POLICY accounts_member_policy ON public.accounts
	FOR SELECT TO notesapp_app
	USING (public.notesapp_shares_workspace_with(id));--> statement-breakpoint

-- Only an owner may remove an owner. Migration 0001 lets an administrator
-- delete any membership row of another account; the core rules already refuse
-- to remove an owner, and this narrows the second control to match them.
DROP POLICY memberships_delete_policy ON public.memberships;--> statement-breakpoint
CREATE POLICY memberships_delete_policy ON public.memberships
	FOR DELETE TO notesapp_app
	USING (
		public.notesapp_member_role(workspace_id) IN ('owner', 'admin')
		AND account_id <> public.notesapp_current_account()
		AND (role <> 'owner' OR public.notesapp_member_role(workspace_id) = 'owner')
	);--> statement-breakpoint

-- A workspace always keeps an owner.
--
-- The guard is the database side of the last owner rule. A transfer sets the
-- new owner before it changes the old one, so it passes. Workspace deletion
-- sets `notesapp.purge`, exactly like the immutability trigger, because it
-- removes the whole workspace.
CREATE FUNCTION public.notesapp_keep_owner() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		IF current_setting('notesapp.purge', true) = 'on' THEN
			RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
		END IF;
		IF OLD.role <> 'owner' THEN
			RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
		END IF;
		IF TG_OP = 'UPDATE' AND NEW.role = 'owner' THEN
			RETURN NEW;
		END IF;
		IF NOT EXISTS (
			SELECT 1 FROM public.memberships m
			WHERE m.workspace_id = OLD.workspace_id
				AND m.role = 'owner'
				AND m.account_id <> OLD.account_id
		) THEN
			RAISE EXCEPTION 'notesapp: a workspace must keep at least one owner'
				USING ERRCODE = '23514';
		END IF;
		RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
	END
	$$;--> statement-breakpoint

CREATE TRIGGER memberships_keep_owner BEFORE UPDATE OR DELETE ON public.memberships
	FOR EACH ROW EXECUTE FUNCTION public.notesapp_keep_owner();--> statement-breakpoint

-- Links a Better Auth user to an application account.
--
-- The call is idempotent and runs in one transaction: it creates the account
-- identifier, the map row, the personal workspace, its usage record, its
-- cursor, and the owner membership together, or it returns the account that an
-- earlier call already created. A half created account is therefore not
-- possible, and a repeated sign-in never creates a second personal workspace.
CREATE FUNCTION public.notesapp_link_account(
		p_auth_user_id text,
		p_account_id uuid,
		p_workspace_id uuid,
		p_workspace_name text,
		p_quota_bytes bigint)
	RETURNS uuid
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		linked uuid;
	BEGIN
		SELECT ai.account_id INTO linked
		FROM public.account_identities ai
		WHERE ai.auth_user_id = p_auth_user_id;
		IF linked IS NOT NULL THEN
			RETURN linked;
		END IF;
		INSERT INTO public.accounts (id) VALUES (p_account_id);
		INSERT INTO public.account_identities (auth_user_id, account_id)
			VALUES (p_auth_user_id, p_account_id);
		INSERT INTO public.account_preferences (account_id) VALUES (p_account_id);
		INSERT INTO public.workspaces (id, name, personal)
			VALUES (p_workspace_id, p_workspace_name, true);
		INSERT INTO public.workspace_usage (workspace_id, bytes_used, quota_bytes)
			VALUES (p_workspace_id, 0, p_quota_bytes);
		INSERT INTO public.workspace_cursors (workspace_id, last_cursor)
			VALUES (p_workspace_id, 0);
		INSERT INTO public.memberships (workspace_id, account_id, role)
			VALUES (p_workspace_id, p_account_id, 'owner');
		-- The personal workspace records its first membership exactly like a
		-- workspace that an account creates by hand. The cursor moves from zero
		-- to one here, so the sync stream of a new workspace starts at one.
		UPDATE public.workspace_cursors SET last_cursor = 1
			WHERE workspace_id = p_workspace_id;
		INSERT INTO public.sync_changes
			(workspace_id, cursor, entity_kind, entity_id, deleted)
			VALUES (p_workspace_id, 1, 'membership', p_account_id, false);
		INSERT INTO public.audit_events
			(workspace_id, id, actor_account_id, action, target_kind, target_id)
			VALUES (p_workspace_id, gen_random_uuid(), p_account_id,
				'workspace.create', 'workspace', p_workspace_id);
		RETURN p_account_id;
	END
	$$;--> statement-breakpoint

-- Creates a workspace owned by the account of the transaction.
--
-- The runtime role holds no INSERT right on `workspaces`, so this is the only
-- way it can create one, and the owner is always the calling account.
CREATE FUNCTION public.notesapp_create_workspace(
		p_workspace_id uuid,
		p_name text,
		p_quota_bytes bigint)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		creator uuid := public.notesapp_current_account();
	BEGIN
		IF creator IS NULL THEN
			RAISE EXCEPTION 'notesapp: the transaction has no account identity'
				USING ERRCODE = '42501';
		END IF;
		INSERT INTO public.workspaces (id, name, personal)
			VALUES (p_workspace_id, p_name, false);
		INSERT INTO public.workspace_usage (workspace_id, bytes_used, quota_bytes)
			VALUES (p_workspace_id, 0, p_quota_bytes);
		INSERT INTO public.workspace_cursors (workspace_id, last_cursor)
			VALUES (p_workspace_id, 0);
		INSERT INTO public.memberships (workspace_id, account_id, role)
			VALUES (p_workspace_id, creator, 'owner');
	END
	$$;--> statement-breakpoint

-- Moves ownership to another member.
--
-- The new owner is set first, so the owner guard above never sees a workspace
-- without an owner. The old owner becomes an administrator, or leaves. The
-- runtime role cannot change its own membership row through a policy, so this
-- function is the only path for both halves of a transfer.
CREATE FUNCTION public.notesapp_transfer_ownership(
		p_workspace_id uuid,
		p_new_owner uuid,
		p_leave boolean)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		caller uuid := public.notesapp_current_account();
		changed integer;
	BEGIN
		-- A stranger has no role at all, and `<> 'owner'` is null rather than
		-- true for a null role. `IS DISTINCT FROM` is the comparison that also
		-- refuses that case.
		IF caller IS NULL
			OR public.notesapp_member_role(p_workspace_id) IS DISTINCT FROM 'owner' THEN
			RAISE EXCEPTION 'notesapp: only an owner can transfer a workspace'
				USING ERRCODE = '42501';
		END IF;
		IF p_new_owner = caller THEN
			RAISE EXCEPTION 'notesapp: the new owner must be another member'
				USING ERRCODE = '23514';
		END IF;
		UPDATE public.memberships SET role = 'owner'
			WHERE workspace_id = p_workspace_id AND account_id = p_new_owner;
		GET DIAGNOSTICS changed = ROW_COUNT;
		IF changed = 0 THEN
			RAISE EXCEPTION 'notesapp: the new owner is not a member of this workspace'
				USING ERRCODE = '23503';
		END IF;
		IF p_leave THEN
			DELETE FROM public.memberships
				WHERE workspace_id = p_workspace_id AND account_id = caller;
		ELSE
			UPDATE public.memberships SET role = 'admin'
				WHERE workspace_id = p_workspace_id AND account_id = caller;
		END IF;
	END
	$$;--> statement-breakpoint

-- Consumes one invitation.
--
-- The update is the whole check: it matches only a pending, unexpired, and
-- unrevoked row whose address is the one that signed in, and it marks the row
-- accepted in the same statement. A replay of the same token therefore updates
-- no row and returns nothing.
CREATE FUNCTION public.notesapp_claim_invitation(
		p_token_hash text,
		p_email text)
	RETURNS TABLE (granted_workspace_id uuid, granted_role text)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		claimer uuid := public.notesapp_current_account();
		claimed public.invitations%ROWTYPE;
	BEGIN
		IF claimer IS NULL THEN
			RAISE EXCEPTION 'notesapp: the transaction has no account identity'
				USING ERRCODE = '42501';
		END IF;
		UPDATE public.invitations i
		SET accepted_at = now(), accepted_by = claimer
		WHERE i.token_hash = p_token_hash
			AND i.accepted_at IS NULL
			AND i.revoked_at IS NULL
			AND i.expires_at > now()
			AND lower(i.email) = lower(p_email)
		RETURNING i.* INTO claimed;
		IF claimed.id IS NULL THEN
			RETURN;
		END IF;
		INSERT INTO public.memberships (workspace_id, account_id, role)
			VALUES (claimed.workspace_id, claimer, claimed.role)
			ON CONFLICT (workspace_id, account_id) DO NOTHING;
		granted_workspace_id := claimed.workspace_id;
		granted_role := claimed.role::text;
		RETURN NEXT;
	END
	$$;--> statement-breakpoint

-- The account of one Better Auth user, or null.
--
-- The application role holds no right on the identity tables, so this is the
-- only way it can learn that a verified user already has an account. The
-- function returns one identifier and nothing else.
CREATE FUNCTION public.notesapp_account_of(p_auth_user_id text) RETURNS uuid
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT ai.account_id FROM public.account_identities ai
		WHERE ai.auth_user_id = p_auth_user_id
	$$;--> statement-breakpoint

-- Whether this installation already has an account. The bootstrap command
-- refuses to run a second time on the strength of this answer.
CREATE FUNCTION public.notesapp_has_account() RETURNS boolean
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT EXISTS (SELECT 1 FROM public.account_identities)
	$$;--> statement-breakpoint

-- The member directory of one workspace.
--
-- A member list shows the address and the display name of every co-member. The
-- application role cannot read the identity tables, so this function reads them
-- and returns those two columns only. It requires a membership, so a stranger
-- learns nothing.
CREATE FUNCTION public.notesapp_workspace_members(p_workspace_id uuid)
	RETURNS TABLE (
		member_account_id uuid,
		member_role text,
		member_email text,
		member_name text)
	LANGUAGE plpgsql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		IF NOT public.notesapp_is_member(p_workspace_id) THEN
			RAISE EXCEPTION 'notesapp: the account is not a member of this workspace'
				USING ERRCODE = '42501';
		END IF;
		RETURN QUERY
			SELECT m.account_id, m.role::text, u.email, u.name
			FROM public.memberships m
			LEFT JOIN public.account_identities ai ON ai.account_id = m.account_id
			LEFT JOIN public.auth_user u ON u.id = ai.auth_user_id
			WHERE m.workspace_id = p_workspace_id
			ORDER BY m.created_at ASC, m.account_id ASC;
	END
	$$;--> statement-breakpoint

-- The address and the workspace of one open invitation.
--
-- Acceptance needs both before it can consume the invitation: the workspace to
-- take its lock, and the address to create a local account for a person who
-- has none. The function returns no token and no hash.
CREATE FUNCTION public.notesapp_open_invitation(p_token_hash text)
	RETURNS TABLE (invited_workspace_id uuid, invited_email text)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT i.workspace_id, i.email
		FROM public.invitations i
		WHERE i.token_hash = p_token_hash
			AND i.accepted_at IS NULL
			AND i.revoked_at IS NULL
			AND i.expires_at > now()
	$$;--> statement-breakpoint

-- Resolves an agent token by the hash of its secret.
--
-- The lookup happens before any identity exists, so it cannot pass the row
-- policy of `agent_tokens`. The function returns the stored scope and the
-- expiry; the caller checks both and then intersects the scope with the
-- current membership.
CREATE FUNCTION public.notesapp_agent_token(p_token_hash text)
	RETURNS TABLE (
		token_id uuid,
		owner_account_id uuid,
		token_scopes jsonb,
		token_expires_at timestamptz,
		token_revoked_at timestamptz)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT t.id, t.account_id, t.scopes, t.expires_at, t.revoked_at
		FROM public.agent_tokens t
		WHERE t.token_hash = p_token_hash
	$$;--> statement-breakpoint

-- Removes an account that was created for an invitation and never used.
--
-- The invitation sign-up path creates the account, its personal workspace, and
-- its membership before it consumes the invitation. When that last step fails,
-- for example because another request consumed the same token first, this
-- function removes what the attempt created, so a failed acceptance leaves no
-- account behind.
--
-- It refuses when the account belongs to any workspace that is not its own
-- personal one, so it can never remove an account that has already been used.
CREATE FUNCTION public.notesapp_discard_account(p_auth_user_id text)
	RETURNS boolean
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		target uuid;
		victim uuid;
	BEGIN
		SELECT ai.account_id INTO target
		FROM public.account_identities ai
		WHERE ai.auth_user_id = p_auth_user_id;
		IF target IS NULL THEN
			RETURN false;
		END IF;
		IF EXISTS (
			SELECT 1 FROM public.memberships m
			JOIN public.workspaces w ON w.id = m.workspace_id
			WHERE m.account_id = target AND w.personal = false
		) THEN
			RETURN false;
		END IF;
		IF EXISTS (
			SELECT 1 FROM public.files f
			JOIN public.memberships m ON m.workspace_id = f.workspace_id
			WHERE m.account_id = target
		) THEN
			RETURN false;
		END IF;
		PERFORM set_config('notesapp.purge', 'on', true);
		FOR victim IN
			SELECT m.workspace_id FROM public.memberships m
			WHERE m.account_id = target
		LOOP
			DELETE FROM public.sync_changes WHERE workspace_id = victim;
			DELETE FROM public.audit_events WHERE workspace_id = victim;
			DELETE FROM public.invitations WHERE workspace_id = victim;
			DELETE FROM public.memberships WHERE workspace_id = victim;
			DELETE FROM public.workspace_cursors WHERE workspace_id = victim;
			DELETE FROM public.workspace_usage WHERE workspace_id = victim;
			DELETE FROM public.workspaces WHERE id = victim;
		END LOOP;
		DELETE FROM public.account_audit_events WHERE account_id = target;
		DELETE FROM public.account_preferences WHERE account_id = target;
		DELETE FROM public.account_identities WHERE account_id = target;
		DELETE FROM public.accounts WHERE id = target;
		PERFORM set_config('notesapp.purge', 'off', true);
		RETURN true;
	END
	$$;--> statement-breakpoint

-- Removes a workspace and every record that belongs to it.
--
-- Only an owner may call it. The immutable content tables are cleared with the
-- purge setting that migration 0001 defined, because the workspace itself
-- disappears. Attachment bytes on the private volume are reclaimed by the
-- cleanup job that owns them; this function removes only database rows.
CREATE FUNCTION public.notesapp_delete_workspace(p_workspace_id uuid)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		-- A null role is not the owner role either, so the comparison has to be
		-- `IS DISTINCT FROM` and not `<>`.
		IF public.notesapp_member_role(p_workspace_id) IS DISTINCT FROM 'owner' THEN
			RAISE EXCEPTION 'notesapp: only an owner can delete a workspace'
				USING ERRCODE = '42501';
		END IF;
		PERFORM set_config('notesapp.purge', 'on', true);
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

REVOKE ALL ON FUNCTION public.notesapp_account_of(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_has_account() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_workspace_members(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_open_invitation(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_account_of(text) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_has_account() TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_workspace_members(uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_open_invitation(text) TO notesapp_app;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_link_account(text, uuid, uuid, text, bigint) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_create_workspace(uuid, text, bigint) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_transfer_ownership(uuid, uuid, boolean) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_claim_invitation(text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_agent_token(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_delete_workspace(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_discard_account(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_discard_account(text) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_link_account(text, uuid, uuid, text, bigint) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_create_workspace(uuid, text, bigint) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_transfer_ownership(uuid, uuid, boolean) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_claim_invitation(text, text) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_agent_token(text) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_delete_workspace(uuid) TO notesapp_app;
