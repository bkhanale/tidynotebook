# 0207. Every secret of the image has an environment form

- Status: Accepted
- Date: 2026-10-05

## Context

The cloud runs the public image on Railway (records 0199, 0205), and Railway
gives a service environment variables only. It cannot mount a file. The server
reads five secrets as a variable or as its `_FILE` form, never both, through
`protectedFiles` and `loadProtectedEnvironment` in `apps/server/src/config.ts`.
The operator secret of record 0190, the S3 key pair of record 0192, and the
three secrets of the `migrate` command of record 0202 are file only, so the
image cannot run on such a platform without a step that writes a file.

## Decision

- Each secret that the image reads takes the variable or its `_FILE` form,
  never both: `NOTESAPP_OPERATOR_TOKEN`, `NOTESAPP_S3_ACCESS_KEY_ID` and
  `NOTESAPP_S3_SECRET_ACCESS_KEY` for `serve`, and
  `NOTESAPP_MIGRATION_DATABASE_URL`, `NOTESAPP_RUNTIME_PASSWORD` and
  `NOTESAPP_AUTH_PASSWORD` for `migrate`, each with its `_FILE` twin.
- The rules of `protectedFiles` hold for each pair. An empty value is not set.
  Both forms stop the start, and the message names both. A file that cannot be
  read or that is empty stops the start. A file loses the space around its
  value.
- `protectedFiles` holds the three pairs of `serve`, so
  `loadProtectedEnvironment` reads every secret of the server before the
  composition starts, and `loadServerConfig` checks the operator secret. The
  configuration value then holds the secret, as it holds `authSecret`.
- The deploy profile of `packages/storage-server/src/migrate.ts` reads the
  three pairs of `migrate` by these names, through one rule in
  `packages/storage-server/src/profiles.ts`. It no longer reads
  `NOTESAPP_DATABASE_URL_FILE`, so the runtime address of a container that
  migrates and serves never reaches the migration. `docker/entrypoint.sh`
  names the default file under `/run/secrets` for a secret that has neither
  form, and nothing more.
- `serve` reads no migration setting (record 0202).
- What stays: a file is the recommended form for Compose, and
  `docker-compose.yml` sets no variable form. No value reaches a log, an error
  message or a process argument.

This refines records 0190, 0192 and 0202. For a service of the operator it is
an addition (`docs/development/operator-api.md`): each new variable is a
setting whose absence keeps the old behaviour, and each `_FILE` setting keeps
its meaning.

## Consequences

- The cloud sets the variable form on Railway and mounts no file.
- A message about a secret names the form that the operator set.
- `apps/server/src/config.test.ts` proves each pair of the server,
  `packages/storage-server/src/profiles.test.ts` each pair of the migration,
  and `tests/image/commands.test.ts` runs `migrate` and `serve` with
  variables only and no secret file.
