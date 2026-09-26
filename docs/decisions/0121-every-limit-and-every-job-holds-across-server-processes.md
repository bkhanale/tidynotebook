# 0121. Every limit and every job holds across server processes

- Status: Accepted
- Date: 2026-09-26

## Context

`apps/server/src/plugins/attempt-store.ts` counts attempts in the memory of one
process. The Better Auth rate limit uses memory storage. The cleanup jobs of
`apps/server/src/app.ts` run on a timer in each process. A deployment without
downtime runs two processes for a time, and a public service runs several. The
sync path already keeps its state in PostgreSQL. See
[design 016](../design/016-a-public-service.md).

## Decision

The attempt counters live in PostgreSQL. `attempt-store.ts` stays the one file
that knows where, and it writes through one function that the runtime role may
execute. Better Auth keeps its rate limit in its database storage, in the
identity schema.

Each background job takes a PostgreSQL advisory lock for its run. A process
that does not get the lock skips that run.

No Redis is added. PostgreSQL already holds every shared fact of the product. A
later measurement can move the counters, and the attempt store is where that
change goes.

## Consequences

- A limit holds across processes and across a restart.
- Each counted attempt costs one write. Only the identity routes and the reader
  path count attempts.
- An integration test proves that two server instances share one count, and
  that two instances run one job once.
