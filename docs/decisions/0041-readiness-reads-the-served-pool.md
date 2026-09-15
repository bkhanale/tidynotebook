# 0041. Readiness reads the pool that the deployment serves from

- Status: Accepted
- Date: 2026-09-16

## Context

The database probe and the migration probe each opened a `pg.Client` of their
own on every call, and each held the SQL of that read inside `apps/server`.
Finding 11 of the
[architecture review of 2026-09-11](../audits/2026-09-11/architecture-review.md)
names both costs. An orchestrator repeats a readiness request every few
seconds for the life of the process, so the probe was a steady source of new
connections, and it proved nothing about the pool that a real request uses. The
rule in `apps/server/AGENTS.md` also says that every statement belongs to
`packages/storage-server`.

## Decision

Readiness reads the database through the pool that already serves the workspace
traffic.

- `WorkspaceStoreHandle.probeDatabase` in
  `packages/storage-server/src/workspace-store/index.ts` borrows one pooled
  connection, runs a trivial statement, then reads the applied migration count.
  It answers a state instead of throwing, because an unreachable database is a
  readiness answer and not a fault. It holds the two statements, so no SQL
  stays in `apps/server`.
- The read runs the trivial statement first, so a pool that hands over a
  connection cannot report a database that answers nothing.
- `databaseProbes` in `apps/server/src/routes/health.ts` builds the database
  check and the migration check over one shared bounded read, so one readiness
  request makes one round trip and opens no connection. The migration check
  compares the count with `requiredSchemaVersion`, as before.
- The read carries a deadline, because a host that drops every packet answers
  never and the probe must still report.
- A draining process answers before any probe runs, so the stop closes the
  pools with no probe work in flight.

This excludes a second pool for the probes, and it excludes a probe that
reports ready because a connection was handed over.

## Consequences

A readiness request costs one pooled round trip, and it exercises the path that
a real request takes. A pool that is exhausted now delays the probe until its
deadline, which reports a degraded database; that is the honest answer, because
a request would wait as well.

`apps/server/src/routes/health.test.ts` proves the decision for every state:
reachable, unreachable, an incomplete schema, no schema version, a read that
passes its deadline, and a draining process.
`tests/integration/operations.test.ts` caps a disposable database at the
connections that the pool already holds, so a probe that opened one of its own
would be refused.
