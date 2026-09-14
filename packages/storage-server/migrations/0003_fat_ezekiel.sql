CREATE TABLE "note_links" (
	"workspace_id" uuid NOT NULL,
	"source_file_id" uuid NOT NULL,
	"source_revision_id" uuid NOT NULL,
	"source_path" text NOT NULL,
	"target_path" text NOT NULL,
	CONSTRAINT "note_links_workspace_id_source_file_id_target_path_pk" PRIMARY KEY("workspace_id","source_file_id","target_path")
);
--> statement-breakpoint
CREATE TABLE "portable_markdown_migration_report" (
	"workspace_id" uuid NOT NULL,
	"source_path" text NOT NULL,
	"reference" text NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portable_markdown_migration_report_workspace_id_source_path_reference_pk" PRIMARY KEY("workspace_id","source_path","reference")
);
--> statement-breakpoint
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_source_file_fk" FOREIGN KEY ("workspace_id","source_file_id") REFERENCES "public"."files"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_source_revision_fk" FOREIGN KEY ("workspace_id","source_revision_id") REFERENCES "public"."revisions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portable_markdown_migration_report" ADD CONSTRAINT "portable_markdown_migration_report_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_links_target_idx" ON "note_links" USING btree ("workspace_id","target_path");
--> statement-breakpoint

ALTER TABLE public.note_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_links FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY note_links_owner_policy ON public.note_links '
    'FOR ALL TO %I USING (true) WITH CHECK (true)', current_user
  );
END
$$;
CREATE POLICY note_links_member_policy ON public.note_links
  FOR ALL TO notesapp_app
  USING (public.notesapp_is_member(workspace_id))
  WITH CHECK (public.notesapp_is_member(workspace_id));
GRANT SELECT, INSERT, DELETE ON public.note_links TO notesapp_app;
--> statement-breakpoint

ALTER TABLE public.portable_markdown_migration_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portable_markdown_migration_report FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY portable_markdown_migration_report_owner_policy '
    'ON public.portable_markdown_migration_report '
    'FOR ALL TO %I USING (true) WITH CHECK (true)', current_user
  );
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 4;
$$;
