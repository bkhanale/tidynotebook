CREATE TABLE "stream_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_publishing" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"publishing" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_publishing_one_row" CHECK ("sync_publishing"."id")
);
--> statement-breakpoint
ALTER TABLE "stream_reservations" ADD CONSTRAINT "stream_reservations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stream_reservations_account_idx" ON "stream_reservations" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "stream_reservations_expiry_idx" ON "stream_reservations" USING btree ("expires_at");--> statement-breakpoint

-- The sync notices, from record 0129. Every hint goes on one channel,
-- `notesapp_sync`, and names a workspace, a session, an account, or a change
-- of the publishing switch. A hint carries no content and no credential.
--
-- Both tables are reached through the functions below only, so each has an
-- owner policy and no runtime policy.
ALTER TABLE public.sync_publishing ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.sync_publishing FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.stream_reservations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.stream_reservations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
	EXECUTE format(
		'CREATE POLICY sync_publishing_owner_policy ON public.sync_publishing '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
	EXECUTE format(
		'CREATE POLICY stream_reservations_owner_policy ON public.stream_reservations '
		'FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
END
$$;--> statement-breakpoint

-- Publishing starts off. An operator turns it on after the rollout checks of
-- plan 016.
INSERT INTO public.sync_publishing (id, publishing) VALUES (true, false);--> statement-breakpoint

-- Whether the triggers send hints now.
CREATE FUNCTION public.notesapp_notices_publishing()
	RETURNS boolean
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT coalesce(
			(SELECT p.publishing FROM public.sync_publishing p WHERE p.id), false)
	$$;--> statement-breakpoint

-- Sets the publishing switch and tells every listening process, in either
-- direction, so no process waits for its timer to learn of a stop.
CREATE FUNCTION public.notesapp_set_notices_publishing(p_publishing boolean)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	BEGIN
		UPDATE public.sync_publishing
			SET publishing = p_publishing, updated_at = now()
			WHERE id;
		PERFORM pg_notify('notesapp_sync', 'p');
	END
	$$;--> statement-breakpoint

-- One hint per workspace that one statement wrote feed rows for. The hint is
-- queued in the writing transaction, so PostgreSQL delivers it after commit
-- and drops it on a rollback. A replayed receipt writes no feed row, so it
-- sends nothing.
CREATE FUNCTION public.notesapp_notify_sync_changes()
	RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		changed uuid;
	BEGIN
		IF NOT public.notesapp_notices_publishing() THEN
			RETURN NULL;
		END IF;
		FOR changed IN
			SELECT DISTINCT i.workspace_id FROM inserted i ORDER BY 1
		LOOP
			PERFORM pg_notify('notesapp_sync', 'w:' || changed::text);
		END LOOP;
		RETURN NULL;
	END
	$$;--> statement-breakpoint

CREATE TRIGGER sync_changes_notify
	AFTER INSERT ON public.sync_changes
	REFERENCING NEW TABLE AS inserted
	FOR EACH STATEMENT
	EXECUTE FUNCTION public.notesapp_notify_sync_changes();--> statement-breakpoint

-- A session that ends writes no feed row, so its end is a hint of its own.
-- The session id is not the token of the session (record 0122).
CREATE FUNCTION public.notesapp_notify_session_ended()
	RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		ended text;
	BEGIN
		IF NOT public.notesapp_notices_publishing() THEN
			RETURN NULL;
		END IF;
		FOR ended IN SELECT DISTINCT r.id FROM removed r ORDER BY 1 LOOP
			PERFORM pg_notify('notesapp_sync', 's:' || ended);
		END LOOP;
		RETURN NULL;
	END
	$$;--> statement-breakpoint

CREATE TRIGGER auth_session_notify
	AFTER DELETE ON public.auth_session
	REFERENCING OLD TABLE AS removed
	FOR EACH STATEMENT
	EXECUTE FUNCTION public.notesapp_notify_session_ended();--> statement-breakpoint

-- A disabled or removed account writes no feed row either. PostgreSQL takes
-- no column list on a trigger with transition tables, so the function
-- compares the state and the removal of each updated row itself.
CREATE FUNCTION public.notesapp_notify_account_changed()
	RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		changed uuid;
	BEGIN
		IF NOT public.notesapp_notices_publishing() THEN
			RETURN NULL;
		END IF;
		FOR changed IN
			SELECT DISTINCT n.id FROM new_rows n
			JOIN old_rows o ON o.id = n.id
			WHERE n.state IS DISTINCT FROM o.state
				OR n.removed_at IS DISTINCT FROM o.removed_at
			ORDER BY 1
		LOOP
			PERFORM pg_notify('notesapp_sync', 'a:' || changed::text);
		END LOOP;
		RETURN NULL;
	END
	$$;--> statement-breakpoint

CREATE TRIGGER accounts_notify
	AFTER UPDATE ON public.accounts
	REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
	FOR EACH STATEMENT
	EXECUTE FUNCTION public.notesapp_notify_account_changed();--> statement-breakpoint

-- The workspaces that one stream may still hear about, or null when its
-- session has ended, has expired, or serves another or a disabled account.
-- A gateway asks before each outbound batch and caches no answer.
CREATE FUNCTION public.notesapp_notice_access(
		p_session_id text,
		p_account_id uuid)
	RETURNS uuid[]
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		SELECT CASE WHEN EXISTS (
			SELECT 1 FROM public.auth_session s
			JOIN public.account_identities ai ON ai.auth_user_id = s.user_id
			JOIN public.accounts a ON a.id = ai.account_id
			WHERE s.id = p_session_id
				AND s.expires_at > now()
				AND a.id = p_account_id
				AND a.state = 'enabled'
				AND a.removed_at IS NULL)
		THEN coalesce(
			(SELECT array_agg(m.workspace_id ORDER BY m.workspace_id)
				FROM public.memberships m WHERE m.account_id = p_account_id),
			'{}'::uuid[])
		ELSE NULL END
	$$;--> statement-breakpoint

-- Reserves one stream of one account when the account holds fewer than the
-- limit, across every process. The lock is apart from the account lock of
-- record 0112 and this transaction takes no other, so it cannot deadlock.
CREATE FUNCTION public.notesapp_reserve_stream(
		p_id uuid,
		p_account_id uuid,
		p_ttl_ms integer,
		p_limit integer)
	RETURNS boolean
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		held integer;
	BEGIN
		PERFORM pg_advisory_xact_lock(
			hashtext('notesapp:stream:' || p_account_id::text)::bigint);
		DELETE FROM public.stream_reservations
			WHERE account_id = p_account_id AND expires_at <= clock_timestamp();
		SELECT count(*) INTO held FROM public.stream_reservations
			WHERE account_id = p_account_id;
		IF held >= p_limit THEN
			RETURN false;
		END IF;
		INSERT INTO public.stream_reservations (id, account_id, expires_at)
			VALUES (p_id, p_account_id,
				clock_timestamp() + p_ttl_ms * interval '1 millisecond');
		RETURN true;
	END
	$$;--> statement-breakpoint

-- Moves the expiry of a live reservation. False means it expired or was
-- released, and the stream it held must stop.
CREATE FUNCTION public.notesapp_renew_stream(p_id uuid, p_ttl_ms integer)
	RETURNS boolean
	LANGUAGE sql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		WITH renewed AS (
			UPDATE public.stream_reservations
				SET expires_at = clock_timestamp() + p_ttl_ms * interval '1 millisecond'
				WHERE id = p_id AND expires_at > clock_timestamp()
				RETURNING id)
		SELECT EXISTS (SELECT 1 FROM renewed)
	$$;--> statement-breakpoint

CREATE FUNCTION public.notesapp_release_stream(p_id uuid)
	RETURNS void
	LANGUAGE sql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
		DELETE FROM public.stream_reservations WHERE id = p_id
	$$;--> statement-breakpoint

-- Deletes the reservations that expired, which a stopped process left. The
-- hourly maintenance calls it.
CREATE FUNCTION public.notesapp_prune_streams()
	RETURNS integer
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, public
	AS $$
	DECLARE
		removed integer;
	BEGIN
		DELETE FROM public.stream_reservations
			WHERE expires_at <= clock_timestamp();
		GET DIAGNOSTICS removed = ROW_COUNT;
		RETURN removed;
	END
	$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.notesapp_notices_publishing() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_set_notices_publishing(boolean) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_notify_sync_changes() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_notify_session_ended() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_notify_account_changed() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_notice_access(text, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_reserve_stream(uuid, uuid, integer, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_renew_stream(uuid, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_release_stream(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notesapp_prune_streams() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_notices_publishing() TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_set_notices_publishing(boolean) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_notice_access(text, uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_reserve_stream(uuid, uuid, integer, integer) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_renew_stream(uuid, integer) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_release_stream(uuid) TO notesapp_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notesapp_prune_streams() TO notesapp_app;--> statement-breakpoint

-- The schema version is the number of entries in the migration journal. This
-- migration is the twentieth entry, so the function reports twenty.
CREATE OR REPLACE FUNCTION public.notesapp_schema_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 20;
$$;
