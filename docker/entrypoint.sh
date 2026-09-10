#!/bin/sh
# Container entry point: apply the database migrations, then serve.
#
# The migration runs with the migration role and its own secret files. The
# server then runs with the restricted runtime role. When a migration fails,
# this script exits with a nonzero status, the container stops, and the Compose
# restart policy starts it again. The container stays out of service until the
# migration succeeds, because the readiness probe checks the schema version.
set -eu

app_root="${NOTESAPP_APP_ROOT:-/app}"

# Node resolves the migration entry through the package exports of
# @notesapp/storage-server, so no path inside the package manager store is
# written here.
migrate_entry="$(
  cd "$app_root/server" &&
    node -p "require.resolve('@notesapp/storage-server/migrate')"
)"

NOTESAPP_DATABASE_URL_FILE="${NOTESAPP_MIGRATION_DATABASE_URL_FILE:-/run/secrets/migration_database_url}" \
  NOTESAPP_RUNTIME_PASSWORD_FILE="${NOTESAPP_RUNTIME_PASSWORD_FILE:-/run/secrets/runtime_database_password}" \
  NOTESAPP_AUTH_PASSWORD_FILE="${NOTESAPP_AUTH_PASSWORD_FILE:-/run/secrets/auth_database_password}" \
  node "$migrate_entry" --profile deploy

exec node "$app_root/server/dist/main.js" "$@"
