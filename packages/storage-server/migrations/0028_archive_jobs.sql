CREATE TABLE "archive_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "archive_jobs" ADD CONSTRAINT "archive_jobs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "archive_jobs_account_idx" ON "archive_jobs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "archive_jobs_expiry_idx" ON "archive_jobs" USING btree ("expires_at");--> statement-breakpoint

-- The archive jobs of record 0160. The table is reached through the functions
-- below only, so it has an owner policy and no runtime policy, as the stream
-- reservations of migration 0019 do.
ALTER TABLE public.archive_jobs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.archive_jobs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
	EXECUTE format(
		'CREATE POLICY archive_jobs_owner_policy ON public.archive_jobs '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
END
$$;--> statement-breakpoint

-- Reserves one archive job of one account, across every process. The answer
-- is `reserved`, `account` when the account already runs its limit, or
-- `installation` when the installation does. One lock of its own orders every
-- reservation, apart from the workspace and account locks of record 0112, and
-- this transaction takes no other, so it cannot deadlock.
CREATE FUNCTION public.notesapp_reserve_archive_job(
		p_id uuid,
		p_account_id uuid,
		p_ttl_ms integer,
		p_account_limit integer,
		p_installation_limit integer)
	RETURNS text
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		PERFORM pg_advisory_xact_lock(hashtext('notesapp:archive-jobs')::bigint);
		DELETE FROM public.archive_jobs WHERE expires_at <= clock_timestamp();
		IF (SELECT count(*) FROM public.archive_jobs
				WHERE account_id = p_account_id) >= p_account_limit THEN
			RETURN 'account';
		END IF;
		IF (SELECT count(*) FROM public.archive_jobs) >= p_installation_limit THEN
			RETURN 'installation';
		END IF;
		INSERT INTO public.archive_jobs (id, account_id, expires_at)
			VALUES (p_id, p_account_id,
				clock_timestamp() + p_ttl_ms * interval '1 millisecond');
		RETURN 'reserved';
	END
	$$;--> statement-breakpoint

-- Moves the expiry of a live job. False means it expired.
CREATE FUNCTION public.notesapp_renew_archive_job(p_id uuid, p_ttl_ms integer)
	RETURNS boolean
	LANGUAGE sql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		WITH renewed AS (
			UPDATE public.archive_jobs
				SET expires_at = clock_timestamp() + p_ttl_ms * interval '1 millisecond'
				WHERE id = p_id AND expires_at > clock_timestamp()
				RETURNING id)
		SELECT EXISTS (SELECT 1 FROM renewed)
	$$;--> statement-breakpoint

CREATE FUNCTION public.notesapp_release_archive_job(p_id uuid)
	RETURNS void
	LANGUAGE sql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		DELETE FROM public.archive_jobs WHERE id = p_id
	$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_reserve_archive_job(uuid, uuid, integer, integer, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_renew_archive_job(uuid, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_release_archive_job(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_reserve_archive_job(uuid, uuid, integer, integer, integer) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_renew_archive_job(uuid, integer) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_release_archive_job(uuid) TO notesapp_app;--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the twenty-ninth entry, so the function reports twenty-nine.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 29;
$$;
