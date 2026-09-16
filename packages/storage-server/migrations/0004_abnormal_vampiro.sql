CREATE TYPE "public"."publication_scope" AS ENUM('note', 'folder');--> statement-breakpoint
CREATE TABLE "publications" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"owner_account_id" uuid NOT NULL,
	"token_digest" text NOT NULL,
	"scope_kind" "publication_scope" NOT NULL,
	"scope_file_id" uuid,
	"scope_path" text,
	"password_digest" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publications_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "publications_token_key" UNIQUE("token_digest"),
	CONSTRAINT "publications_scope_check" CHECK (("publications"."scope_kind" = 'note' and "publications"."scope_file_id" is not null and "publications"."scope_path" is null)
        or ("publications"."scope_kind" = 'folder' and "publications"."scope_path" is not null and "publications"."scope_file_id" is null)),
	CONSTRAINT "publications_token_digest_check" CHECK ("publications"."token_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "reading_tickets" (
	"ticket_digest" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reading_tickets_digest_check" CHECK ("reading_tickets"."ticket_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_scope_file_fk" FOREIGN KEY ("workspace_id","scope_file_id") REFERENCES "public"."files"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_tickets" ADD CONSTRAINT "reading_tickets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_tickets" ADD CONSTRAINT "reading_tickets_publication_fk" FOREIGN KEY ("workspace_id","publication_id") REFERENCES "public"."publications"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publications_workspace_idx" ON "publications" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "publications_scope_file_idx" ON "publications" USING btree ("workspace_id","scope_file_id");--> statement-breakpoint
CREATE INDEX "publications_expiry_idx" ON "publications" USING btree ("expires_at") WHERE "publications"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "publications_revoked_idx" ON "publications" USING btree ("revoked_at") WHERE "publications"."revoked_at" is not null;--> statement-breakpoint
CREATE INDEX "reading_tickets_publication_idx" ON "reading_tickets" USING btree ("workspace_id","publication_id");--> statement-breakpoint
CREATE INDEX "reading_tickets_expiry_idx" ON "reading_tickets" USING btree ("expires_at");

--> statement-breakpoint

-- Published read-only links, from decision 0030, and the closed reader path of
-- decision 0031.
--
-- A link is a secret that opens one scope of one workspace. Three controls
-- hold it here:
--
--   * The stored value is a digest. The check constraints of both tables take
--     a SHA-256 in lower case hexadecimal and refuse every other shape, so a
--     raw token and a raw ticket cannot be at rest even by mistake.
--   * The policies below bind a link to the account that published it, so one
--     account never reads the links of another.
--   * The runtime role receives no DELETE right on either table and no UPDATE
--     right on a reading ticket, so a read cannot move a ticket expiry and
--     only the cleanup function below removes a record.
--
-- The reader has no account, so the reader transaction starts with no identity
-- and every policy here hides every row from it. `notesapp_publication_by_token`
-- is the one narrow answer that the token digest buys, and the unit of work
-- then sets the owner account of that link as the identity of the transaction.
ALTER TABLE public.publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publications FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
	EXECUTE format(
		'CREATE POLICY publications_owner_policy ON public.publications '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', current_user
	);
END
$$;
CREATE POLICY publications_member_policy ON public.publications
	FOR ALL TO notesapp_app
	USING (public.notesapp_is_member(workspace_id)
		AND owner_account_id = public.notesapp_current_account())
	WITH CHECK (public.notesapp_is_member(workspace_id)
		AND owner_account_id = public.notesapp_current_account());
GRANT SELECT, INSERT ON public.publications TO notesapp_app;
-- Revocation is the one change that the product makes to a link, so the
-- runtime role receives the update right of that one column. The token digest,
-- the scope, the password digest and the expiry are therefore fixed at the
-- database for every application statement, now and later.
GRANT UPDATE (revoked_at) ON public.publications TO notesapp_app;--> statement-breakpoint

ALTER TABLE public.reading_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_tickets FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
	EXECUTE format(
		'CREATE POLICY reading_tickets_owner_policy ON public.reading_tickets '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', current_user
	);
END
$$;
CREATE POLICY reading_tickets_member_policy ON public.reading_tickets
	FOR ALL TO notesapp_app
	USING (public.notesapp_is_member(workspace_id))
	WITH CHECK (public.notesapp_is_member(workspace_id));
-- No UPDATE right: a read never moves the expiry of a ticket, which is the
-- rule of decision 0030 held by the database and not by a habit of a caller.
GRANT SELECT, INSERT ON public.reading_tickets TO notesapp_app;--> statement-breakpoint

-- The one lookup of a published request.
--
-- The reader transaction holds no identity when it starts, so the policies
-- above hide every row from it. Knowing the digest of the token is what opens
-- this one row, and the function is SECURITY DEFINER for that reason alone. It
-- answers at most one row, because the digest column is unique.
--
-- The answer carries no secret. It states that a password guards the link and
-- never the password digest, and it never repeats the token digest, so the
-- reader path holds no value that could open a link a second time.
CREATE FUNCTION public.notesapp_publication_by_token(p_token_digest text)
	RETURNS TABLE (
		publication_id uuid,
		workspace_id uuid,
		owner_account_id uuid,
		scope_kind text,
		scope_file_id uuid,
		scope_path text,
		password_protected boolean,
		created_at timestamptz,
		expires_at timestamptz,
		revoked_at timestamptz
	)
	LANGUAGE plpgsql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		RETURN QUERY
		SELECT pub.id, pub.workspace_id, pub.owner_account_id,
			pub.scope_kind::text, pub.scope_file_id, pub.scope_path,
			pub.password_digest IS NOT NULL,
			pub.created_at, pub.expires_at, pub.revoked_at
		FROM public.publications pub
		WHERE pub.token_digest = p_token_digest;
	END;
	$$;
REVOKE ALL ON FUNCTION public.notesapp_publication_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notesapp_publication_by_token(text) TO notesapp_app;--> statement-breakpoint

-- Retention cleanup for published links and reading tickets.
--
-- A cleanup run carries no membership, and the runtime role holds no DELETE
-- right on either table, so the removal is a SECURITY DEFINER function as the
-- sync cleanup already is. Each of the three statements reads an index: the
-- two partial indexes of the link table and the expiry index of the ticket
-- table, so no run reads a live link.
--
-- A revoked link and an expired link both stop opening at once, because the
-- resolve rule reads the record on every request. This run only takes the dead
-- record away.
CREATE FUNCTION public.notesapp_cleanup_publications(p_cutoff timestamptz)
	RETURNS TABLE (
		expired_links bigint,
		expired_tickets bigint
	)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		v_links bigint := 0;
		v_expired bigint := 0;
		v_revoked bigint := 0;
		v_tickets bigint := 0;
	BEGIN
		DELETE FROM public.publications WHERE expires_at < p_cutoff;
		GET DIAGNOSTICS v_expired = ROW_COUNT;
		DELETE FROM public.publications WHERE revoked_at < p_cutoff;
		GET DIAGNOSTICS v_revoked = ROW_COUNT;
		v_links := v_expired + v_revoked;
		DELETE FROM public.reading_tickets WHERE expires_at < p_cutoff;
		GET DIAGNOSTICS v_tickets = ROW_COUNT;
		RETURN QUERY SELECT v_links, v_tickets;
	END;
	$$;
REVOKE ALL ON FUNCTION public.notesapp_cleanup_publications(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notesapp_cleanup_publications(timestamptz) TO notesapp_app;--> statement-breakpoint

-- `notesapp_discard_account` gains the published links of the account.
--
-- The function removes an account that has done nothing since it was created.
-- Publishing a link is something, and a folder link needs no file, so an
-- account with links and no notes reached the deletion before this line. The
-- rest of the body is unchanged.
CREATE OR REPLACE FUNCTION public.notesapp_discard_account(p_auth_user_id text)
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
		-- Only the account itself. A null identity is distinct from every
		-- account, so an identity free transaction is refused as well.
		IF public.notesapp_current_account() IS DISTINCT FROM target THEN
			RETURN false;
		END IF;
		-- The account must belong to nothing but its own personal workspace,
		-- and that workspace must be the only member of itself.
		IF EXISTS (
			SELECT 1 FROM public.memberships m
			JOIN public.workspaces w ON w.id = m.workspace_id
			WHERE m.account_id = target AND w.personal = false
		) THEN
			RETURN false;
		END IF;
		IF EXISTS (
			SELECT 1 FROM public.memberships other
			WHERE other.account_id <> target
				AND other.workspace_id IN (
					SELECT m.workspace_id FROM public.memberships m
					WHERE m.account_id = target
				)
		) THEN
			RETURN false;
		END IF;
		-- Every record that still names the account keeps it alive. Each of
		-- these is a foreign key to `accounts`, so removing the row would fail
		-- with a constraint violation rather than a usable answer. A published
		-- link names the account as well, and it is a door that the account
		-- opened, so it keeps the account alive too.
		IF EXISTS (SELECT 1 FROM public.revisions WHERE actor_account_id = target)
			OR EXISTS (SELECT 1 FROM public.changesets WHERE actor_account_id = target)
			OR EXISTS (SELECT 1 FROM public.mutation_receipts WHERE actor_account_id = target)
			OR EXISTS (SELECT 1 FROM public.snapshots WHERE account_id = target)
			OR EXISTS (SELECT 1 FROM public.publications WHERE owner_account_id = target)
		THEN
			RETURN false;
		END IF;
		-- The personal workspace must hold nothing. `contents` is checked on
		-- its own, because content can outlive the file that referenced it.
		IF EXISTS (
			SELECT 1 FROM public.memberships m
			WHERE m.account_id = target
				AND (
					EXISTS (SELECT 1 FROM public.files t WHERE t.workspace_id = m.workspace_id)
					OR EXISTS (SELECT 1 FROM public.contents t WHERE t.workspace_id = m.workspace_id)
					OR EXISTS (SELECT 1 FROM public.attachment_objects t WHERE t.workspace_id = m.workspace_id)
					OR EXISTS (SELECT 1 FROM public.revisions t WHERE t.workspace_id = m.workspace_id)
					OR EXISTS (SELECT 1 FROM public.changesets t WHERE t.workspace_id = m.workspace_id)
					OR EXISTS (SELECT 1 FROM public.mutation_receipts t WHERE t.workspace_id = m.workspace_id)
					OR EXISTS (SELECT 1 FROM public.live_paths t WHERE t.workspace_id = m.workspace_id)
					OR EXISTS (SELECT 1 FROM public.purge_markers t WHERE t.workspace_id = m.workspace_id)
					OR EXISTS (SELECT 1 FROM public.snapshots t WHERE t.workspace_id = m.workspace_id)
					OR EXISTS (SELECT 1 FROM public.search_index t WHERE t.workspace_id = m.workspace_id)
					OR EXISTS (SELECT 1 FROM public.publications t WHERE t.workspace_id = m.workspace_id)
				)
		) THEN
			RETURN false;
		END IF;
		PERFORM set_config('notesapp.purge', 'on', true);
		FOR victim IN
			SELECT m.workspace_id FROM public.memberships m
			WHERE m.account_id = target
		LOOP
			DELETE FROM public.sync_changes WHERE workspace_id = victim;
			DELETE FROM public.memberships WHERE workspace_id = victim;
			DELETE FROM public.workspace_cursors WHERE workspace_id = victim;
			DELETE FROM public.workspace_usage WHERE workspace_id = victim;
			DELETE FROM public.workspaces WHERE id = victim;
		END LOOP;
		-- These three belong to the account and to nothing else, so they are
		-- removed rather than treated as a reason to refuse.
		DELETE FROM public.account_audit_events WHERE account_id = target;
		DELETE FROM public.account_preferences WHERE account_id = target;
		DELETE FROM public.account_identities WHERE account_id = target;
		DELETE FROM public.accounts WHERE id = target;
		PERFORM set_config('notesapp.purge', 'off', true);
		RETURN true;
	END
	$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 5;
$$;
