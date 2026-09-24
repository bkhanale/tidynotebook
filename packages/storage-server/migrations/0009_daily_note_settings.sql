CREATE TABLE "daily_note_settings" (
	"workspace_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"template_file_id" uuid,
	"open_on_start" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_note_settings_workspace_id_account_id_pk" PRIMARY KEY("workspace_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "daily_note_settings" ADD CONSTRAINT "daily_note_settings_membership_fk" FOREIGN KEY ("workspace_id","account_id") REFERENCES "public"."memberships"("workspace_id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_note_settings" ADD CONSTRAINT "daily_note_settings_template_fk" FOREIGN KEY ("workspace_id","template_file_id") REFERENCES "public"."files"("workspace_id","id") ON DELETE SET NULL ("template_file_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_note_settings_template_idx" ON "daily_note_settings" USING btree ("workspace_id","template_file_id");;--> statement-breakpoint

-- The daily note settings of one member, from record 0099.
--
-- The template reference of the generated statement above names the one
-- column that a purge of the template clears. Drizzle writes `set null` over
-- the whole reference, which would clear `workspace_id` as well and make every
-- purge of a template fail on its not null constraint.
--
-- A row belongs to the account that wrote it. The policy binds every statement
-- of the runtime role to the account of the transaction and to a workspace
-- that account is a member of, so one member never reads or writes the
-- settings of another. The membership reference cascades, so neither a
-- workspace deletion nor a removed member leaves a row behind, and the delete
-- function of migration 0008 needs no new statement.
ALTER TABLE public.daily_note_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_note_settings FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
	EXECUTE format(
		'CREATE POLICY daily_note_settings_owner_policy ON public.daily_note_settings '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', current_user
	);
END
$$;
CREATE POLICY daily_note_settings_member_policy ON public.daily_note_settings
	FOR ALL TO notesapp_app
	USING (public.notesapp_is_member(workspace_id)
		AND account_id = public.notesapp_current_account())
	WITH CHECK (public.notesapp_is_member(workspace_id)
		AND account_id = public.notesapp_current_account());
-- A member replaces their settings and never removes the row, so the runtime
-- role holds no DELETE right. The keys of a row are fixed once it is written.
GRANT SELECT, INSERT ON public.daily_note_settings TO notesapp_app;
GRANT UPDATE (template_file_id, open_on_start, updated_at)
	ON public.daily_note_settings TO notesapp_app;--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the tenth entry, so the function reports ten.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 10;
$$;
