CREATE TABLE "workspace_welcome_notes" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"completed_at" timestamp with time zone,
	"failure_code" text
);
--> statement-breakpoint
ALTER TABLE "workspace_welcome_notes" ADD CONSTRAINT "workspace_welcome_notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE public.workspace_welcome_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspace_welcome_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('CREATE POLICY workspace_welcome_notes_schema_owner ON public.workspace_welcome_notes FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
END $$;
--> statement-breakpoint
CREATE POLICY workspace_welcome_notes_account_owner ON public.workspace_welcome_notes
  FOR ALL TO notesapp_app
  USING (public.notesapp_workspace_owner(workspace_id) = public.notesapp_current_account())
  WITH CHECK (public.notesapp_workspace_owner(workspace_id) = public.notesapp_current_account());
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.workspace_welcome_notes TO notesapp_app;
--> statement-breakpoint
CREATE TRIGGER workspace_welcome_notes_locked_guard
  BEFORE UPDATE ON public.workspace_welcome_notes FOR EACH ROW
  EXECUTE FUNCTION public.notesapp_guard_locked_write('workspace_id', 'workspace');
--> statement-breakpoint
-- Registration creates the personal workspace in its own transaction. The
-- trigger records pending work even when the new account starts locked.
CREATE FUNCTION public.notesapp_pending_welcome_note() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.personal THEN
    INSERT INTO public.workspace_welcome_notes(workspace_id) VALUES (NEW.id);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_pending_welcome_note() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER workspaces_pending_welcome_note
  AFTER INSERT ON public.workspaces FOR EACH ROW
  EXECUTE FUNCTION public.notesapp_pending_welcome_note();
--> statement-breakpoint
-- Production switched to locked registration on 2026-10-22 (cloud deploy
-- bd521f611202a39b96e59937052f059c69107c25, completed 16:52:32 UTC).
-- Only enabled accounts created on or after that UTC date, with zero stored
-- bytes across every owned workspace and no welcome note record, qualify.
-- Deleted and renamed notes count as records. A purge marker excludes an
-- account because its original note path can no longer be proved absent.
INSERT INTO public.workspace_welcome_notes(workspace_id)
SELECT w.id
FROM public.accounts a
JOIN public.memberships m ON m.account_id = a.id AND m.role = 'owner'
JOIN public.workspaces w ON w.id = m.workspace_id AND w.personal
WHERE a.created_at >= timestamptz '2026-10-22 00:00:00+00'
  AND a.state = 'enabled' AND a.removed_at IS NULL
  AND (SELECT coalesce(sum(u.bytes_used), 0)
       FROM public.memberships owned
       JOIN public.workspace_usage u ON u.workspace_id = owned.workspace_id
       WHERE owned.account_id = a.id AND owned.role = 'owner') = 0
  AND NOT EXISTS (SELECT 1 FROM public.workspace_welcome_notes n WHERE n.workspace_id = w.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.files f
    JOIN public.memberships owned ON owned.workspace_id = f.workspace_id
    WHERE owned.account_id = a.id AND owned.role = 'owner'
      AND f.path = 'Welcome to tidy notebook.md')
  AND NOT EXISTS (
    SELECT 1 FROM public.revisions r
    JOIN public.memberships owned ON owned.workspace_id = r.workspace_id
    WHERE owned.account_id = a.id AND owned.role = 'owner'
      AND r.path = 'Welcome to tidy notebook.md')
  AND NOT EXISTS (
    SELECT 1 FROM public.purge_markers p
    JOIN public.memberships owned ON owned.workspace_id = p.workspace_id
    WHERE owned.account_id = a.id AND owned.role = 'owner')
ON CONFLICT (workspace_id) DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notesapp_schema_version() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT 41; $$;
