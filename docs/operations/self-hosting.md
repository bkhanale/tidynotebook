# Self-hosting and recovery

NotesApp runs as one application service and one PostgreSQL service. A one-shot service applies database migrations before the application starts. The application serves the web app, REST API, and authentication routes on one origin.

Put an HTTPS reverse proxy in front of `127.0.0.1:3000`. Do not publish the PostgreSQL port. The Compose database network is private. The application uses a second network for optional SMTP and other required outbound traffic.

For temporary access on a trusted local network, bind the application to all
interfaces and use the local-network URL as its origin:

```bash
NOTESAPP_HOST=0.0.0.0
NOTESAPP_BIND_HOST=0.0.0.0
NOTESAPP_PORT=3000
NOTESAPP_ORIGIN=http://192.0.2.10:3000
NOTESAPP_ALLOWED_HOSTS=192.0.2.10,127.0.0.1,localhost
```

Replace the documentation address with the host address. Run only one
application listener on port 3000. The core workspace, identifier, digest, and
save paths work when a plain HTTP browser does not provide secure-context APIs.
Some optional browser functions, such as service worker installation and the
asynchronous clipboard, can still be unavailable on plain HTTP. Use HTTPS for
a permanent deployment and for full offline installation behavior.

## Host requirements

Install Docker Engine, Docker Compose, GnuPG, PostgreSQL client tools, and `lsblk`. The reference versions are Docker Engine 29.8.0, Compose 5.5.1, PostgreSQL 18.6, Node.js 26.8.1, and pnpm 12.3.4. A newer compatible host tool can work, but record the version in the installation record.

Use encrypted host storage before you create Docker volumes. A Docker volume does not provide encryption. The encryption boundary must include:

1. PostgreSQL data and WAL.
2. NotesApp attachment data.
3. Persistent temporary files.
4. Swap.
5. Core files and other crash output.
6. Local and remote backup storage.

Run the host check with the real host paths:

```bash
./tools/ops/check-host.sh \
  --storage-dir /srv/notesapp/storage \
  --db-dir /srv/notesapp/postgres \
  --wal-dir /srv/notesapp/postgres-wal \
  --backup-dir /mnt/separate-backups/notesapp \
  --temp-dir /srv/notesapp/tmp \
  --crash-dir /var/lib/systemd/coredump
```

The command fails if it cannot prove that a target has an encrypted block-device parent. It also checks active swap and the configured core-dump target. A container cannot perform this host check reliably.

Store volume keys outside the data volume and outside all data backups. Use a protected key store, TPM policy, HSM, or an operator-held offline key. Record the unlock procedure. Test it after a restart. For LUKS rotation, add and test a new key slot before you remove the old key slot. Never generate an automatic replacement key when an existing key is missing.

## Protected configuration

Copy `.env.example` to `.env`. The `.env` file contains only nonsecret settings. Set `NOTESAPP_ORIGIN` to the public HTTPS origin and set `NOTESAPP_ALLOWED_HOSTS` to its host name.

Create the directory named by `NOTESAPP_SECRETS_DIR`. Keep it outside the repository. Create these files with mode `0600`:

| File                        | Content                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `postgres_password`         | Password for the initial PostgreSQL administrator.                            |
| `migration_database_url`    | PostgreSQL URL for the administrator or migration role, with host `postgres`. |
| `runtime_database_password` | A unique password of at least 12 characters for `notesapp_app`.               |
| `auth_database_password`    | A different password of at least 12 characters for `notesapp_auth`.           |
| `runtime_database_url`      | URL for `notesapp_app`, with host `postgres`.                                 |
| `auth_database_url`         | URL for `notesapp_auth`, with host `postgres`.                                |
| `auth_secret`               | A random session-signing secret of at least 32 characters.                    |

The migration URL can use the initial PostgreSQL administrator for the first installation. The migration creates the restricted application roles and sets their passwords. Do not give either application role migration rights.

Optional SMTP URLs can use `NOTESAPP_SMTP_URL_FILE`. Add these files as Compose secrets in an operator override file. Do not put credentials in `.env`, process arguments, logs, or Git.

Validate and start the installation:

```bash
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
```

Compose waits for PostgreSQL, runs the migration service once, and then starts the application. Startup fails when a required secret file, storage mount, database connection, or migration is not usable.

Open the web application after the first startup. Enter the email address and
password for the single user. The setup operation is available only until this
account exists. Use `pnpm owner:bootstrap` only when an unattended installation
must create the same first account before a browser opens.

## Health and readiness

`GET /health` reports process liveness. `GET /ready` checks configuration, database connectivity, storage access, and the required database schema version. The container health check uses readiness. A failed migration keeps the application unready.

The same contract operations are available at `/api/health` and `/api/ready`.

## Write pause

The application stores pause state in `$NOTESAPP_STORAGE_ROOT/write-pause.json`. Each HTTP mutation, operator account mutation, and cleanup job creates an active-writer marker before it changes state. A backup first writes the pause state and then waits until all active-writer markers are gone.

While the pause is active:

- New HTTP mutations receive status 503, Problem Details code `write_paused`, and `Retry-After: 30`.
- Cleanup jobs do not start.
- A cleanup job that already started must finish before backup capture starts.
- Reads and health checks continue.
- A restart stays paused if the pause file still exists.

If a process stops during a write, its marker stays present and backup fails closed. Inspect the database and attachment state before you remove a stale marker. Do not remove a marker only to make a backup command pass.

## Encrypted backups

Use separate encrypted storage for backups. Create these mode `0600` files outside the backup destination:

- A database URL file for the migration role.
- A backup passphrase file with at least 32 bytes of strong random data.
- A stable installation ID file that contains one UUID.

Keep the passphrase and installation ID in an external key store and in the recovery runbook. The backup contains only a hash of the installation ID. A backup from a different installation is rejected.

Run a backup from the repository:

```bash
./tools/ops/backup.sh \
  --storage-root /srv/notesapp/storage \
  --backup-root /mnt/separate-backups/notesapp \
  --database-url-file /etc/notesapp/backup-database-url \
  --key-file /etc/notesapp/backup-key \
  --installation-id-file /etc/notesapp/installation-id \
  --postgres-container notesapp-postgres-1
```

Omit `--postgres-container` when compatible `pg_dump` and `psql` commands can reach the database directly. The database URL does not appear in the host command arguments.

The command performs these steps:

1. Persist the write pause.
2. Wait for all active HTTP and cleanup writes.
3. Query the referenced finalized attachment set.
4. Dump PostgreSQL.
5. Copy each referenced attachment and verify its database digest and size.
6. Create a manifest with database and object digests.
7. Encrypt the archive with GnuPG AES-256 symmetric encryption.
8. Decrypt and verify the completed archive.
9. Update the content-free backup-age marker.
10. Resume writes.
11. Keep one backup for each of the newest seven UTC days and one backup for each of the newest four ISO weeks.

Schedule at least one backup each day. Copy the encrypted archives to storage that is separate from the application host. Do not copy the backup key with the archives.

Verify an archive without a restore:

```bash
./tools/ops/verify-backup.sh \
  --backup-file /mnt/separate-backups/notesapp/backup-20260906-120000Z.tar.gpg \
  --key-file /etc/notesapp/backup-key \
  --installation-id-file /etc/notesapp/installation-id
```

## Restore

Stop the application. Create a new empty database and an empty attachment directory. Use the same installation ID and the correct backup key.

```bash
./tools/ops/restore.sh \
  --backup-file /mnt/separate-backups/notesapp/backup-20260906-120000Z.tar.gpg \
  --storage-root /srv/notesapp-restored/storage \
  --database-url-file /etc/notesapp/restore-database-url \
  --key-file /etc/notesapp/backup-key \
  --installation-id-file /etc/notesapp/installation-id \
  --postgres-container notesapp-postgres-1
```

Restore refuses a nonempty storage target or a database that contains a workspace. It verifies the encrypted archive before it changes the target. After restore, it checks every database-referenced attachment against the restored byte digest and size.

Start the application only after the restore command succeeds. Check `/ready`, open representative notes and attachments, and run a new backup. Test restoration regularly on a separate empty installation. A backup is not accepted recovery evidence until this test passes.

If a volume key or backup key is unavailable, stop. Do not create a replacement key and claim that it can recover old data.

## Logs and metrics

Structured request logs contain the request ID, method, redacted URL, status, and duration. They do not contain headers, cookies, credentials, request bodies, note text, search text, query values, or public-share tokens.

`GET /metrics` returns Prometheus text by default. It reports save failures, authentication failures, attachment storage bytes, backup age, and HTTP request counts. Send `Accept: application/json` for JSON output. Restrict this route at the reverse proxy if operational metrics are private.

Alert on a degraded readiness result, repeated save failures, repeated authentication failures, high storage use, and backup age greater than the scheduled interval.

## Upgrade and rollback

Back up and verify the current installation before an upgrade. Build the new image, run the one-shot migration, and wait for readiness. Migrations move forward. If a migration fails, keep the new application unready. Restore the verified pre-upgrade database and attachment set into an empty target before you start the prior application build.

Do not copy a database without its referenced attachments. Do not copy attachments without the matching database snapshot.
