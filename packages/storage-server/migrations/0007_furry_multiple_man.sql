CREATE TABLE "note_documents" (
	"workspace_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"epoch" integer DEFAULT 1 NOT NULL,
	"bytes" "bytea" NOT NULL,
	"state" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_documents_workspace_id_file_id_pk" PRIMARY KEY("workspace_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "document_update" "bytea";--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "document_vector" "bytea";--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "document_epoch" integer;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "merged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "note_documents" ADD CONSTRAINT "note_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_documents" ADD CONSTRAINT "note_documents_file_fk" FOREIGN KEY ("workspace_id","file_id") REFERENCES "public"."files"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The document of a note is workspace data, so it takes the same two row
-- policies as every other workspace scoped table: the schema owner sees all
-- rows, and the runtime role sees the workspaces of the account of the
-- transaction.
ALTER TABLE public.note_documents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.note_documents FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
	EXECUTE format(
		'CREATE POLICY note_documents_owner_policy ON public.note_documents '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
END $$;--> statement-breakpoint
CREATE POLICY note_documents_member_policy ON public.note_documents
  FOR ALL TO notesapp_app
  USING (public.notesapp_is_member(workspace_id))
  WITH CHECK (public.notesapp_is_member(workspace_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_documents TO notesapp_app;
