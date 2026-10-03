-- The disk of the archive jobs of record 0170. Each job states the most bytes
-- that it may write to the storage volume: an import its stated body length,
-- or the bound of a body when it states none, and an export nothing. An
-- import reserves its job first, then refuses a body that the free space,
-- less the reserve and less the bytes of the other running jobs, cannot
-- hold. Two imports that start together each see the other, so together
-- they never fill the volume.
ALTER TABLE "archive_jobs" ADD COLUMN "disk_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_jobs" ADD CONSTRAINT "archive_jobs_disk_bytes_check" CHECK ("archive_jobs"."disk_bytes" >= 0);--> statement-breakpoint

-- The reservation of migration 0028 takes the disk of the job and answers,
-- beside its state, the disk of every other live job, read under the same
-- lock as the insert. A later reservation always sees an earlier one.
DROP FUNCTION public.notesapp_reserve_archive_job(uuid, uuid, integer, integer, integer);--> statement-breakpoint
CREATE FUNCTION public.notesapp_reserve_archive_job(
		p_id uuid,
		p_account_id uuid,
		p_ttl_ms integer,
		p_account_limit integer,
		p_installation_limit integer,
		p_disk_bytes bigint)
	RETURNS TABLE (state text, other_disk_bytes bigint)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		PERFORM pg_advisory_xact_lock(hashtext('notesapp:archive-jobs')::bigint);
		DELETE FROM public.archive_jobs WHERE expires_at <= clock_timestamp();
		IF (SELECT count(*) FROM public.archive_jobs
				WHERE account_id = p_account_id) >= p_account_limit THEN
			RETURN QUERY SELECT 'account'::text, 0::bigint;
			RETURN;
		END IF;
		IF (SELECT count(*) FROM public.archive_jobs) >= p_installation_limit THEN
			RETURN QUERY SELECT 'installation'::text, 0::bigint;
			RETURN;
		END IF;
		RETURN QUERY SELECT 'reserved'::text,
			coalesce(sum(jobs.disk_bytes), 0)::bigint
			FROM public.archive_jobs AS jobs;
		INSERT INTO public.archive_jobs (id, account_id, expires_at, disk_bytes)
			VALUES (p_id, p_account_id,
				clock_timestamp() + p_ttl_ms * interval '1 millisecond',
				p_disk_bytes);
	END
	$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_reserve_archive_job(uuid, uuid, integer, integer, integer, bigint) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_reserve_archive_job(uuid, uuid, integer, integer, integer, bigint) TO notesapp_app;--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the thirtieth entry, so the function reports thirty.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 30;
$$;
