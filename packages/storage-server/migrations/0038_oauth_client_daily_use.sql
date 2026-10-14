-- Handwritten SQL. The shared client needs one last-use write per day.
CREATE OR REPLACE FUNCTION public.notesapp_oauth_token_identity(p_digest text, p_resource text)
RETURNS TABLE(account_id uuid, auth_user_id text, standing public.account_standing, grant_id text, scopes text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE token public.auth_oauth_access_token%ROWTYPE;
BEGIN
  SELECT t.* INTO token FROM public.auth_oauth_access_token t WHERE t.token = p_digest;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM public.notesapp_oauth_lock_pair(token.client_id, token.user_id);
  RETURN QUERY WITH usable AS (
    SELECT t.* FROM public.auth_oauth_access_token t JOIN public.auth_oauth_client c ON c.client_id = t.client_id
    WHERE t.id = token.id AND t.revoked IS NULL AND t.expires_at > clock_timestamp()
      AND t.resources = ARRAY[p_resource] AND c.disabled IS NOT TRUE
  ), used AS (
    UPDATE public.auth_oauth_client c SET last_used_at = clock_timestamp() FROM usable t WHERE c.client_id = t.client_id
      AND (c.last_used_at IS NULL OR c.last_used_at < now() - interval '1 day')
  ) SELECT a.id, ai.auth_user_id, a.standing, c.id, ARRAY(SELECT scope FROM unnest(t.scopes) AS scope WHERE scope = ANY(c.scopes))
    FROM usable t JOIN public.auth_oauth_consent c ON c.client_id = t.client_id AND c.user_id = t.user_id
    JOIN public.account_identities ai ON ai.auth_user_id = t.user_id
    JOIN public.accounts a ON a.id = ai.account_id WHERE a.state = 'enabled' AND a.removed_at IS NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notesapp_schema_version() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT 39; $$;
