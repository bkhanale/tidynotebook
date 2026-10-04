-- The counts of record 0193 reach the monthly table of migration 0030. Each
-- server process adds the sums of its own memory every ten seconds through
-- one function, and a check reads the stored totals through two others. The
-- table keeps its shape, and the runtime role still holds no right on it.
--
-- The counts and the limits are no workspace data: they name an account and
-- a number, and never a note, a path or a link. The runtime role is the
-- server itself, so the three functions check no membership, as the attempt
-- counters of migration 0013 check none.

-- Adds the sums of one process to the rows of their month. Each position of
-- the arrays is one sum, and a null account is the installation. One
-- statement adds every sum, so a failure adds none and the process keeps its
-- sums for the next write. A sum of an account that does not exist adds
-- nothing, so one such sum never blocks the others.
--
-- Every process writes the installation row and many account rows at once,
-- so the write locks its rows in one order: the month, then the
-- installation, then each account by its identifier. Two writes then wait
-- for each other and never deadlock. The loop reads its sums in that order
-- and writes one row at a time, because the order in which one statement
-- writes the rows of a grouping is not a rule of the planner.
CREATE FUNCTION public.notesapp_add_monthly_usage(
		p_months date[],
		p_accounts uuid[],
		p_published bigint[],
		p_downloads bigint[],
		p_writes bigint[],
		p_reads bigint[])
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		size integer := coalesce(cardinality(p_months), 0);
		entry record;
	BEGIN
		IF coalesce(cardinality(p_accounts), 0) <> size
			OR coalesce(cardinality(p_published), 0) <> size
			OR coalesce(cardinality(p_downloads), 0) <> size
			OR coalesce(cardinality(p_writes), 0) <> size
			OR coalesce(cardinality(p_reads), 0) <> size THEN
			RAISE EXCEPTION 'notesapp: each monthly count needs every member'
				USING ERRCODE = '22023';
		END IF;
		FOR entry IN
			SELECT u.month, u.account_id, sum(u.published) AS published,
				sum(u.downloads) AS downloads, sum(u.writes) AS writes,
				sum(u.reads) AS reads
			FROM unnest(p_months, p_accounts, p_published, p_downloads,
				p_writes, p_reads)
				AS u(month, account_id, published, downloads, writes, reads)
			WHERE u.account_id IS NULL
				OR EXISTS (SELECT 1 FROM public.accounts a
					WHERE a.id = u.account_id)
			GROUP BY u.month, u.account_id
			ORDER BY u.month, u.account_id NULLS FIRST
		LOOP
			INSERT INTO public.monthly_usage AS mu (month, account_id,
				published_transfer_bytes, download_bytes, object_writes,
				object_reads)
			VALUES (entry.month, entry.account_id, entry.published,
				entry.downloads, entry.writes, entry.reads)
			ON CONFLICT ON CONSTRAINT monthly_usage_month_account_unique
			DO UPDATE SET
				published_transfer_bytes =
					mu.published_transfer_bytes + excluded.published_transfer_bytes,
				download_bytes = mu.download_bytes + excluded.download_bytes,
				object_writes = mu.object_writes + excluded.object_writes,
				object_reads = mu.object_reads + excluded.object_reads;
		END LOOP;
	END
	$$;--> statement-breakpoint

-- The account that a limit holds and its two limits (record 0189): the
-- account itself, or the owner of a workspace for its reader path. A
-- removed account, and a workspace with no owner, answer no row.
CREATE FUNCTION public.notesapp_usage_subject(
		p_account_id uuid,
		p_workspace_id uuid)
	RETURNS TABLE (
		account_id uuid,
		published_transfer_limit_bytes bigint,
		download_limit_bytes bigint)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT a.id, a.published_transfer_limit_bytes, a.download_limit_bytes
		FROM public.accounts a
		WHERE a.id = coalesce(p_account_id,
				public.notesapp_workspace_owner(p_workspace_id))
			AND a.removed_at IS NULL
	$$;--> statement-breakpoint

-- The stored totals of one month for one account and for the installation.
-- A month with no row answers zero, and no account answers zero for the
-- account.
CREATE FUNCTION public.notesapp_stored_usage(p_month date, p_account_id uuid)
	RETURNS TABLE (
		account_published_transfer_bytes bigint,
		account_download_bytes bigint,
		account_object_writes bigint,
		account_object_reads bigint,
		installation_published_transfer_bytes bigint,
		installation_download_bytes bigint,
		installation_object_writes bigint,
		installation_object_reads bigint)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT coalesce(a.published_transfer_bytes, 0),
			coalesce(a.download_bytes, 0),
			coalesce(a.object_writes, 0),
			coalesce(a.object_reads, 0),
			coalesce(i.published_transfer_bytes, 0),
			coalesce(i.download_bytes, 0),
			coalesce(i.object_writes, 0),
			coalesce(i.object_reads, 0)
		FROM (SELECT 1) AS one
		LEFT JOIN public.monthly_usage a
			ON a.month = p_month AND a.account_id = p_account_id
		LEFT JOIN public.monthly_usage i
			ON i.month = p_month AND i.account_id IS NULL
	$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_add_monthly_usage(date[], uuid[], bigint[], bigint[], bigint[], bigint[]) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_usage_subject(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_stored_usage(date, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_add_monthly_usage(date[], uuid[], bigint[], bigint[], bigint[], bigint[]) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_usage_subject(uuid, uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_stored_usage(date, uuid) TO notesapp_app;--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the thirty-second entry, so the function reports thirty-two.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 32;
$$;
