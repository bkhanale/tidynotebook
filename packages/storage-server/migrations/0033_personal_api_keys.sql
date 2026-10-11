CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "api_keys_token_digest_unique" UNIQUE("token_digest"),
	CONSTRAINT "api_keys_digest_check" CHECK ("api_keys"."token_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "api_keys_name_check" CHECK (char_length("api_keys"."name") between 1 and 80 and "api_keys"."name" = btrim("api_keys"."name")),
	CONSTRAINT "api_keys_expiry_check" CHECK ("api_keys"."expires_at" > "api_keys"."created_at")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_account_idx" ON "api_keys" USING btree ("account_id");--> statement-breakpoint

-- Personal credentials, record 0208. Only narrow functions reach the table.
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.api_keys FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('CREATE POLICY api_keys_owner_policy ON public.api_keys FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
END $$;--> statement-breakpoint

CREATE FUNCTION public.notesapp_account_keys()
RETURNS TABLE (key_id uuid, name text, created_at timestamptz, expires_at timestamptz, last_used_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT k.id, k.name, k.created_at, k.expires_at, k.last_used_at
  FROM public.api_keys k WHERE k.account_id = public.notesapp_current_account()
  ORDER BY k.created_at DESC, k.id;
$$;--> statement-breakpoint

CREATE FUNCTION public.notesapp_create_api_key(p_id uuid, p_name text, p_digest text, p_days integer)
RETURNS TABLE (key_id uuid, name text, created_at timestamptz, expires_at timestamptz, last_used_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE account uuid := public.notesapp_current_account();
BEGIN
  -- The account lock orders creation, disable, removal and the bound.
  PERFORM 1 FROM public.accounts a WHERE a.id = account AND a.state = 'enabled'
    AND a.removed_at IS NULL AND a.standing = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'notesapp: key creation is refused' USING ERRCODE = '42501'; END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 365 OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
    OR p_name IS NULL OR char_length(p_name) NOT BETWEEN 1 AND 80 OR p_name <> btrim(p_name)
    OR p_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'notesapp: key input is refused' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.api_keys k WHERE k.account_id = account) >= 25 THEN RETURN; END IF;
  RETURN QUERY INSERT INTO public.api_keys AS k (id, account_id, name, token_digest, expires_at)
    VALUES (p_id, account, p_name, p_digest, now() + p_days * interval '1 day')
    RETURNING k.id, k.name, k.created_at, k.expires_at, k.last_used_at;
END $$;--> statement-breakpoint

CREATE FUNCTION public.notesapp_revoke_api_key(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  DELETE FROM public.api_keys WHERE id = p_id AND account_id = public.notesapp_current_account();
  RETURN FOUND;
END $$;--> statement-breakpoint

-- A digest buys one narrow identity, never a stored secret or a workspace row.
CREATE FUNCTION public.notesapp_api_key_identity(p_digest text)
RETURNS TABLE (account_id uuid, auth_user_id text, standing public.account_standing, email text, name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN QUERY WITH used AS (
    UPDATE public.api_keys k SET last_used_at = now()
    FROM public.accounts a
    WHERE k.token_digest = p_digest AND k.expires_at > now()
      AND a.id = k.account_id AND a.state = 'enabled' AND a.removed_at IS NULL
    RETURNING k.account_id
  ) SELECT a.id, ai.auth_user_id, a.standing, u.email, u.name
    FROM used k JOIN public.accounts a ON a.id = k.account_id
    JOIN public.account_identities ai ON ai.account_id = a.id
    JOIN public.auth_user u ON u.id = ai.auth_user_id;
END $$;--> statement-breakpoint

CREATE FUNCTION public.notesapp_set_profile_name(p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_name IS NULL OR char_length(p_name) NOT BETWEEN 1 AND 256 OR p_name <> btrim(p_name) THEN
    RAISE EXCEPTION 'notesapp: profile input is refused' USING ERRCODE = '22023';
  END IF;
  UPDATE public.auth_user u SET name = p_name, updated_at = now()
    FROM public.account_identities ai JOIN public.accounts a ON a.id = ai.account_id
    WHERE u.id = ai.auth_user_id AND a.id = public.notesapp_current_account()
      AND a.state = 'enabled' AND a.removed_at IS NULL AND a.standing = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'notesapp: profile change is refused' USING ERRCODE = '42501'; END IF;
END $$;--> statement-breakpoint

CREATE FUNCTION public.notesapp_invalidate_account_keys() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.state = 'disabled' OR NEW.removed_at IS NOT NULL THEN
    DELETE FROM public.api_keys WHERE account_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER api_keys_account_state AFTER UPDATE OF state, removed_at ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.notesapp_invalidate_account_keys();--> statement-breakpoint

-- Reset, recovery and a changed local password revoke all personal keys.
CREATE FUNCTION public.notesapp_invalidate_password_keys() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  DELETE FROM public.api_keys k USING public.account_identities ai
    WHERE ai.account_id = k.account_id AND ai.auth_user_id = NEW.user_id;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER api_keys_password AFTER UPDATE OF password ON public.auth_account
FOR EACH ROW WHEN (OLD.password IS DISTINCT FROM NEW.password)
EXECUTE FUNCTION public.notesapp_invalidate_password_keys();--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_account_keys() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_create_api_key(uuid, text, text, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_revoke_api_key(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_api_key_identity(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_set_profile_name(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_invalidate_account_keys() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_invalidate_password_keys() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_account_keys() TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_create_api_key(uuid, text, text, integer) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_revoke_api_key(uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_api_key_identity(text) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_set_profile_name(text) TO notesapp_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.notesapp_schema_version() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT 34; $$;
