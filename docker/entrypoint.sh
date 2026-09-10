#!/bin/sh
# Container entry point: apply the database migrations, then serve.
#
# The migration runs with the migration role and its own secret files. The
# server then runs with the restricted runtime role. When a migration fails,
# this script exits with a nonzero status and the container stops. The Compose
# restart policy starts it again, so the container repeats the attempt until
# the cause is fixed. The readiness probe checks the schema version, so a
# container that serves without its migrations never reports ready.
#
# The migration entry point comes from the public package entry of
# @notesapp/storage-server, which Node resolves from the server directory. No
# path inside the package manager store is written here.
set -eu

app_root="${NOTESAPP_APP_ROOT:-/app}"
cd "$app_root/server"

NOTESAPP_DATABASE_URL_FILE="${NOTESAPP_MIGRATION_DATABASE_URL_FILE:-/run/secrets/migration_database_url}" \
  NOTESAPP_RUNTIME_PASSWORD_FILE="${NOTESAPP_RUNTIME_PASSWORD_FILE:-/run/secrets/runtime_database_password}" \
  NOTESAPP_AUTH_PASSWORD_FILE="${NOTESAPP_AUTH_PASSWORD_FILE:-/run/secrets/auth_database_password}" \
  node --input-type=module -e "
    const { runMigrationCommand } = await import('@notesapp/storage-server');
    try {
      await runMigrationCommand(['--profile', 'deploy']);
    } catch (error) {
      process.stderr.write(
        (error instanceof Error
          ? error.message
          : 'notesapp: the migration failed.') + '\n',
      );
      process.exit(1);
    }
  "

exec node "$app_root/server/dist/main.js" "$@"
