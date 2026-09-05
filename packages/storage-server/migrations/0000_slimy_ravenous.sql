CREATE TYPE "public"."attachment_state" AS ENUM('temporary', 'finalized', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."branch_state" AS ENUM('unresolved', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."content_kind" AS ENUM('markdown', 'attachment');--> statement-breakpoint
CREATE TYPE "public"."file_kind" AS ENUM('note', 'attachment');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."sync_entity_kind" AS ENUM('file', 'membership', 'share');--> statement-breakpoint
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
	CONSTRAINT "attachment_objects_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "attachment_objects_size_check" CHECK ("attachment_objects"."size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"actor_account_id" uuid,
	"action" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"base_revision_id" uuid,
	"tip_revision_id" uuid NOT NULL,
	"conflict_group_id" uuid NOT NULL,
	"state" "branch_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
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
CREATE TABLE "shares" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"pinned_revision_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"allowed_attachment_revision_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"creator_account_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shares_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "shares_token_key" UNIQUE("token_hash")
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment_objects" ADD CONSTRAINT "attachment_objects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_file_fk" FOREIGN KEY ("workspace_id","file_id") REFERENCES "public"."files"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_base_fk" FOREIGN KEY ("workspace_id","base_revision_id") REFERENCES "public"."revisions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tip_fk" FOREIGN KEY ("workspace_id","tip_revision_id") REFERENCES "public"."revisions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "shares" ADD CONSTRAINT "shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_creator_account_id_accounts_id_fk" FOREIGN KEY ("creator_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_file_fk" FOREIGN KEY ("workspace_id","file_id") REFERENCES "public"."files"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_revision_fk" FOREIGN KEY ("workspace_id","pinned_revision_id") REFERENCES "public"."revisions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_items" ADD CONSTRAINT "snapshot_items_token_hash_snapshots_token_hash_fk" FOREIGN KEY ("token_hash") REFERENCES "public"."snapshots"("token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_items" ADD CONSTRAINT "snapshot_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_items" ADD CONSTRAINT "snapshot_items_revision_fk" FOREIGN KEY ("workspace_id","revision_id") REFERENCES "public"."revisions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_cursors" ADD CONSTRAINT "workspace_cursors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_usage" ADD CONSTRAINT "workspace_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_objects_digest_idx" ON "attachment_objects" USING btree ("workspace_id","digest");--> statement-breakpoint
CREATE INDEX "audit_events_time_idx" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "branches_file_idx" ON "branches" USING btree ("workspace_id","file_id");--> statement-breakpoint
CREATE INDEX "branches_group_idx" ON "branches" USING btree ("workspace_id","conflict_group_id");--> statement-breakpoint
CREATE INDEX "files_live_idx" ON "files" USING btree ("workspace_id","deleted");--> statement-breakpoint
CREATE INDEX "link_index_target_idx" ON "link_index" USING btree ("workspace_id","target_file_id");--> statement-breakpoint
CREATE INDEX "memberships_account_idx" ON "memberships" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "revision_parents_parent_idx" ON "revision_parents" USING btree ("workspace_id","parent_id");--> statement-breakpoint
CREATE INDEX "revisions_file_idx" ON "revisions" USING btree ("workspace_id","file_id");--> statement-breakpoint
CREATE INDEX "revisions_changeset_idx" ON "revisions" USING btree ("workspace_id","changeset_id");--> statement-breakpoint
CREATE INDEX "revisions_restored_from_idx" ON "revisions" USING btree ("workspace_id","restored_from");--> statement-breakpoint
CREATE INDEX "shares_file_idx" ON "shares" USING btree ("workspace_id","file_id");--> statement-breakpoint
CREATE INDEX "snapshot_items_workspace_idx" ON "snapshot_items" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "snapshots_expiry_idx" ON "snapshots" USING btree ("workspace_id","expires_at");