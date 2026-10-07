-- Password recovery and key creation use the same account lock (0208, 0112).
-- After a creator commits, the next statement sees and removes its key.
CREATE OR REPLACE FUNCTION public.notesapp_invalidate_password_keys() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public.accounts a
    JOIN public.account_identities ai ON ai.account_id = a.id
    WHERE ai.auth_user_id = NEW.user_id
    ORDER BY a.id FOR UPDATE OF a;
  DELETE FROM public.api_keys k USING public.account_identities ai
    WHERE ai.account_id = k.account_id AND ai.auth_user_id = NEW.user_id;
  RETURN NEW;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.notesapp_schema_version() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT 35; $$;
