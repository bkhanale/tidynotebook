# Self-hosting

This page is for the person who runs the server. It is the production
installation guide.

For the shortest path from a clone to the setup screen, read
[Quick start](quickstart.md). When the installation runs, read
[Backup and restore](backup-and-restore.md), [Upgrade](upgrade.md), and the
[Security model](security-model.md).

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

Install Docker Engine, Docker Compose, GnuPG, the PostgreSQL client tools, and
`lsblk`. The versions this installation was built against are in
`docker-compose.yml`, `.node-version`, and the root `package.json`. A newer
compatible host tool can work. Record the version you used in your own
installation record.

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
names it when it is not set. Leave `NOTESAPP_ADDITIONAL_ORIGINS` empty unless a
second address reaches this installation. Write each additional origin in full,
with its scheme and its port, and use the scheme of `NOTESAPP_ORIGIN` for each
one. One installation serves HTTP or HTTPS, not both, because one cookie policy
serves all of its origins. An empty list serves `NOTESAPP_ORIGIN` and nothing
else.

Set `NOTESAPP_SECRETS_DIR` and create the directory it names. The Compose
default is `./.secrets` inside the repository, which is a convenience for a
first local start only. Move the directory outside the repository for a real
installation, so that a checkout, a copy, or a `git clean` cannot carry the
secrets or delete them. `.env.example` already names
`/etc/notesapp/secrets`.

Create these files with mode `0600` and owner uid 10001, which is
the `notesapp` user of the image. The application runs as that user and cannot
read a file that belongs to another owner:

| File                        | Content                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `postgres_password`         | Password for the initial PostgreSQL administrator.                            |
| `migration_database_url`    | PostgreSQL URL for the administrator or migration role, with host `postgres`. |
| `runtime_database_password` | A unique password of at least 12 characters for `notesapp_app`.               |
| `auth_database_password`    | A different password of at least 12 characters for `notesapp_auth`.           |
| `runtime_database_url`      | URL for `notesapp_app`, with host `postgres`.                                 |
| `auth_database_url`         | URL for `notesapp_auth`, with host `postgres`.                                |
| `auth_secret`               | A random session-signing secret of at least 32 characters.                    |

Set the owner and the mode after you write the files:

```bash
sudo chown 10001:10001 /etc/notesapp/secrets/*
sudo chmod 600 /etc/notesapp/secrets/*
```

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

The deployment answers the host name of each origin it serves, so the container
health check sends the host name of the origin. A request that names another
host is refused. Your reverse proxy must pass the original `Host` header to the
application, which Caddy and Traefik do on their own and nginx does when you set
it.

## Logs

Structured request logs contain the request ID, method, redacted URL, status, and duration. They do not contain headers, cookies, credentials, request bodies, note text, search text, or query values.

Both Compose services use the `json-file` driver with rotation.
`NOTESAPP_LOG_MAX_SIZE` and `NOTESAPP_LOG_MAX_FILE` in `.env` set the size of
one file and the number of files that are kept.

This release serves no metrics route. Watch the readiness result, the container
log, and the age of the newest backup archive.
