CREATE TABLE "search_index" (
	"workspace_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"path" text NOT NULL,
	"search_text" text NOT NULL,
	CONSTRAINT "search_index_workspace_id_file_id_pk" PRIMARY KEY("workspace_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "search_index" ADD CONSTRAINT "search_index_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_index" ADD CONSTRAINT "search_index_file_fk" FOREIGN KEY ("workspace_id","file_id") REFERENCES "public"."files"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_index" ADD CONSTRAINT "search_index_revision_fk" FOREIGN KEY ("workspace_id","revision_id") REFERENCES "public"."revisions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_index_document_idx" ON "search_index" USING gin (to_tsvector('simple', "search_text"));--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_index TO notesapp_app;--> statement-breakpoint

ALTER TABLE public.search_index ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.search_index FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
DECLARE
	owner_role text := current_user;
BEGIN
	EXECUTE format(
		'CREATE POLICY search_index_owner_policy ON public.search_index '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', owner_role);
	EXECUTE
		'CREATE POLICY search_index_member_policy ON public.search_index '
		'FOR ALL TO notesapp_app '
		'USING (public.notesapp_is_member(workspace_id)) '
		'WITH CHECK (public.notesapp_is_member(workspace_id))';
END
$$;
