CREATE TABLE "template_settings" (
	"workspace_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"folder" text DEFAULT 'Templates' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_settings_workspace_id_account_id_pk" PRIMARY KEY("workspace_id","account_id"),
	CONSTRAINT "template_settings_folder_check" CHECK (char_length("template_settings"."folder") between 1 and 1024)
);
--> statement-breakpoint
ALTER TABLE "template_settings" ADD CONSTRAINT "template_settings_membership_fk" FOREIGN KEY ("workspace_id","account_id") REFERENCES "public"."memberships"("workspace_id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- The template settings of one member, from record 0149.
--
-- A row belongs to the account that wrote it, as a row of the daily note
-- settings of migration 0009 does. The policy binds every statement of the
-- runtime role to the account of the transaction and to a workspace that
-- account is a member of, so one member never reads or writes the settings of
-- another. The membership reference cascades, so neither a workspace deletion
-- nor a removed member leaves a row behind, and the delete function of
-- migration 0008 needs no new statement.
ALTER TABLE public.template_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_settings FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
	EXECUTE format(
		'CREATE POLICY template_settings_owner_policy ON public.template_settings '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', current_user
	);
END
$$;
CREATE POLICY template_settings_member_policy ON public.template_settings
	FOR ALL TO notesapp_app
	USING (public.notesapp_is_member(workspace_id)
		AND account_id = public.notesapp_current_account())
	WITH CHECK (public.notesapp_is_member(workspace_id)
		AND account_id = public.notesapp_current_account());
-- A member replaces their settings and never removes the row, so the runtime
-- role holds no DELETE right. The keys of a row are fixed once it is written.
GRANT SELECT, INSERT ON public.template_settings TO notesapp_app;
GRANT UPDATE (folder, updated_at) ON public.template_settings TO notesapp_app;
--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the twenty-seventh entry, so the function reports twenty-seven.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 27;
$$;
