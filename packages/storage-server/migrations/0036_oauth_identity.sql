CREATE TABLE "auth_oauth_access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"refresh_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked" timestamp with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "auth_oauth_access_token_token_unique" UNIQUE("token"),
	CONSTRAINT "auth_oauth_access_token_digest" CHECK ("auth_oauth_access_token"."token" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"client_credentials_scopes" text[] DEFAULT '{}',
	"user_id" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" text[],
	"response_types" text[],
	"require_pkce" boolean,
	"dpop_bound_access_tokens" boolean DEFAULT false,
	"reference_id" text,
	"metadata" jsonb,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "auth_oauth_client_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_client_assertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_client_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone,
	CONSTRAINT "auth_oauth_client_resource_pair" UNIQUE("client_id","resource_id")
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_refresh_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp with time zone,
	"auth_time" timestamp with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "auth_oauth_refresh_token_token_unique" UNIQUE("token"),
	CONSTRAINT "auth_oauth_refresh_token_digest" CHECK ("auth_oauth_refresh_token"."token" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb,
	CONSTRAINT "auth_oauth_resource_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
ALTER TABLE "auth_oauth_access_token" ADD CONSTRAINT "auth_oauth_access_token_client_id_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."auth_oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_access_token" ADD CONSTRAINT "auth_oauth_access_token_session_id_auth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_access_token" ADD CONSTRAINT "auth_oauth_access_token_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_access_token" ADD CONSTRAINT "auth_oauth_access_token_refresh_id_auth_oauth_refresh_token_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."auth_oauth_refresh_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_client" ADD CONSTRAINT "auth_oauth_client_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_client_resource" ADD CONSTRAINT "auth_oauth_client_resource_client_id_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."auth_oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_client_resource" ADD CONSTRAINT "auth_oauth_client_resource_resource_id_auth_oauth_resource_identifier_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."auth_oauth_resource"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_consent" ADD CONSTRAINT "auth_oauth_consent_client_id_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."auth_oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_consent" ADD CONSTRAINT "auth_oauth_consent_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_refresh_token" ADD CONSTRAINT "auth_oauth_refresh_token_client_id_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."auth_oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_refresh_token" ADD CONSTRAINT "auth_oauth_refresh_token_session_id_auth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_refresh_token" ADD CONSTRAINT "auth_oauth_refresh_token_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_client_id_idx" ON "auth_oauth_access_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_session_id_idx" ON "auth_oauth_access_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_user_id_idx" ON "auth_oauth_access_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_authorization_code_id_idx" ON "auth_oauth_access_token" USING btree ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_refresh_id_idx" ON "auth_oauth_access_token" USING btree ("refresh_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_client_user_id_idx" ON "auth_oauth_client" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_client_resource_client_id_idx" ON "auth_oauth_client_resource" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_client_resource_resource_id_idx" ON "auth_oauth_client_resource" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_consent_client_id_idx" ON "auth_oauth_consent" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_consent_user_id_idx" ON "auth_oauth_consent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_refresh_token_client_id_idx" ON "auth_oauth_refresh_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_refresh_token_session_id_idx" ON "auth_oauth_refresh_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_refresh_token_user_id_idx" ON "auth_oauth_refresh_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_refresh_token_authorization_code_id_idx" ON "auth_oauth_refresh_token" USING btree ("authorization_code_id");--> statement-breakpoint
-- Identity owns the OAuth tables. Runtime reaches a token through one function.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_oauth_client, public.auth_oauth_resource,
  public.auth_oauth_client_resource, public.auth_oauth_consent, public.auth_oauth_access_token,
  public.auth_oauth_refresh_token, public.auth_oauth_client_assertion TO notesapp_auth;
--> statement-breakpoint
CREATE FUNCTION public.notesapp_oauth_account(p_user text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT account_id FROM public.account_identities WHERE auth_user_id = p_user;
$$;
--> statement-breakpoint
CREATE FUNCTION public.notesapp_oauth_lock_pair(p_client text, p_user text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE account uuid := public.notesapp_oauth_account(p_user);
BEGIN
  IF account IS NULL THEN RETURN false; END IF;
  PERFORM public.notesapp_lock_account(account);
  PERFORM pg_advisory_xact_lock(hashtext('notesapp:oauth-pair'), hashtext(p_client || ':' || account::text));
  RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.notesapp_oauth_pair_held(p_client text, p_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
   AND granted AND objsubid = 2
   AND classid::bigint = (hashtext('notesapp:oauth-pair')::bigint & 4294967295)
   AND objid::bigint = (hashtext(p_client || ':' || public.notesapp_oauth_account(p_user)::text)::bigint & 4294967295));
$$;
--> statement-breakpoint
CREATE FUNCTION public.notesapp_oauth_issue_allowed(p_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT 1 FROM public.accounts a JOIN public.account_identities ai ON ai.account_id = a.id
   WHERE ai.auth_user_id = p_user AND a.state = 'enabled' AND a.removed_at IS NULL);
$$;
--> statement-breakpoint
CREATE FUNCTION public.notesapp_oauth_consent_allowed(p_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT public.notesapp_oauth_issue_allowed(p_user) AND EXISTS (
   SELECT 1 FROM public.accounts a JOIN public.account_identities ai ON ai.account_id = a.id
   WHERE ai.auth_user_id = p_user AND a.standing = 'active');
$$;
--> statement-breakpoint
CREATE FUNCTION public.notesapp_guard_oauth_token() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c text; u text;
BEGIN
  c := CASE WHEN TG_OP = 'DELETE' THEN OLD.client_id ELSE NEW.client_id END;
  u := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  IF NOT public.notesapp_oauth_pair_held(c, u) THEN
    RAISE EXCEPTION 'notesapp: an OAuth token write needs its pair lock' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'notesapp: an OAuth token keeps its owner' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT public.notesapp_oauth_issue_allowed(u) THEN
      RAISE EXCEPTION 'notesapp: OAuth issuance is refused' USING ERRCODE = '42501';
    END IF;
    UPDATE public.auth_oauth_client SET last_used_at = clock_timestamp() WHERE client_id = c;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER oauth_access_pair BEFORE INSERT OR UPDATE OR DELETE ON public.auth_oauth_access_token
FOR EACH ROW EXECUTE FUNCTION public.notesapp_guard_oauth_token();
--> statement-breakpoint
CREATE TRIGGER oauth_refresh_pair BEFORE INSERT OR UPDATE OR DELETE ON public.auth_oauth_refresh_token
FOR EACH ROW EXECUTE FUNCTION public.notesapp_guard_oauth_token();
--> statement-breakpoint
-- Consent and authorization codes on the shared adapter take the same locks.
CREATE FUNCTION public.notesapp_guard_oauth_consent() RETURNS trigger
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
  IF NOT public.notesapp_oauth_consent_allowed(NEW.user_id) THEN
    RAISE EXCEPTION 'notesapp: OAuth consent is refused' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER oauth_consent_pair BEFORE INSERT OR UPDATE OR DELETE ON public.auth_oauth_consent
FOR EACH ROW EXECUTE FUNCTION public.notesapp_guard_oauth_consent();
--> statement-breakpoint
CREATE FUNCTION public.notesapp_guard_oauth_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    BEGIN v := OLD.value::jsonb; EXCEPTION WHEN invalid_text_representation THEN RETURN OLD; END;
    IF v->>'type' = 'authorization_code' THEN
      PERFORM public.notesapp_oauth_lock_pair(v->'query'->>'client_id', v->>'userId');
    END IF;
    RETURN OLD;
  END IF;
  BEGIN v := NEW.value::jsonb; EXCEPTION WHEN invalid_text_representation THEN RETURN NEW; END;
  IF v->>'type' = 'authorization_code' THEN
    PERFORM public.notesapp_oauth_lock_pair(v->'query'->>'client_id', v->>'userId');
    IF NOT public.notesapp_oauth_consent_allowed(v->>'userId') THEN
      RAISE EXCEPTION 'notesapp: OAuth code issuance is refused' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER oauth_code_pair BEFORE INSERT OR UPDATE OR DELETE ON public.auth_verification
FOR EACH ROW EXECUTE FUNCTION public.notesapp_guard_oauth_code();
--> statement-breakpoint
CREATE FUNCTION public.notesapp_oauth_revoke_user(p_user text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c record; account uuid := public.notesapp_oauth_account(p_user);
BEGIN
  IF account IS NULL THEN RETURN; END IF;
  PERFORM public.notesapp_lock_account(account);
  FOR c IN SELECT DISTINCT client_id FROM (
    SELECT client_id FROM public.auth_oauth_access_token WHERE user_id = p_user
    UNION SELECT client_id FROM public.auth_oauth_refresh_token WHERE user_id = p_user
    UNION SELECT client_id FROM public.auth_oauth_consent WHERE user_id = p_user
    UNION SELECT (CASE WHEN value IS JSON OBJECT THEN value::jsonb END)->'query'->>'client_id' AS client_id FROM public.auth_verification
      WHERE value LIKE '{%' AND (CASE WHEN value IS JSON OBJECT THEN value::jsonb END)->>'type' = 'authorization_code' AND (CASE WHEN value IS JSON OBJECT THEN value::jsonb END)->>'userId' = p_user
  ) pairs ORDER BY client_id LOOP
    PERFORM public.notesapp_oauth_lock_pair(c.client_id, p_user);
  END LOOP;
  DELETE FROM public.auth_oauth_access_token WHERE user_id = p_user;
  DELETE FROM public.auth_oauth_refresh_token WHERE user_id = p_user;
  DELETE FROM public.auth_oauth_consent WHERE user_id = p_user;
  DELETE FROM public.auth_verification WHERE value LIKE '{%' AND (CASE WHEN value IS JSON OBJECT THEN value::jsonb END)->>'type' = 'authorization_code'
    AND (CASE WHEN value IS JSON OBJECT THEN value::jsonb END)->>'userId' = p_user;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.notesapp_invalidate_oauth_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE u text;
BEGIN
  PERFORM public.notesapp_lock_account(NEW.id);
  IF NEW.state = 'disabled' OR NEW.removed_at IS NOT NULL THEN
    SELECT auth_user_id INTO u FROM public.account_identities WHERE account_id = NEW.id;
    IF u IS NOT NULL THEN PERFORM public.notesapp_oauth_revoke_user(u); END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER oauth_account_state AFTER UPDATE OF state, removed_at ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.notesapp_invalidate_oauth_account();
--> statement-breakpoint
-- This replaces the password key trigger body and keeps its existing key guard.
CREATE OR REPLACE FUNCTION public.notesapp_invalidate_password_keys() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.notesapp_lock_account(public.notesapp_oauth_account(NEW.user_id));
  PERFORM public.notesapp_oauth_revoke_user(NEW.user_id);
  PERFORM 1 FROM public.accounts a JOIN public.account_identities ai ON ai.account_id = a.id
    WHERE ai.auth_user_id = NEW.user_id ORDER BY a.id FOR UPDATE OF a;
  DELETE FROM public.api_keys k USING public.account_identities ai
    WHERE ai.account_id = k.account_id AND ai.auth_user_id = NEW.user_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.notesapp_oauth_identity_deleting() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.notesapp_oauth_revoke_user(OLD.id);
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER oauth_identity_delete BEFORE DELETE ON public.auth_user
FOR EACH ROW EXECUTE FUNCTION public.notesapp_oauth_identity_deleting();
--> statement-breakpoint
CREATE FUNCTION public.notesapp_oauth_session_deleting() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c record;
BEGIN
  PERFORM public.notesapp_lock_account(public.notesapp_oauth_account(OLD.user_id));
  FOR c IN SELECT client_id FROM public.auth_oauth_client ORDER BY client_id LOOP
    PERFORM public.notesapp_oauth_lock_pair(c.client_id, OLD.user_id);
  END LOOP;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER oauth_session_delete BEFORE DELETE ON public.auth_session
FOR EACH ROW EXECUTE FUNCTION public.notesapp_oauth_session_deleting();
--> statement-breakpoint
CREATE FUNCTION public.notesapp_bound_oauth_clients() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('notesapp:oauth-client-bound')::bigint);
  IF (SELECT count(*) FROM public.auth_oauth_client) >= 1000 THEN
    RAISE EXCEPTION 'notesapp: the OAuth client bound is full' USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER oauth_client_bound BEFORE INSERT ON public.auth_oauth_client
FOR EACH ROW EXECUTE FUNCTION public.notesapp_bound_oauth_clients();
--> statement-breakpoint
-- The runtime role receives identity and current access, and no stored token.
CREATE FUNCTION public.notesapp_oauth_token_identity(p_digest text, p_resource text)
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
  ) SELECT a.id, ai.auth_user_id, a.standing, c.id, ARRAY(SELECT scope FROM unnest(t.scopes) AS scope WHERE scope = ANY(c.scopes))
    FROM usable t JOIN public.auth_oauth_consent c ON c.client_id = t.client_id AND c.user_id = t.user_id
    JOIN public.account_identities ai ON ai.auth_user_id = t.user_id
    JOIN public.accounts a ON a.id = ai.account_id WHERE a.state = 'enabled' AND a.removed_at IS NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_oauth_account(text), public.notesapp_oauth_lock_pair(text,text),
  public.notesapp_oauth_pair_held(text,text), public.notesapp_oauth_issue_allowed(text), public.notesapp_oauth_consent_allowed(text),
  public.notesapp_guard_oauth_token(), public.notesapp_guard_oauth_consent(), public.notesapp_guard_oauth_code(),
  public.notesapp_oauth_revoke_user(text), public.notesapp_invalidate_oauth_account(),
  public.notesapp_oauth_identity_deleting(), public.notesapp_oauth_session_deleting(),
  public.notesapp_bound_oauth_clients(), public.notesapp_oauth_token_identity(text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_oauth_lock_pair(text,text), public.notesapp_oauth_issue_allowed(text)
  TO notesapp_auth;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_oauth_token_identity(text,text) TO notesapp_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.notesapp_schema_version() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT 37; $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_oauth_account(text), public.notesapp_lock_account(uuid), public.notesapp_claim_daily_run(text,date) TO notesapp_auth;
