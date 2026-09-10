CREATE TYPE "public"."attachment_state" AS ENUM('temporary', 'finalized', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."content_kind" AS ENUM('markdown', 'attachment');--> statement-breakpoint
CREATE TYPE "public"."file_kind" AS ENUM('note', 'attachment');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner');--> statement-breakpoint
CREATE TYPE "public"."sync_entity_kind" AS ENUM('file', 'membership');--> statement-breakpoint
CREATE TABLE "account_audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_identities" (
	"auth_user_id" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_identities_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "account_preferences" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment_objects" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"digest" text NOT NULL,
	"size" bigint NOT NULL,
	"media_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"state" "attachment_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	"reclaimed_at" timestamp with time zone,
	CONSTRAINT "attachment_objects_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "attachment_objects_size_check" CHECK ("attachment_objects"."size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "attachment_reclaim_queue" (
	"workspace_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_reclaim_queue_pk" PRIMARY KEY("workspace_id","object_id")
);
--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_account_key" UNIQUE("issuer","provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "changesets" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"mutation_id" uuid NOT NULL,
	"actor_account_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"request_digest" text NOT NULL,
	"server_time" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"cursor" bigint NOT NULL,
	CONSTRAINT "changesets_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "changesets_mutation_key" UNIQUE("workspace_id","actor_account_id","mutation_id"),
	CONSTRAINT "changesets_cursor_key" UNIQUE("workspace_id","cursor")
);
--> statement-breakpoint
CREATE TABLE "contents" (
	"workspace_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"kind" "content_kind" NOT NULL,
	"size" bigint NOT NULL,
	"markdown" text,
	"object_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contents_workspace_id_digest_pk" PRIMARY KEY("workspace_id","digest"),
	CONSTRAINT "contents_body_check" CHECK (("contents"."kind" = 'markdown' and "contents"."markdown" is not null and "contents"."object_id" is null)
        or ("contents"."kind" = 'attachment' and "contents"."object_id" is not null and "contents"."markdown" is null)),
	CONSTRAINT "contents_size_check" CHECK ("contents"."size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "files" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"path" text NOT NULL,
	"kind" "file_kind" NOT NULL,
	"head_revision_id" uuid,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "link_index" (
	"workspace_id" uuid NOT NULL,
	"source_file_id" uuid NOT NULL,
	"source_revision_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"target_file_id" uuid,
	"source_text" text NOT NULL,
	CONSTRAINT "link_index_workspace_id_source_revision_id_ordinal_pk" PRIMARY KEY("workspace_id","source_revision_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "live_paths" (
	"workspace_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"path" text NOT NULL,
	CONSTRAINT "live_paths_workspace_id_file_id_pk" PRIMARY KEY("workspace_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_workspace_id_account_id_pk" PRIMARY KEY("workspace_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "mutation_receipts" (
	"workspace_id" uuid NOT NULL,
	"actor_account_id" uuid NOT NULL,
	"mutation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"outcome" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutation_receipts_workspace_id_actor_account_id_mutation_id_pk" PRIMARY KEY("workspace_id","actor_account_id","mutation_id")
);
--> statement-breakpoint
CREATE TABLE "purge_markers" (
	"workspace_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"purged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purge_markers_workspace_id_file_id_pk" PRIMARY KEY("workspace_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "revision_parents" (
	"workspace_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"parent_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "revision_parents_workspace_id_child_id_ordinal_pk" PRIMARY KEY("workspace_id","child_id","ordinal"),
	CONSTRAINT "revision_parents_edge_key" UNIQUE("workspace_id","child_id","parent_id"),
	CONSTRAINT "revision_parents_ordinal_check" CHECK ("revision_parents"."ordinal" >= 0),
	CONSTRAINT "revision_parents_self_check" CHECK ("revision_parents"."child_id" <> "revision_parents"."parent_id")
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"content_digest" text NOT NULL,
	"path" text NOT NULL,
	"deleted" boolean NOT NULL,
	"changeset_id" uuid NOT NULL,
	"actor_account_id" uuid NOT NULL,
	"client_time" timestamp with time zone NOT NULL,
	"server_time" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"message" text,
	"restored_from" uuid,
	CONSTRAINT "revisions_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "search_index" (
	"workspace_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"path" text NOT NULL,
	"search_text" text NOT NULL,
	CONSTRAINT "search_index_workspace_id_file_id_pk" PRIMARY KEY("workspace_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "snapshot_items" (
	"token_hash" text NOT NULL,
	"ordinal" integer NOT NULL,
	"workspace_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	CONSTRAINT "snapshot_items_token_hash_ordinal_pk" PRIMARY KEY("token_hash","ordinal")
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"cursor" bigint NOT NULL,
	"item_count" integer NOT NULL,
	"page_size" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_changes" (
	"workspace_id" uuid NOT NULL,
	"cursor" bigint NOT NULL,
	"entity_kind" "sync_entity_kind" NOT NULL,
	"entity_id" uuid NOT NULL,
	"revision_id" uuid,
	"deleted" boolean DEFAULT false NOT NULL,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_changes_workspace_id_cursor_entity_kind_entity_id_pk" PRIMARY KEY("workspace_id","cursor","entity_kind","entity_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_cursors" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"last_cursor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_usage" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"bytes_used" bigint NOT NULL,
	"quota_bytes" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"personal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_audit_events" ADD CONSTRAINT "account_audit_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_identities" ADD CONSTRAINT "account_identities_auth_user_id_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_identities" ADD CONSTRAINT "account_identities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_preferences" ADD CONSTRAINT "account_preferences_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_objects" ADD CONSTRAINT "attachment_objects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changesets" ADD CONSTRAINT "changesets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changesets" ADD CONSTRAINT "changesets_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."attachment_objects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_index" ADD CONSTRAINT "link_index_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_index" ADD CONSTRAINT "link_index_source_file_fk" FOREIGN KEY ("workspace_id","source_file_id") REFERENCES "public"."files"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_index" ADD CONSTRAINT "link_index_source_revision_fk" FOREIGN KEY ("workspace_id","source_revision_id") REFERENCES "public"."revisions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_paths" ADD CONSTRAINT "live_paths_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_paths" ADD CONSTRAINT "live_paths_file_fk" FOREIGN KEY ("workspace_id","file_id") REFERENCES "public"."files"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_receipts" ADD CONSTRAINT "mutation_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_receipts" ADD CONSTRAINT "mutation_receipts_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purge_markers" ADD CONSTRAINT "purge_markers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_parents" ADD CONSTRAINT "revision_parents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_parents" ADD CONSTRAINT "revision_parents_child_fk" FOREIGN KEY ("workspace_id","child_id") REFERENCES "public"."revisions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_parents" ADD CONSTRAINT "revision_parents_parent_fk" FOREIGN KEY ("workspace_id","parent_id") REFERENCES "public"."revisions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_file_fk" FOREIGN KEY ("workspace_id","file_id") REFERENCES "public"."files"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_content_fk" FOREIGN KEY ("workspace_id","content_digest") REFERENCES "public"."contents"("workspace_id","digest") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_changeset_fk" FOREIGN KEY ("workspace_id","changeset_id") REFERENCES "public"."changesets"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_restored_from_fk" FOREIGN KEY ("workspace_id","restored_from") REFERENCES "public"."revisions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_index" ADD CONSTRAINT "search_index_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_index" ADD CONSTRAINT "search_index_file_fk" FOREIGN KEY ("workspace_id","file_id") REFERENCES "public"."files"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_index" ADD CONSTRAINT "search_index_revision_fk" FOREIGN KEY ("workspace_id","revision_id") REFERENCES "public"."revisions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_items" ADD CONSTRAINT "snapshot_items_token_hash_snapshots_token_hash_fk" FOREIGN KEY ("token_hash") REFERENCES "public"."snapshots"("token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_items" ADD CONSTRAINT "snapshot_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_items" ADD CONSTRAINT "snapshot_items_revision_fk" FOREIGN KEY ("workspace_id","revision_id") REFERENCES "public"."revisions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_cursors" ADD CONSTRAINT "workspace_cursors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_usage" ADD CONSTRAINT "workspace_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_audit_events_account_idx" ON "account_audit_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "attachment_objects_digest_idx" ON "attachment_objects" USING btree ("workspace_id","digest");--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "files_live_idx" ON "files" USING btree ("workspace_id","deleted");--> statement-breakpoint
CREATE INDEX "link_index_target_idx" ON "link_index" USING btree ("workspace_id","target_file_id");--> statement-breakpoint
CREATE INDEX "memberships_account_idx" ON "memberships" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "revision_parents_parent_idx" ON "revision_parents" USING btree ("workspace_id","parent_id");--> statement-breakpoint
CREATE INDEX "revisions_file_idx" ON "revisions" USING btree ("workspace_id","file_id");--> statement-breakpoint
CREATE INDEX "revisions_changeset_idx" ON "revisions" USING btree ("workspace_id","changeset_id");--> statement-breakpoint
CREATE INDEX "revisions_restored_from_idx" ON "revisions" USING btree ("workspace_id","restored_from");--> statement-breakpoint
CREATE INDEX "search_index_document_idx" ON "search_index" USING gin (to_tsvector('simple', "search_text"));--> statement-breakpoint
CREATE INDEX "snapshot_items_workspace_idx" ON "snapshot_items" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "snapshots_expiry_idx" ON "snapshots" USING btree ("workspace_id","expires_at");
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Roles, rights, row level security, immutability, and the stored functions.
--
-- Drizzle cannot express these objects. Everything below this line is
-- handwritten, reviewed SQL. See docs/development/database.md for the design.
--
-- The role that runs this migration owns the schema and the database. It needs
-- CREATEROLE, because the statements below create the two application roles.
-- It must not be a superuser: FORCE row level security has no effect on a role
-- that can bypass it.
-- ---------------------------------------------------------------------------

-- The runtime role.
--
-- The CREATE ROLE defaults are already NOSUPERUSER, NOBYPASSRLS, NOCREATEDB,
-- NOCREATEROLE, and NOREPLICATION, so the statement sets no attribute that a
-- CREATEROLE role is not allowed to set. When the role already exists, because
-- another database of the same cluster created it, the migration only asserts
-- those attributes and refuses to continue when they are wrong.
DO $$
DECLARE
	existing pg_catalog.pg_roles%ROWTYPE;
BEGIN
	SELECT * INTO existing FROM pg_catalog.pg_roles WHERE rolname = 'notesapp_app';
	IF NOT FOUND THEN
		CREATE ROLE notesapp_app LOGIN NOINHERIT;
	ELSIF existing.rolsuper OR existing.rolbypassrls OR existing.rolreplication THEN
		RAISE EXCEPTION 'notesapp: the role notesapp_app must not be SUPERUSER, BYPASSRLS, or REPLICATION';
	END IF;
END
$$;--> statement-breakpoint

-- The identity role. It holds every right on the four Better Auth tables and
-- no right anywhere else, so the application cannot read a session token, a
-- password hash, a reset token, or a provider token. `migrate.ts` sets both
-- passwords, so no password is stored in a committed SQL file.
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

-- Only the schema owner may create objects, and only the two application roles
-- and the owner may connect. The REVOKE needs database ownership.
DO $$
BEGIN
	EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
	EXECUTE format('GRANT CONNECT ON DATABASE %I TO notesapp_app', current_database());
	EXECUTE format('GRANT CONNECT ON DATABASE %I TO notesapp_auth', current_database());
END
$$;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO notesapp_app;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO notesapp_auth;--> statement-breakpoint

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

-- The current role of the transaction identity, or null for a stranger. The
-- membership policies below use it, so a member cannot change membership.
CREATE FUNCTION public.notesapp_member_role(p_workspace_id uuid) RETURNS text
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT m.role::text
		FROM public.memberships m
		WHERE m.workspace_id = p_workspace_id
			AND m.account_id = public.notesapp_current_account()
	$$;--> statement-breakpoint

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

-- Cursor allocation.
--
-- The runtime role holds no UPDATE right on `workspace_cursors`, so it cannot
-- reset the commit order. This function is the only way to move the cursor, it
-- requires a membership, and it always moves the cursor forward by one.
CREATE FUNCTION public.notesapp_next_cursor(p_workspace_id uuid) RETURNS bigint
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		allocated bigint;
	BEGIN
		IF NOT public.notesapp_is_member(p_workspace_id) THEN
			RAISE EXCEPTION 'notesapp: the account is not a member of this workspace'
				USING ERRCODE = '42501';
		END IF;
		UPDATE public.workspace_cursors
		SET last_cursor = last_cursor + 1
		WHERE workspace_id = p_workspace_id
		RETURNING last_cursor INTO allocated;
		IF allocated IS NULL THEN
			RAISE EXCEPTION 'notesapp: the workspace has no cursor record'
				USING ERRCODE = '23503';
		END IF;
		RETURN allocated;
	END
	$$;--> statement-breakpoint

-- Usage accounting.
--
-- The runtime role holds no UPDATE right on `workspace_usage`, so it cannot
-- raise its own quota. This function changes the stored bytes only, requires a
-- membership, and only ever adds. A member that could subtract would zero the
-- stored bytes and then write past the quota without limit. The owner only
-- purge function below lowers the stored bytes.
CREATE FUNCTION public.notesapp_add_usage(p_workspace_id uuid, p_delta bigint)
	RETURNS bigint
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		updated bigint;
	BEGIN
		IF NOT public.notesapp_is_member(p_workspace_id) THEN
			RAISE EXCEPTION 'notesapp: the account is not a member of this workspace'
				USING ERRCODE = '42501';
		END IF;
		IF p_delta < 0 THEN
			RAISE EXCEPTION 'notesapp: workspace usage cannot be reduced through this path'
				USING ERRCODE = '23514';
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

-- A workspace always keeps an owner.
--
-- The guard is the database side of the last owner rule. A policy sees one row
-- at a time and cannot count the remaining owners, so the rule needs a
-- trigger. Workspace deletion sets `notesapp.purge`, exactly like the
-- immutability trigger, because it removes the whole workspace.
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

-- Accepted path uniqueness. A partial unique index cannot be deferred, so the
-- accepted paths live in their own table and the constraint is deferred to the
-- end of the transaction. Two files can therefore swap paths in one changeset.
-- A file holds a row here only while it is live, so a deleted file occupies no
-- accepted path.
ALTER TABLE public.live_paths
	ADD CONSTRAINT live_paths_path_key UNIQUE (workspace_id, path) DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- The accepted head of a file must be a revision of the same workspace. The
-- constraint is deferred, because a changeset writes revisions and advances
-- heads in the same transaction.
ALTER TABLE public.files
	ADD CONSTRAINT files_head_revision_fk FOREIGN KEY (workspace_id, head_revision_id)
	REFERENCES public.revisions (workspace_id, id) DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- Table rights of the runtime role.
--
-- An immutable table gets SELECT and INSERT only. `workspace_usage` and
-- `workspace_cursors` get SELECT only, because the two SECURITY DEFINER
-- functions above are the only permitted way to change them. The runtime role
-- holds no right at all on the four Better Auth tables, on
-- `account_identities`, and on `attachment_reclaim_queue`.
GRANT SELECT ON public.accounts TO notesapp_app;--> statement-breakpoint
GRANT SELECT, UPDATE ON public.workspaces TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships TO notesapp_app;--> statement-breakpoint
GRANT SELECT ON public.workspace_usage TO notesapp_app;--> statement-breakpoint
GRANT SELECT ON public.workspace_cursors TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.files TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_paths TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.contents TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.revisions TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.revision_parents TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.changesets TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.mutation_receipts TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.purge_markers TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.sync_changes TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.snapshots TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.snapshot_items TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.link_index TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_index TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.attachment_objects TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.account_preferences TO notesapp_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.account_audit_events TO notesapp_app;--> statement-breakpoint

-- Table rights of the identity role. The four Better Auth tables and nothing
-- else.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_user TO notesapp_auth;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_session TO notesapp_auth;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_account TO notesapp_auth;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_verification TO notesapp_auth;--> statement-breakpoint

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
		'workspace_usage', 'workspace_cursors', 'files',
		'live_paths', 'contents', 'revisions', 'revision_parents', 'changesets',
		'purge_markers', 'sync_changes', 'snapshots', 'snapshot_items',
		'link_index', 'search_index', 'attachment_objects'
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

	-- The reclaim queue outlives the workspace whose bytes it names, so it has
	-- no workspace to scope it. Only the SECURITY DEFINER reclaim functions
	-- reach it, and the runtime role holds no right on it at all.
	EXECUTE 'ALTER TABLE public.attachment_reclaim_queue ENABLE ROW LEVEL SECURITY';
	EXECUTE 'ALTER TABLE public.attachment_reclaim_queue FORCE ROW LEVEL SECURITY';
	EXECUTE format(
		'CREATE POLICY attachment_reclaim_queue_owner_policy '
		'ON public.attachment_reclaim_queue FOR ALL TO %I '
		'USING (true) WITH CHECK (true)', owner_role);

	-- Membership. Every member reads the list, and only an owner changes it,
	-- never their own row.
	EXECUTE 'ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY';
	EXECUTE 'ALTER TABLE public.memberships FORCE ROW LEVEL SECURITY';
	EXECUTE format(
		'CREATE POLICY memberships_owner_policy ON public.memberships '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', owner_role);
	EXECUTE
		'CREATE POLICY memberships_read_policy ON public.memberships '
		'FOR SELECT TO notesapp_app '
		'USING (public.notesapp_is_member(workspace_id))';
	EXECUTE
		'CREATE POLICY memberships_insert_policy ON public.memberships '
		'FOR INSERT TO notesapp_app '
		'WITH CHECK (public.notesapp_member_role(workspace_id) = ''owner'' '
		'  AND account_id <> public.notesapp_current_account())';
	EXECUTE
		'CREATE POLICY memberships_update_policy ON public.memberships '
		'FOR UPDATE TO notesapp_app '
		'USING (public.notesapp_member_role(workspace_id) = ''owner'' '
		'  AND account_id <> public.notesapp_current_account()) '
		'WITH CHECK (public.notesapp_member_role(workspace_id) = ''owner'' '
		'  AND account_id <> public.notesapp_current_account())';
	EXECUTE
		'CREATE POLICY memberships_delete_policy ON public.memberships '
		'FOR DELETE TO notesapp_app '
		'USING (public.notesapp_member_role(workspace_id) = ''owner'' '
		'  AND account_id <> public.notesapp_current_account())';

	-- A workspace row is visible to its members. Only an owner can change it.
	EXECUTE 'ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY';
	EXECUTE 'ALTER TABLE public.workspaces FORCE ROW LEVEL SECURITY';
	EXECUTE format(
		'CREATE POLICY workspaces_owner_policy ON public.workspaces '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', owner_role);
	EXECUTE
		'CREATE POLICY workspaces_read_policy ON public.workspaces '
		'FOR SELECT TO notesapp_app '
		'USING (public.notesapp_is_member(id))';
	EXECUTE
		'CREATE POLICY workspaces_update_policy ON public.workspaces '
		'FOR UPDATE TO notesapp_app '
		'USING (public.notesapp_member_role(id) = ''owner'') '
		'WITH CHECK (public.notesapp_member_role(id) = ''owner'')';

	-- An account row is visible to the account itself and to every co-member.
	-- Nothing creates a second member now, so it shows the account's own row.
	EXECUTE 'ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY';
	EXECUTE 'ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY';
	EXECUTE format(
		'CREATE POLICY accounts_owner_policy ON public.accounts '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', owner_role);
	EXECUTE
		'CREATE POLICY accounts_member_policy ON public.accounts '
		'FOR SELECT TO notesapp_app '
		'USING (public.notesapp_shares_workspace_with(id))';

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
	-- holds no right on it: it learns an account through `notesapp_account_of`,
	-- which returns one narrow answer.
	EXECUTE 'ALTER TABLE public.account_identities ENABLE ROW LEVEL SECURITY';
	EXECUTE 'ALTER TABLE public.account_identities FORCE ROW LEVEL SECURITY';
	EXECUTE format(
		'CREATE POLICY account_identities_owner_policy ON public.account_identities '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', owner_role);

	-- The account audit trail belongs to one account and to nobody else. It is
	-- append only for the runtime role.
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
END
$$;--> statement-breakpoint

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

-- Whether this installation already has an account. The setup path refuses to
-- run a second time on the strength of this answer.
CREATE FUNCTION public.notesapp_has_account() RETURNS boolean
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT EXISTS (SELECT 1 FROM public.account_identities)
	$$;--> statement-breakpoint

-- Removes an account that a sign-up attempt created and never used.
--
-- The function is bound to the calling account: it refuses every account that
-- is not the identity of the transaction, so one account can never remove
-- another. It also refuses every account that any retained record still names,
-- and every account whose personal workspace holds anything at all. It
-- therefore removes only an account that has done nothing since it was
-- created, and it answers false rather than failing on a row it may not
-- remove.
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
		-- with a constraint violation rather than a usable answer.
		IF EXISTS (SELECT 1 FROM public.revisions WHERE actor_account_id = target)
			OR EXISTS (SELECT 1 FROM public.changesets WHERE actor_account_id = target)
			OR EXISTS (SELECT 1 FROM public.mutation_receipts WHERE actor_account_id = target)
			OR EXISTS (SELECT 1 FROM public.snapshots WHERE account_id = target)
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
					OR EXISTS (SELECT 1 FROM public.link_index t WHERE t.workspace_id = m.workspace_id)
					OR EXISTS (SELECT 1 FROM public.search_index t WHERE t.workspace_id = m.workspace_id)
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

-- Removes a workspace and every record that belongs to it.
--
-- Only an owner may call it. The immutable content tables are cleared with the
-- purge setting above, because the workspace itself disappears. The deletion
-- removes the attachment rows, so it copies their digests into
-- `attachment_reclaim_queue` first. The background reclaim stays the only code
-- that deletes attachment bytes.
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
		DELETE FROM public.search_index WHERE workspace_id = p_workspace_id;
		DELETE FROM public.link_index WHERE workspace_id = p_workspace_id;
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

-- Lists the attachment objects whose bytes the reclaim may take. An object
-- that a purge marked unavailable is included, so the bytes of a permanently
-- deleted note do not stay on disk forever. `reclaimed_at` marks a row whose
-- bytes an earlier run already handled.
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

-- Whether any content row still names one attachment object.
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

-- The mark claims one row for one reclaim run. `reclaimed_at` records that
-- the bytes of the row were handled, so the row is never claimed again.
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
		SET state = 'unavailable', reclaimed_at = clock_timestamp()
		WHERE workspace_id = p_workspace_id AND id = p_id
		  AND reclaimed_at IS NULL;
		GET DIAGNOSTICS v_updated = ROW_COUNT;
		RETURN v_updated;
	END;
	$$;--> statement-breakpoint

-- Whether another live object of the workspace still needs the shared file of
-- one digest.
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
-- The function never touches revisions, contents, receipts, or purge markers,
-- so saved history stays valid beyond the event window.
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

-- Index-backed search behind one membership check.
--
-- Row level security protects the table for ordinary access. Its policy is a
-- security barrier, so PostgreSQL cannot use the functional GIN index before
-- it evaluates membership for each candidate row. This function checks the
-- transaction identity once, then searches as the schema owner. The owner is
-- still subject to FORCE ROW LEVEL SECURITY and has an explicit true policy.
CREATE FUNCTION public.notesapp_search(
  p_workspace_id uuid,
  p_query text,
  p_limit integer
)
RETURNS TABLE (
  file_id uuid,
  path text,
  revision_id uuid,
  excerpt text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  needle tsquery;
BEGIN
  IF NOT public.notesapp_is_member(p_workspace_id) THEN
    RETURN;
  END IF;
  IF btrim(p_query) = '' THEN
    RETURN;
  END IF;
  needle := websearch_to_tsquery('simple', p_query);

  RETURN QUERY
    WITH matches AS MATERIALIZED (
      SELECT indexed.file_id,
             indexed.path,
             indexed.revision_id,
             indexed.search_text
        FROM public.search_index indexed
       WHERE indexed.workspace_id = p_workspace_id
         AND to_tsvector('simple', indexed.search_text) @@ needle
       ORDER BY indexed.path, indexed.file_id
       LIMIT least(greatest(coalesce(p_limit, 1), 1), 100)
    )
    SELECT matches.file_id,
           matches.path,
           matches.revision_id,
           left(matches.search_text, 1024) AS excerpt
      FROM matches;
END
$$;--> statement-breakpoint

-- Preview of an owner file purge.
--
-- It reports what the purge would remove and every reference that blocks it.
-- An attachment object that a revision outside the purge set still names is
-- the only blocking reference now.
CREATE FUNCTION public.notesapp_preview_purge(
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

-- Owner file purge.
--
-- It permanently removes the named files, their revisions, and the content
-- that no revision names any more. It bypasses the immutability triggers with
-- the purge setting and writes a purge marker for every file, so a late
-- offline write cannot recreate the identifier.
--
-- The function also removes the snapshot items that pin a purged revision.
-- A snapshot item carries a foreign key to `revisions`, so the delete has to
-- happen here and not in one caller: a second caller would otherwise hit a
-- foreign key violation. The snapshot then fails its item count check and its
-- readers restart with a fresh one.
--
-- A `temporary` attachment object belongs to an upload that is still in
-- flight, and an object that was finalized inside the reclaim window is
-- between its finalize call and the commit that references it. Neither is
-- dead, so a purge leaves both alone and the background reclaim decides about
-- them later.
CREATE FUNCTION public.notesapp_purge_files(
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

	PERFORM set_config('notesapp.purge', 'on', true);

	DELETE FROM public.search_index
	WHERE workspace_id = p_workspace_id AND file_id = ANY(p_file_ids);

	DELETE FROM public.link_index
	WHERE workspace_id = p_workspace_id
	  AND (source_file_id = ANY(p_file_ids) OR target_file_id = ANY(p_file_ids));

	-- A live snapshot may pin a revision that this purge removes. Its items go
	-- first, so the foreign key to `revisions` holds.
	DELETE FROM public.snapshot_items
	WHERE workspace_id = p_workspace_id
	  AND revision_id = ANY(v_purged_revision_ids);

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

	-- Find unreferenced attachment objects that are safe to mark
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

-- Runtime-visible deployment schema version.
--
-- The application role cannot read Drizzle's private migration table. This
-- narrow function proves that the complete reviewed migration set applied.
-- The number is the count of entries in `migrations/meta/_journal.json`, and
-- `requiredSchemaVersion` in `src/migrate.ts` is the value that the readiness
-- probe compares it with.
CREATE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 1;
$$;--> statement-breakpoint

-- Function rights. Every function is taken away from PUBLIC first, then given
-- to the runtime role only where the application calls it. `notesapp_auth`
-- receives none of them.
REVOKE ALL ON FUNCTION public.notesapp_current_account() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_is_member(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_member_role(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_shares_workspace_with(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_next_cursor(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_add_usage(uuid, bigint) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_link_account(text, uuid, uuid, text, bigint) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_create_workspace(uuid, text, bigint) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_account_of(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_has_account() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_discard_account(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_delete_workspace(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_reclaim_attachments(timestamptz) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_has_attachment_content_ref(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_mark_attachment_unavailable(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_is_attachment_digest_used(uuid, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_take_attachment_reclaim(integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_cleanup_sync(timestamptz, timestamptz) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_search(uuid, text, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_preview_purge(uuid, uuid[]) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_purge_files(uuid, uuid[]) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_schema_version() FROM PUBLIC;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.notesapp_current_account() TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_is_member(uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_member_role(uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_shares_workspace_with(uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_next_cursor(uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_add_usage(uuid, bigint) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_link_account(text, uuid, uuid, text, bigint) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_create_workspace(uuid, text, bigint) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_account_of(text) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_has_account() TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_discard_account(text) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_delete_workspace(uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_reclaim_attachments(timestamptz) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_has_attachment_content_ref(uuid, uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_mark_attachment_unavailable(uuid, uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_is_attachment_digest_used(uuid, text) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_take_attachment_reclaim(integer) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_cleanup_sync(timestamptz, timestamptz) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_search(uuid, text, integer) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_preview_purge(uuid, uuid[]) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_purge_files(uuid, uuid[]) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_schema_version() TO notesapp_app;
