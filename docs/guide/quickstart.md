# Quick start

This page is for the person who runs the server. It is the shortest path from a
clone to the setup screen on your own machine. It sets each required directory
under an ignored test directory. Read [Self-hosting](self-hosting.md) before you store
data you care about: a real installation puts the secrets, the database and
the attachments outside the repository, on encrypted storage, behind an HTTPS
reverse proxy.

You need Docker Engine, Docker Compose v2 and `openssl`.
Use a new clone for this test. Use the same shell for each step. Do not run
these commands on an existing installation.

## 1. Clone and configure

```bash
git clone https://github.com/tidynotebook/tidynotebook.git notesapp
cd notesapp
umask 077
test ! -e .env
quickstart_data="$PWD/.tooling/quickstart"
mkdir -p "$quickstart_data/secrets" "$quickstart_data/postgres" "$quickstart_data/storage"
printf 'NOTESAPP_ORIGIN=http://127.0.0.1:3000\nNOTESAPP_DATABASE_DIR=%s/postgres\nNOTESAPP_STORAGE_DIR=%s/storage\nNOTESAPP_SECRETS_DIR=%s/secrets\n' \
  "$quickstart_data" "$quickstart_data" "$quickstart_data" > .env
```

Compose requires the origin and all three directories. This test sets them
in `.env`. It keeps the listener on the loopback address. The repository is
private until launch. Before launch, a clone needs access from the owner.

## 2. Create the secret files

Compose reads seven secret files and creates none of them. Run this block
once:

```bash
( cd "$quickstart_data/secrets" &&
  openssl rand -hex 24 > postgres_password &&
  openssl rand -hex 24 > runtime_database_password &&
  openssl rand -hex 24 > auth_database_password &&
  openssl rand -hex 32 > auth_secret &&
  printf 'postgres://postgres:%s@postgres:5432/notesapp\n' "$(cat postgres_password)" > migration_database_url &&
  printf 'postgres://notesapp_app:%s@postgres:5432/notesapp\n' "$(cat runtime_database_password)" > runtime_database_url &&
  printf 'postgres://notesapp_auth:%s@postgres:5432/notesapp\n' "$(cat auth_database_password)" > auth_database_url )
sudo chown 10001:10001 "$quickstart_data/storage" "$quickstart_data/secrets/"*
sudo chmod 600 "$quickstart_data/secrets/"*
```

`openssl rand -hex` writes characters that are safe inside a URL, so no
password needs escaping. The application container runs as uid 10001 and
cannot read a file that belongs to another owner. The migration creates the
`notesapp_app` and `notesapp_auth` roles with the passwords above.

## 3. Build and start

```bash
docker compose build
docker compose up -d
docker compose ps
```

Compose waits for PostgreSQL. The application container then applies the
migrations with the migration role and starts the server with the restricted
runtime role.

## Open the application

Open `http://127.0.0.1:3000` in a browser.

The first visit shows the setup screen. Enter an email address and a password
for the first account, which is the administrator. The setup operation closes
after that account exists, and every later visit shows the sign-in page.

Check that the installation is ready:

```bash
curl -s http://127.0.0.1:3000/ready
docker compose logs app --tail 20
```

The installation serves the origin that you set, and nothing else. A request
that names another host is refused.

## Test data

The database, attachments and secrets of this test stay in the directory you
set in step 1. `.env` and `.tooling/` are in `.gitignore`. The Docker build
also excludes them.

`.env.example` holds the full list of settings with production values. Copy it
when you move to a real installation, and change the three directory settings
to paths outside the checkout.

## Stop and remove

```bash
docker compose down
```

The database and attachments are host directories. This command keeps them.
The `-v` option does not remove data from a host directory. Remove the test
directory yourself only after you stop the containers and no longer need it.
