# 0090. Every connection pool comes from one factory

- Status: Accepted
- Date: 2026-09-23

## Context

The server opened four `pg.Pool` instances: the workspace store, the identity
store, the attachment store, and the pool of the identity protocol. None had a
listener for `error`. A pool emits `error` when PostgreSQL ends an idle
connection, on a restart, a failover or an operator command. An emitter with
no listener throws, so the process stopped on an event that the next query
recovers from by itself.

`end()` of a pool resolves as soon as it asks each client to close, before a
socket closes. `dropTestDatabase` then ended the sessions that were still
closing, and each client raised the same error. That was the teardown failure
of `tests/integration/revisions.test.ts` under load.

## Decision

`openPool` in `packages/storage-server/src/pool.ts` is the one place that
constructs a pool. Its pool keeps a listener for the error of an idle client,
and its `end()` resolves only when every client it opened has closed.

`tools/check-boundaries.mjs` refuses a `new Pool` or a `new pg.Pool` in any
other source file. A test may still build a bare pool.

## Consequences

An idle connection that the database ends no longer stops the server. A caller
that closes a store and then removes the database ends no live session.

`tests/integration/pool.test.ts` proves both rules on the factory and on every
pool of the server. Each of its tests failed with a bare pool.
