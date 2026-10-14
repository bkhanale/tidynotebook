ALTER TABLE "auth_oauth_consent" ADD COLUMN "last_used_at" timestamp with time zone;
--> statement-breakpoint
-- Handwritten SQL. Grant bounds, last use and account controls.
-- One new consent consumes one slot. The account lock serializes all pairs.
CREATE FUNCTION public.notesapp_bound_oauth_grants() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.notesapp_oauth_lock_pair(NEW.client_id, NEW.user_id);
  IF NOT EXISTS (SELECT 1 FROM public.auth_oauth_consent WHERE client_id = NEW.client_id AND user_id = NEW.user_id)
    AND (SELECT count(*) FROM public.auth_oauth_consent WHERE user_id = NEW.user_id) >= 25 THEN
    RAISE EXCEPTION 'oauth_grant_limit' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER oauth_grant_bound BEFORE INSERT ON public.auth_oauth_consent
FOR EACH ROW EXECUTE FUNCTION public.notesapp_bound_oauth_grants();
--> statement-breakpoint
-- Token issue can update last use for a locked account. It gives no new access.
CREATE OR REPLACE FUNCTION public.notesapp_guard_oauth_consent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.notesapp_oauth_lock_pair(OLD.client_id, OLD.user_id);
    DELETE FROM public.auth_oauth_access_token WHERE client_id = OLD.client_id AND user_id = OLD.user_id;
    DELETE FROM public.auth_oauth_refresh_token WHERE client_id = OLD.client_id AND user_id = OLD.user_id;
    DELETE FROM public.auth_verification WHERE value LIKE '{%' AND (CASE WHEN value IS JSON OBJECT THEN value::jsonb END)->>'type' = 'authorization_code'
      AND (CASE WHEN value IS JSON OBJECT THEN value::jsonb END)->'query'->>'client_id' = OLD.client_id AND (CASE WHEN value IS JSON OBJECT THEN value::jsonb END)->>'userId' = OLD.user_id;
    RETURN OLD;
  END IF;
  PERFORM public.notesapp_oauth_lock_pair(NEW.client_id, NEW.user_id);
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'last_used_at') = (to_jsonb(OLD) - 'last_used_at') THEN
    RETURN NEW;
  END IF;
  IF NOT public.notesapp_oauth_consent_allowed(NEW.user_id) THEN
    RAISE EXCEPTION 'notesapp: OAuth consent is refused' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.notesapp_oauth_grant_used() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.notesapp_oauth_pair_held(NEW.client_id, NEW.user_id) THEN
    RAISE EXCEPTION 'notesapp: token issue needs its pair lock' USING ERRCODE = '42501';
  END IF;
  UPDATE public.auth_oauth_consent SET last_used_at = clock_timestamp()
    WHERE client_id = NEW.client_id AND user_id = NEW.user_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER oauth_grant_used AFTER INSERT ON public.auth_oauth_access_token
FOR EACH ROW EXECUTE FUNCTION public.notesapp_oauth_grant_used();
--> statement-breakpoint
CREATE FUNCTION public.notesapp_account_connected_apps()
RETURNS TABLE(grant_id text, client_id text, client_name text, scopes text[], last_used_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT c.id, c.client_id, cl.name,
    ARRAY(SELECT DISTINCT scope FROM unnest(c.scopes) AS scope WHERE scope IN ('notes:read','notes:write') ORDER BY scope),
    c.last_used_at
  FROM public.auth_oauth_consent c
  JOIN public.auth_oauth_client cl ON cl.client_id = c.client_id
  JOIN public.account_identities ai ON ai.auth_user_id = c.user_id
  JOIN public.accounts a ON a.id = ai.account_id
  WHERE a.id = public.notesapp_current_account() AND a.state = 'enabled' AND a.removed_at IS NULL
  ORDER BY c.created_at DESC, c.id;
$$;
--> statement-breakpoint
CREATE FUNCTION public.notesapp_revoke_connected_app(p_grant text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE account uuid := public.notesapp_current_account(); u text; c text;
BEGIN
  IF account IS NULL THEN RETURN false; END IF;
  PERFORM set_config('lock_timeout', '2000ms', true);
  PERFORM set_config('statement_timeout', '5000ms', true);
  PERFORM public.notesapp_lock_account(account);
  SELECT ai.auth_user_id INTO u FROM public.account_identities ai JOIN public.accounts a ON a.id = ai.account_id
    WHERE a.id = account AND a.state = 'enabled' AND a.removed_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT client_id INTO c FROM public.auth_oauth_consent WHERE id = p_grant AND user_id = u;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.notesapp_oauth_lock_pair(c, u);
  DELETE FROM public.auth_oauth_consent WHERE id = p_grant AND user_id = u;
  RETURN FOUND;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_bound_oauth_grants(), public.notesapp_oauth_grant_used(),
  public.notesapp_account_connected_apps(), public.notesapp_revoke_connected_app(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_account_connected_apps(), public.notesapp_revoke_connected_app(text) TO notesapp_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notesapp_schema_version() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT 40; $$;
