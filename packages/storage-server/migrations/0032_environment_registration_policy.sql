-- The registration policy that the server environment names (record 0206).
--
-- The server writes the policy of its environment into the one row of the
-- installation settings at each start, so the gate of the open ground in
-- `notesapp_register_account`, the sign-up and the accounts page read one
-- value. The start has no session, so this function checks no
-- administrator. The runtime role is the server itself, as the attempt
-- counters of migration 0013 assume. The policy is no workspace data, so
-- the function checks no membership either.
--
-- It takes the installation lock first, as the change of an administrator
-- does, so a change that runs at the same moment waits for it.
CREATE FUNCTION public.notesapp_apply_registration_policy(
		p_policy public.registration_policy)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		IF p_policy IS NULL THEN
			RAISE EXCEPTION 'notesapp: a registration policy is required'
				USING ERRCODE = '22004';
		END IF;
		PERFORM public.notesapp_lock_installation();
		UPDATE public.installation_settings
		SET registration_policy = p_policy, updated_at = now()
		WHERE registration_policy IS DISTINCT FROM p_policy;
	END
	$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_apply_registration_policy(public.registration_policy) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_apply_registration_policy(public.registration_policy) TO notesapp_app;--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the thirty-third entry, so the function reports thirty-three.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 33;
$$;
