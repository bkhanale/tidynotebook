CREATE TYPE "public"."account_state" AS ENUM('enabled', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."address_proof" AS ENUM('setup', 'mail', 'administrator');--> statement-breakpoint
CREATE TYPE "public"."installation_role" AS ENUM('administrator', 'member');--> statement-breakpoint
CREATE TYPE "public"."registration_policy" AS ENUM('invitation', 'open');--> statement-breakpoint
CREATE TABLE "installation_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"registration_policy" "registration_policy" DEFAULT 'invitation' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installation_settings_one_row" CHECK ("installation_settings"."id")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_digest" text NOT NULL,
	"email" text NOT NULL,
	"target" text DEFAULT 'installation' NOT NULL,
	"created_by" uuid,
	"mailed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invitations_token_digest_unique" UNIQUE("token_digest"),
	CONSTRAINT "invitations_token_digest_check" CHECK ("invitations"."token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "invitations_email_check" CHECK ("invitations"."email" = lower("invitations"."email") and char_length("invitations"."email") between 3 and 320),
	CONSTRAINT "invitations_target_check" CHECK ("invitations"."target" = 'installation'),
	CONSTRAINT "invitations_used_check" CHECK (("invitations"."used_at" is null) = ("invitations"."used_by" is null))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "installation_role" "installation_role" DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "state" "account_state" DEFAULT 'enabled' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "limit_bytes" bigint;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "address_proof" "address_proof";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_used_by_accounts_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "accounts_administrator_idx" ON "accounts" USING btree ("installation_role","state");--> statement-breakpoint
-- Several accounts on one installation, from design 015 and records 0108 to
-- 0112. The statements above are the ones that `src/schema.ts` generates, with
-- one change: `limit_bytes` is added without its not null constraint, because
-- the rows of an earlier release need a value first.
--
-- Every account of an earlier release is the first account of its
-- installation, which setup or the bootstrap command made. It becomes an
-- administrator whose address the operator typed. Its limit is the largest
-- quota of a workspace that it owns, which is the limit it wrote under, or the
-- default of the configuration of that release when it owns none.
UPDATE public.accounts a SET
	installation_role = 'administrator',
	address_proof = 'setup',
	limit_bytes = coalesce(
		(SELECT max(u.quota_bytes) FROM public.workspace_usage u
			JOIN public.memberships m ON m.workspace_id = u.workspace_id
			WHERE m.account_id = a.id AND m.role = 'owner'),
		5368709120);--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "limit_bytes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_limit_bytes_check" CHECK ("accounts"."limit_bytes" > 0);--> statement-breakpoint
ALTER TABLE "workspace_usage" DROP COLUMN "quota_bytes";--> statement-breakpoint

-- The one row of the settings. Every installation starts with invitations.
INSERT INTO public.installation_settings (id) VALUES (true);--> statement-breakpoint

-- The settings and the invitations are reached through the functions below
-- only. The runtime role holds no right on either table, and the policies
-- below are the second control.
DO $$
DECLARE
	name text;
BEGIN
	FOREACH name IN ARRAY ARRAY['installation_settings', 'invitations'] LOOP
		EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', name);
		EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', name);
		EXECUTE format(
			'CREATE POLICY %I ON public.%I FOR ALL TO %I USING (true) WITH CHECK (true)',
			name || '_owner_policy', name, current_user);
	END LOOP;
END
$$;--> statement-breakpoint

-- The one lock order of record 0112: the installation lock, then the
-- workspace locks in the order of the workspace identifier, then the account
-- locks in the order of the account identifier. A path takes only the locks
-- it needs. The workspace lock is the one that `transaction.ts` takes, keyed
-- by the workspace identifier. The other two keys carry a prefix, so no key of
-- one kind can meet a key of another.
CREATE FUNCTION public.notesapp_lock_installation() RETURNS void
	LANGUAGE sql
	SET search_path = pg_catalog, public
	AS $$
		SELECT pg_advisory_xact_lock(hashtext('notesapp:installation')::bigint)
	$$;--> statement-breakpoint

CREATE FUNCTION public.notesapp_lock_account(p_account_id uuid) RETURNS void
	LANGUAGE sql
	SET search_path = pg_catalog, public
	AS $$
		SELECT pg_advisory_xact_lock(
			hashtext('notesapp:account:' || p_account_id::text)::bigint)
	$$;--> statement-breakpoint

-- Whether the account of the transaction is an enabled administrator. A
-- removed account is never one, because removal makes it a disabled member.
CREATE FUNCTION public.notesapp_is_administrator() RETURNS boolean
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT EXISTS (
			SELECT 1 FROM public.accounts a
			WHERE a.id = public.notesapp_current_account()
				AND a.installation_role = 'administrator'
				AND a.state = 'enabled'
				AND a.removed_at IS NULL
		)
	$$;--> statement-breakpoint

-- Whether the transaction runs for an operator command. The command sets the
-- setting and no account identity. This is a guard against a mistake of the
-- application, not against a holder of the runtime credential: an operator
-- command holds the same credential as the server.
CREATE FUNCTION public.notesapp_is_operator() RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
	AS $$
		SELECT current_setting('notesapp.operator', true) = 'on'
			AND public.notesapp_current_account() IS NULL
	$$;--> statement-breakpoint

-- Refuses a transaction that is not an enabled administrator.
CREATE FUNCTION public.notesapp_require_administrator() RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		IF NOT public.notesapp_is_administrator() THEN
			RAISE EXCEPTION 'notesapp: only an administrator can do this'
				USING ERRCODE = '42501';
		END IF;
	END
	$$;--> statement-breakpoint

-- The installation role and the state of one account, for the account itself
-- and for an administrator. A removed account answers no row, and so does an
-- account that the caller may not read.
CREATE FUNCTION public.notesapp_account_standing(p_account_id uuid)
	RETURNS TABLE (installation_role text, state text)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT a.installation_role::text, a.state::text
		FROM public.accounts a
		WHERE a.id = p_account_id
			AND a.removed_at IS NULL
			AND (a.id = public.notesapp_current_account()
				OR public.notesapp_is_administrator())
	$$;--> statement-breakpoint

-- How many accounts are enabled administrators. The count reads no personal
-- fact, so every account may ask it.
CREATE FUNCTION public.notesapp_enabled_administrators() RETURNS integer
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT count(*)::integer FROM public.accounts a
		WHERE a.installation_role = 'administrator'
			AND a.state = 'enabled'
			AND a.removed_at IS NULL
	$$;--> statement-breakpoint

-- Refuses a change that leaves the installation with no enabled
-- administrator (record 0110). The caller holds the installation lock, so two
-- administrators who demote each other at the same time are ordered and the
-- second one reads the count that the first one left.
CREATE FUNCTION public.notesapp_keep_administrator(
		p_account_id uuid,
		p_role public.installation_role,
		p_state public.account_state,
		p_removed boolean)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		was_admin boolean;
	BEGIN
		SELECT a.installation_role = 'administrator' AND a.state = 'enabled'
			INTO was_admin
		FROM public.accounts a
		WHERE a.id = p_account_id AND a.removed_at IS NULL;
		IF was_admin IS NOT TRUE THEN
			RETURN;
		END IF;
		IF NOT p_removed AND p_role = 'administrator' AND p_state = 'enabled' THEN
			RETURN;
		END IF;
		IF NOT EXISTS (
			SELECT 1 FROM public.accounts a
			WHERE a.id <> p_account_id
				AND a.installation_role = 'administrator'
				AND a.state = 'enabled'
				AND a.removed_at IS NULL
		) THEN
			RAISE EXCEPTION 'notesapp: the installation keeps one enabled administrator'
				USING ERRCODE = 'NA002';
		END IF;
	END
	$$;--> statement-breakpoint

-- Appends one record of an administrator action to the trail of the target
-- account (record 0109). The actor is the content free target of the record.
CREATE FUNCTION public.notesapp_audit_administration(
		p_account_id uuid,
		p_action text)
	RETURNS void
	LANGUAGE sql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		INSERT INTO public.account_audit_events
			(id, account_id, action, target_kind, target_id)
		VALUES (gen_random_uuid(), p_account_id, p_action, 'administrator',
			public.notesapp_current_account())
	$$;--> statement-breakpoint

-- Every account that is not removed, for an administrator. The answer holds
-- the name, the address, the state, the last activity and the usage of each
-- account, and no fact of a note (record 0109).
CREATE FUNCTION public.notesapp_list_accounts()
	RETURNS TABLE (
		account_id uuid,
		email text,
		name text,
		installation_role text,
		state text,
		created_at timestamptz,
		last_active_at timestamptz,
		used_bytes bigint,
		limit_bytes bigint)
	LANGUAGE plpgsql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		PERFORM public.notesapp_require_administrator();
		RETURN QUERY
		SELECT a.id, u.email, u.name, a.installation_role::text, a.state::text,
			a.created_at,
			(SELECT max(s.updated_at) FROM public.auth_session s
				WHERE s.user_id = ai.auth_user_id),
			coalesce((SELECT sum(w.bytes_used) FROM public.workspace_usage w
				JOIN public.memberships m ON m.workspace_id = w.workspace_id
				WHERE m.account_id = a.id AND m.role = 'owner'), 0)::bigint,
			a.limit_bytes
		FROM public.accounts a
		LEFT JOIN public.account_identities ai ON ai.account_id = a.id
		LEFT JOIN public.auth_user u ON u.id = ai.auth_user_id
		WHERE a.removed_at IS NULL
		ORDER BY a.created_at, a.id;
	END
	$$;--> statement-breakpoint

-- Changes the installation role of one account, for an administrator.
CREATE FUNCTION public.notesapp_set_installation_role(
		p_account_id uuid,
		p_role public.installation_role)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		v_state public.account_state;
	BEGIN
		PERFORM public.notesapp_lock_installation();
		PERFORM public.notesapp_require_administrator();
		SELECT a.state INTO v_state FROM public.accounts a
		WHERE a.id = p_account_id AND a.removed_at IS NULL;
		IF v_state IS NULL THEN
			RAISE EXCEPTION 'notesapp: no such account' USING ERRCODE = 'P0002';
		END IF;
		PERFORM public.notesapp_keep_administrator(p_account_id, p_role,
			v_state, false);
		UPDATE public.accounts SET installation_role = p_role
		WHERE id = p_account_id;
		PERFORM public.notesapp_audit_administration(p_account_id,
			'installation.role');
	END
	$$;--> statement-breakpoint

-- Changes the state of one account, for an administrator. Disabling it ends
-- every session of it in the same transaction, and the session create hook
-- refuses the next one (record 0111).
CREATE FUNCTION public.notesapp_set_account_state(
		p_account_id uuid,
		p_state public.account_state)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		v_role public.installation_role;
	BEGIN
		PERFORM public.notesapp_lock_installation();
		PERFORM public.notesapp_require_administrator();
		SELECT a.installation_role INTO v_role FROM public.accounts a
		WHERE a.id = p_account_id AND a.removed_at IS NULL;
		IF v_role IS NULL THEN
			RAISE EXCEPTION 'notesapp: no such account' USING ERRCODE = 'P0002';
		END IF;
		PERFORM public.notesapp_keep_administrator(p_account_id, v_role,
			p_state, false);
		UPDATE public.accounts SET state = p_state WHERE id = p_account_id;
		IF p_state = 'disabled' THEN
			DELETE FROM public.auth_session s
			USING public.account_identities ai
			WHERE ai.account_id = p_account_id AND s.user_id = ai.auth_user_id;
		END IF;
		PERFORM public.notesapp_audit_administration(p_account_id,
			'installation.state');
	END
	$$;--> statement-breakpoint

-- Changes the byte limit of one account, for an administrator.
CREATE FUNCTION public.notesapp_set_account_limit(
		p_account_id uuid,
		p_limit_bytes bigint)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		PERFORM public.notesapp_lock_installation();
		PERFORM public.notesapp_require_administrator();
		PERFORM public.notesapp_lock_account(p_account_id);
		UPDATE public.accounts SET limit_bytes = p_limit_bytes
		WHERE id = p_account_id AND removed_at IS NULL;
		IF NOT FOUND THEN
			RAISE EXCEPTION 'notesapp: no such account' USING ERRCODE = 'P0002';
		END IF;
		PERFORM public.notesapp_audit_administration(p_account_id,
			'installation.limit');
	END
	$$;--> statement-breakpoint

-- Removes every row of one workspace. It checks nothing: the two callers
-- below check who may remove it first, and the runtime role cannot call it.
-- `tests/integration/workspaces.test.ts` reads every table with a
-- `workspace_id` column from the catalog after a delete, so a table that a
-- later migration adds and this function forgets fails that test.
CREATE FUNCTION public.notesapp_erase_workspace(p_workspace_id uuid)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
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

-- The body of migration 0008, with the rows removed by the one erase function
-- above, so the deletion of one workspace and the removal of an account delete
-- the same rows. Rights survive a replacement.
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
		PERFORM public.notesapp_erase_workspace(p_workspace_id);
	END
	$$;--> statement-breakpoint

-- Removes one account and keeps its row as a tombstone (record 0111).
--
-- The caller is the account itself or an enabled administrator. The locks
-- follow the one order: the installation lock, then the lock of each
-- workspace of the account in the order of its identifier, then the lock of
-- the account. Each workspace that the account owns goes with every row of
-- it, and a membership in the workspace of another account goes alone. The
-- identity user goes, and with it every session, the credential and the
-- account map. The settings and the audit trail go too. The row that stays
-- holds no identity, no address, no name and no setting.
CREATE FUNCTION public.notesapp_remove_account(p_account_id uuid)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		target record;
		held record;
	BEGIN
		PERFORM public.notesapp_lock_installation();
		IF public.notesapp_current_account() IS DISTINCT FROM p_account_id
			AND NOT public.notesapp_is_administrator() THEN
			RAISE EXCEPTION 'notesapp: only the account or an administrator can remove it'
				USING ERRCODE = '42501';
		END IF;
		SELECT a.installation_role, a.state INTO target FROM public.accounts a
		WHERE a.id = p_account_id AND a.removed_at IS NULL;
		IF NOT FOUND THEN
			RAISE EXCEPTION 'notesapp: no such account' USING ERRCODE = 'P0002';
		END IF;
		IF public.notesapp_current_account() = p_account_id
			AND target.state <> 'enabled' THEN
			RAISE EXCEPTION 'notesapp: a disabled account cannot remove itself'
				USING ERRCODE = '42501';
		END IF;
		PERFORM public.notesapp_keep_administrator(p_account_id,
			target.installation_role, target.state, true);
		FOR held IN
			SELECT m.workspace_id, m.role FROM public.memberships m
			WHERE m.account_id = p_account_id ORDER BY m.workspace_id
		LOOP
			PERFORM pg_advisory_xact_lock(hashtext(held.workspace_id::text)::bigint);
		END LOOP;
		PERFORM public.notesapp_lock_account(p_account_id);
		FOR held IN
			SELECT m.workspace_id, m.role FROM public.memberships m
			WHERE m.account_id = p_account_id ORDER BY m.workspace_id
		LOOP
			IF held.role = 'owner' THEN
				PERFORM public.notesapp_erase_workspace(held.workspace_id);
			ELSE
				DELETE FROM public.memberships
				WHERE workspace_id = held.workspace_id AND account_id = p_account_id;
			END IF;
		END LOOP;
		DELETE FROM public.account_preferences WHERE account_id = p_account_id;
		DELETE FROM public.account_audit_events WHERE account_id = p_account_id;
		DELETE FROM public.auth_user u
		USING public.account_identities ai
		WHERE ai.account_id = p_account_id AND u.id = ai.auth_user_id;
		UPDATE public.accounts SET
			removed_at = now(),
			state = 'disabled',
			installation_role = 'member',
			address_proof = NULL
		WHERE id = p_account_id;
	END
	$$;--> statement-breakpoint

-- Stores one invitation, for an administrator or for the operator command
-- (record 0108). The answer is the time it was made, or null when an account
-- already signs in with the address, which is then left alone.
CREATE FUNCTION public.notesapp_invite(
		p_invitation_id uuid,
		p_token_digest text,
		p_email text,
		p_expires_at timestamptz,
		p_mailed boolean)
	RETURNS timestamptz
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		made timestamptz;
	BEGIN
		IF NOT public.notesapp_is_administrator() AND NOT public.notesapp_is_operator() THEN
			RAISE EXCEPTION 'notesapp: only an administrator can invite'
				USING ERRCODE = '42501';
		END IF;
		-- An address signs in when an account links an identity user with it.
		-- An identity user with no account is a failed attempt, and it does not
		-- stop an invitation.
		IF EXISTS (
			SELECT 1 FROM public.auth_user u
			JOIN public.account_identities ai ON ai.auth_user_id = u.id
			WHERE lower(u.email) = p_email
		) THEN
			RETURN NULL;
		END IF;
		INSERT INTO public.invitations
			(id, token_digest, email, created_by, mailed, expires_at)
		VALUES (p_invitation_id, p_token_digest, p_email,
			public.notesapp_current_account(), p_mailed, p_expires_at)
		RETURNING created_at INTO made;
		RETURN made;
	END
	$$;--> statement-breakpoint

-- Every invitation that nobody used or revoked, newest first, for an
-- administrator. The answer holds no digest.
CREATE FUNCTION public.notesapp_list_invitations()
	RETURNS TABLE (
		invitation_id uuid,
		email text,
		created_at timestamptz,
		expires_at timestamptz,
		mailed boolean)
	LANGUAGE plpgsql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		PERFORM public.notesapp_require_administrator();
		RETURN QUERY
		SELECT i.id, i.email, i.created_at, i.expires_at, i.mailed
		FROM public.invitations i
		WHERE i.used_at IS NULL AND i.revoked_at IS NULL
		ORDER BY i.created_at DESC, i.id;
	END
	$$;--> statement-breakpoint

-- Revokes one waiting invitation, for an administrator.
CREATE FUNCTION public.notesapp_revoke_invitation(p_invitation_id uuid)
	RETURNS boolean
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		PERFORM public.notesapp_require_administrator();
		UPDATE public.invitations SET revoked_at = now()
		WHERE id = p_invitation_id AND used_at IS NULL AND revoked_at IS NULL;
		RETURN FOUND;
	END
	$$;--> statement-breakpoint

-- The address of a valid invitation, or null. Anybody may ask, because only a
-- holder of the token knows the digest to ask with.
CREATE FUNCTION public.notesapp_invitation_address(p_token_digest text)
	RETURNS text
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT i.email FROM public.invitations i
		WHERE i.token_digest = p_token_digest
			AND i.used_at IS NULL
			AND i.revoked_at IS NULL
			AND i.expires_at > now()
	$$;--> statement-breakpoint

-- The registration policy of the installation.
CREATE FUNCTION public.notesapp_registration_policy()
	RETURNS public.registration_policy
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT s.registration_policy FROM public.installation_settings s
	$$;--> statement-breakpoint

-- Changes the registration policy, for an administrator. The use case checks
-- the preconditions of open registration first (record 0114).
CREATE FUNCTION public.notesapp_set_registration_policy(
		p_policy public.registration_policy)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		PERFORM public.notesapp_lock_installation();
		PERFORM public.notesapp_require_administrator();
		UPDATE public.installation_settings
		SET registration_policy = p_policy, updated_at = now();
	END
	$$;--> statement-breakpoint

-- The one registration path of the installation (record 0108).
--
-- It takes the identity user and one ground. The first run makes the first
-- account an administrator, and only while no account row exists, under the
-- installation lock. An invitation makes a member for the address that it
-- binds: the row is locked, and a used, revoked or expired one refuses, so two
-- acceptances of one invitation make one account. The open ground needs the
-- open policy. The account, its personal workspace, its settings, its cursor
-- and its owner membership are written in this transaction, and the
-- invitation is marked used in it.
--
-- The answer is the account, or null when no ground allows it. A second call
-- for an identity user that is already linked answers its account.
CREATE FUNCTION public.notesapp_register_account(
		p_auth_user_id text,
		p_ground text,
		p_token_digest text,
		p_account_id uuid,
		p_workspace_id uuid,
		p_workspace_name text,
		p_limit_bytes bigint)
	RETURNS uuid
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		linked uuid;
		address text;
		invitation record;
		v_role public.installation_role;
		v_proof public.address_proof;
	BEGIN
		SELECT ai.account_id INTO linked FROM public.account_identities ai
		WHERE ai.auth_user_id = p_auth_user_id;
		IF linked IS NOT NULL THEN
			RETURN linked;
		END IF;
		SELECT lower(u.email) INTO address FROM public.auth_user u
		WHERE u.id = p_auth_user_id;
		IF address IS NULL THEN
			RETURN NULL;
		END IF;
		IF p_ground = 'first-run' THEN
			PERFORM public.notesapp_lock_installation();
			IF EXISTS (SELECT 1 FROM public.accounts) THEN
				RETURN NULL;
			END IF;
			v_role := 'administrator';
			v_proof := 'setup';
		ELSIF p_ground = 'invitation' THEN
			SELECT i.id, i.email, i.mailed INTO invitation
			FROM public.invitations i
			WHERE i.token_digest = p_token_digest
				AND i.used_at IS NULL
				AND i.revoked_at IS NULL
				AND i.expires_at > now()
			FOR UPDATE;
			IF NOT FOUND OR invitation.email <> address THEN
				RETURN NULL;
			END IF;
			v_role := 'member';
			v_proof := CASE WHEN invitation.mailed THEN 'mail' ELSE 'administrator' END;
		ELSIF p_ground = 'open' THEN
			IF public.notesapp_registration_policy() IS DISTINCT FROM 'open' THEN
				RETURN NULL;
			END IF;
			v_role := 'member';
			v_proof := 'mail';
		ELSE
			RETURN NULL;
		END IF;
		INSERT INTO public.accounts (id, installation_role, state, limit_bytes, address_proof)
			VALUES (p_account_id, v_role, 'enabled', p_limit_bytes, v_proof);
		INSERT INTO public.account_identities (auth_user_id, account_id)
			VALUES (p_auth_user_id, p_account_id);
		INSERT INTO public.account_preferences (account_id) VALUES (p_account_id);
		INSERT INTO public.workspaces (id, name, personal)
			VALUES (p_workspace_id, p_workspace_name, true);
		INSERT INTO public.workspace_usage (workspace_id, bytes_used)
			VALUES (p_workspace_id, 0);
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
		IF p_ground = 'invitation' THEN
			UPDATE public.invitations SET used_at = now(), used_by = p_account_id
			WHERE id = invitation.id;
		END IF;
		RETURN p_account_id;
	END
	$$;--> statement-breakpoint

DROP FUNCTION public.notesapp_link_account(text, uuid, uuid, text, bigint);--> statement-breakpoint

-- The account of a session: an enabled account that is not removed, or null.
-- The actor resolver and the session create hook both ask it, so a disabled
-- account gets no actor and no new session (record 0111).
CREATE FUNCTION public.notesapp_session_account(p_auth_user_id text)
	RETURNS uuid
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT a.id FROM public.account_identities ai
		JOIN public.accounts a ON a.id = ai.account_id
		WHERE ai.auth_user_id = p_auth_user_id
			AND a.state = 'enabled'
			AND a.removed_at IS NULL
	$$;--> statement-breakpoint

-- The owner account of one workspace. Every workspace has one owner now.
CREATE FUNCTION public.notesapp_workspace_owner(p_workspace_id uuid)
	RETURNS uuid
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT m.account_id FROM public.memberships m
		WHERE m.workspace_id = p_workspace_id AND m.role = 'owner'
		ORDER BY m.account_id
		LIMIT 1
	$$;--> statement-breakpoint

-- The bytes that the owner account of one workspace uses over every workspace
-- it owns, and its limit (record 0112). The caller holds the workspace lock,
-- and this takes the lock of the owner account after it, in the one order, so
-- two writes to two workspaces of one owner read the sum one after the other.
CREATE FUNCTION public.notesapp_account_usage(p_workspace_id uuid)
	RETURNS TABLE (used_bytes bigint, limit_bytes bigint)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		owner_id uuid;
	BEGIN
		IF NOT public.notesapp_is_member(p_workspace_id) THEN
			RAISE EXCEPTION 'notesapp: the account is not a member of this workspace'
				USING ERRCODE = '42501';
		END IF;
		owner_id := public.notesapp_workspace_owner(p_workspace_id);
		IF owner_id IS NULL THEN
			RAISE EXCEPTION 'notesapp: the workspace has no owner'
				USING ERRCODE = '23503';
		END IF;
		PERFORM public.notesapp_lock_account(owner_id);
		RETURN QUERY
		SELECT coalesce((SELECT sum(w.bytes_used) FROM public.workspace_usage w
				JOIN public.memberships m ON m.workspace_id = w.workspace_id
				WHERE m.account_id = owner_id AND m.role = 'owner'), 0)::bigint,
			a.limit_bytes
		FROM public.accounts a WHERE a.id = owner_id;
	END
	$$;--> statement-breakpoint

-- Usage accounting, with the limit of the owner account (record 0112).
--
-- The body of the first migration, plus the check of the limit. The use case
-- checks the limit first and keeps a reserve for a deletion. This function is
-- the second lock: it refuses a write that takes the owner past its limit,
-- whatever the layers above it do. Rights survive a replacement.
CREATE OR REPLACE FUNCTION public.notesapp_add_usage(p_workspace_id uuid, p_delta bigint)
	RETURNS bigint
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		updated bigint;
		owned record;
	BEGIN
		IF NOT public.notesapp_is_member(p_workspace_id) THEN
			RAISE EXCEPTION 'notesapp: the account is not a member of this workspace'
				USING ERRCODE = '42501';
		END IF;
		IF p_delta < 0 THEN
			RAISE EXCEPTION 'notesapp: workspace usage cannot be reduced through this path'
				USING ERRCODE = '23514';
		END IF;
		SELECT * INTO owned FROM public.notesapp_account_usage(p_workspace_id);
		IF owned.used_bytes + p_delta > owned.limit_bytes THEN
			RAISE EXCEPTION 'notesapp: the owner account has no room left'
				USING ERRCODE = 'NA003';
		END IF;
		UPDATE public.workspace_usage
		SET bytes_used = bytes_used + p_delta
		WHERE workspace_id = p_workspace_id
		RETURNING bytes_used INTO updated;
		IF updated IS NULL THEN
			RAISE EXCEPTION 'notesapp: the workspace has no usage record'
				USING ERRCODE = '23503';
		END IF;
		IF updated < 0 THEN
			RAISE EXCEPTION 'notesapp: workspace usage cannot become negative'
				USING ERRCODE = '23514';
		END IF;
		RETURN updated;
	END
	$$;--> statement-breakpoint

-- Creates a workspace owned by the account of the transaction. The limit
-- belongs to the account now, so the workspace takes none. The caller holds
-- the lock of the new workspace, and this takes the account lock after it.
DROP FUNCTION public.notesapp_create_workspace(uuid, text, bigint);--> statement-breakpoint
CREATE FUNCTION public.notesapp_create_workspace(
		p_workspace_id uuid,
		p_name text)
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
		PERFORM public.notesapp_lock_account(creator);
		INSERT INTO public.workspaces (id, name, personal)
			VALUES (p_workspace_id, p_name, false);
		INSERT INTO public.workspace_usage (workspace_id, bytes_used)
			VALUES (p_workspace_id, 0);
		INSERT INTO public.workspace_cursors (workspace_id, last_cursor)
			VALUES (p_workspace_id, 0);
		INSERT INTO public.memberships (workspace_id, account_id, role)
			VALUES (p_workspace_id, creator, 'owner');
	END
	$$;--> statement-breakpoint

-- Makes one account an enabled administrator, for the operator command
-- `pnpm account:promote` (record 0110). It answers the account, or null when
-- no account signs in with the address.
CREATE FUNCTION public.notesapp_operator_promote(p_email text)
	RETURNS uuid
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		target uuid;
	BEGIN
		IF NOT public.notesapp_is_operator() THEN
			RAISE EXCEPTION 'notesapp: only the operator command can promote'
				USING ERRCODE = '42501';
		END IF;
		PERFORM public.notesapp_lock_installation();
		SELECT ai.account_id INTO target FROM public.auth_user u
		JOIN public.account_identities ai ON ai.auth_user_id = u.id
		WHERE lower(u.email) = lower(p_email);
		IF target IS NULL THEN
			RETURN NULL;
		END IF;
		UPDATE public.accounts SET installation_role = 'administrator', state = 'enabled'
		WHERE id = target AND removed_at IS NULL;
		INSERT INTO public.account_audit_events
			(id, account_id, action, target_kind, target_id)
		VALUES (gen_random_uuid(), target, 'installation.promote', 'operator', NULL);
		RETURN target;
	END
	$$;--> statement-breakpoint

-- Function rights. The lock helpers, the administrator check and the erase
-- function stay with the schema owner, so the runtime role reaches a workspace
-- erase through the two checked callers only.
REVOKE ALL ON FUNCTION public.notesapp_lock_installation() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_lock_account(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_is_administrator() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_is_operator() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_require_administrator() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_account_standing(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_enabled_administrators() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_keep_administrator(uuid, public.installation_role, public.account_state, boolean) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_audit_administration(uuid, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_list_accounts() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_set_installation_role(uuid, public.installation_role) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_set_account_state(uuid, public.account_state) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_set_account_limit(uuid, bigint) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_erase_workspace(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_remove_account(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_invite(uuid, text, text, timestamptz, boolean) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_list_invitations() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_revoke_invitation(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_invitation_address(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_registration_policy() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_set_registration_policy(public.registration_policy) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_register_account(text, text, text, uuid, uuid, text, bigint) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_session_account(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_workspace_owner(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_account_usage(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_create_workspace(uuid, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_operator_promote(text) FROM PUBLIC;--> statement-breakpoint

-- The installation transaction of the use cases takes the lock first, so the
-- standing and the count that it reads are the ones its change acts on.
GRANT EXECUTE ON FUNCTION public.notesapp_lock_installation() TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_account_standing(uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_enabled_administrators() TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_list_accounts() TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_set_installation_role(uuid, public.installation_role) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_set_account_state(uuid, public.account_state) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_set_account_limit(uuid, bigint) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_remove_account(uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_invite(uuid, text, text, timestamptz, boolean) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_list_invitations() TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_revoke_invitation(uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_invitation_address(text) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_registration_policy() TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_set_registration_policy(public.registration_policy) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_register_account(text, text, text, uuid, uuid, text, bigint) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_session_account(text) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_account_usage(uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_create_workspace(uuid, text) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_operator_promote(text) TO notesapp_app;--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the thirteenth entry, so the function reports thirteen.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 13;
$$;
