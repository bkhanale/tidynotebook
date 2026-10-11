# 0202. The image takes a migrate and a serve command

- Status: Accepted
- Date: 2026-10-04

## Context

`docker/entrypoint.sh` always applies the migrations with the migration role
and then starts the server. On the cloud a serving replica must not hold the
migration credential, and the migration must run once for each deploy, not in
each replica (record 0199). See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- `docker/entrypoint.sh` takes one optional command:
  - `migrate` applies the migrations with the migration role and exits;
  - `serve` starts the server with the runtime role and reads no migration
    setting;
  - with no command, it migrates and then serves, as today.
- The readiness probe still checks the schema version, so a `serve` replica
  that starts before its migration never reports ready.
- A self-hosted installation changes nothing.

## Consequences

- The cloud runs `migrate` as its own service and `app` with `serve`.
- A container test starts `serve` with no migration credential and proves
  that it serves, and proves that `migrate` exits after the migrations.
