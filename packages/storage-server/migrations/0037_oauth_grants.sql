ALTER TABLE "auth_oauth_consent" ADD CONSTRAINT "auth_oauth_consent_pair" UNIQUE("client_id","user_id");
--> statement-breakpoint

CREATE FUNCTION public.notesapp_oauth_grant_allowed(p_client text, p_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.notesapp_oauth_issue_allowed(p_user) AND EXISTS (
    SELECT 1 FROM public.auth_oauth_consent WHERE client_id = p_client AND user_id = p_user);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_oauth_grant_allowed(text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_oauth_grant_allowed(text,text) TO notesapp_auth;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notesapp_schema_version() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT 38; $$;
