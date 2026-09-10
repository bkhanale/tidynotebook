# Self-hosting and recovery

NotesApp runs as one application service and one PostgreSQL service. The
application container applies the database migrations and then serves the web
app, the REST API, and the authentication routes on one origin.

Put an HTTPS reverse proxy in front of `127.0.0.1:3000`. Do not publish the
PostgreSQL port. The Compose database network is private. The application uses
a second network for optional SMTP and other required outbound traffic.

The Compose file publishes the application on `127.0.0.1` only. For temporary
access from a trusted local network, publish it on all interfaces and use the
local-network URL as the origin:

```bash
NOTESAPP_BIND_HOST=0.0.0.0
NOTESAPP_ORIGIN=http://192.0.2.10:3000
```

Replace the documentation address with the host address. Run only one
application listener on port 3000. The core workspace, identifier, digest, and
save paths work when a plain HTTP browser does not provide secure-context APIs.
Some optional browser functions, such as service worker installation and the
asynchronous clipboard, can still be unavailable on plain HTTP. Use HTTPS for
a permanent deployment and for full offline installation behavior.

## Host requirements

Install Docker Engine, Docker Compose, GnuPG, PostgreSQL client tools, and `lsblk`. The reference versions are Docker Engine 29.8.0, Compose 5.5.1, PostgreSQL 18.6, Node.js 26.8.1, and pnpm 12.3.4. A newer compatible host tool can work, but record the version in the installation record.

Use encrypted host storage before you create the data directories. The
encryption boundary must include:

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

Store volume keys outside the data directories and outside all data backups. Use a protected key store, TPM policy, HSM, or an operator-held offline key. Record the unlock procedure. Test it after a restart. For LUKS rotation, add and test a new key slot before you remove the old key slot. Never generate an automatic replacement key when an existing key is missing.

## Data directories

Both services bind-mount host directories, so the host check, the backup
script, and the restore script all name the same paths. Create them before the
first start:

```bash
sudo mkdir -p /srv/notesapp/postgres /srv/notesapp/storage
sudo chown 10001:10001 /srv/notesapp/storage
```

The storage directory must belong to uid 10001, which is the `notesapp` user of
the image. PostgreSQL sets the owner of its own directory. Name both paths in
`.env` with `NOTESAPP_DATABASE_DIR` and `NOTESAPP_STORAGE_DIR`.

## Protected configuration

Copy `.env.example` to `.env`. The `.env` file contains only nonsecret
settings. Set `NOTESAPP_ORIGIN` to the public HTTPS origin. This value is
required and has no default: `docker compose up` stops with a message that
names it when it is not set. Leave `NOTESAPP_ALLOWED_HOSTS` empty unless a
second host name reaches this installation. An empty list serves the host of
the origin and nothing else.

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

Compose waits for PostgreSQL. The application container then runs its entry
point, which applies the migrations with the migration role and starts the
server with the restricted runtime role.

When a migration fails, the entry point exits with a nonzero status and the
container stops. The `unless-stopped` restart policy starts it again, so the
container repeats the attempt until the cause is fixed. Read
`docker compose logs app` for the failure, fix the cause, and the next attempt
completes. Both services rotate their container logs, so a repeated attempt
cannot fill the disk. Startup also fails when a required secret file, storage
mount, or database connection is not usable.

Open the web application after the first startup. Enter the email address and
password for the single user. The setup operation is available only until this
account exists. Use `pnpm owner:bootstrap` only when an unattended installation
must create the same first account before a browser opens.

## Health and readiness

`GET /health` reports process liveness. `GET /ready` checks configuration, database connectivity, storage access, and the required database schema version. The container health check uses readiness. A failed migration keeps the application unready.

The same contract operations are available at `/api/health` and `/api/ready`.

The deployment answers the host of its origin only, so the container health
check sends that host name. A request that names another host is refused with
status 400 and the code `host_not_allowed`.

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

The storage root is the host directory named by `NOTESAPP_STORAGE_DIR`. Omit
`--postgres-container` when compatible `pg_dump` and `psql` commands can reach
the database directly. The database URL does not appear in the host command
arguments.

The command performs these steps:

1. Query the referenced finalized attachment set.
2. Dump PostgreSQL.
3. Copy each referenced attachment and verify its database digest and size.
4. Create a manifest with database and object digests.
5. Encrypt the archive with GnuPG AES-256 symmetric encryption.
6. Decrypt and verify the completed archive.
7. Keep one backup for each of the newest seven UTC days and one backup for each of the newest four ISO weeks.

### Backup consistency

The database part is consistent on its own, because `pg_dump` reads one
transaction snapshot. The attachment files are content addressed by their
digest, so a file that the dump references is never rewritten in place. A save
that lands during the backup is therefore either fully in the archive or fully
absent from it.

For an archive that is also consistent across the two parts, stop the
application first and start it again after the backup:

```bash
docker compose stop app
./tools/ops/backup.sh ...
docker compose start app
```

Schedule at least one backup each day. Copy the encrypted archives to storage that is separate from the application host. Do not copy the backup key with the archives.

Check the age of the newest archive in the backup directory:

```bash
ls -t /mnt/separate-backups/notesapp/backup-*.tar.gpg | head -1
find /mnt/separate-backups/notesapp -name 'backup-*.tar.gpg' -mtime -1 | head -1
```

The second command prints nothing when no archive is newer than one day. Alert
on that empty result.

Verify an archive without a restore:

```bash
./tools/ops/verify-backup.sh \
  --backup-file /mnt/separate-backups/notesapp/backup-20260906-120000Z.tar.gpg \
  --key-file /etc/notesapp/backup-key \
  --installation-id-file /etc/notesapp/installation-id
```

## Restore

Stop the application with `docker compose stop app`. Create a new empty database and an empty attachment directory. Use the same installation ID and the correct backup key.

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

Give the restored storage directory to uid 10001 before you start the
application:

```bash
sudo chown -R 10001:10001 /srv/notesapp-restored/storage
```

Start the application only after the restore command succeeds. Check `/ready`, open representative notes and attachments, and run a new backup. Test restoration regularly on a separate empty installation. A backup is not accepted recovery evidence until this test passes.

If a volume key or backup key is unavailable, stop. Do not create a replacement key and claim that it can recover old data.

## Logs

Structured request logs contain the request ID, method, redacted URL, status, and duration. They do not contain headers, cookies, credentials, request bodies, note text, search text, or query values.

Both Compose services use the `json-file` driver with rotation.
`NOTESAPP_LOG_MAX_SIZE` and `NOTESAPP_LOG_MAX_FILE` in `.env` set the size of
one file and the number of files that are kept.

This release serves no metrics route. Watch the readiness result, the container
log, and the age of the newest backup archive.

## Upgrade and rollback

Back up and verify the current installation before an upgrade. Build the new
image and wait for readiness. Migrations move forward. If a migration fails,
the container exits and repeats the attempt, and the application stays unready.
Restore the verified pre-upgrade database and attachment set into an empty
target before you start the prior application build.

Do not copy a database without its referenced attachments. Do not copy attachments without the matching database snapshot.
