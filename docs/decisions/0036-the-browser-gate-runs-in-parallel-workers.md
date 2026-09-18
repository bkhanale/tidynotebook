# 0036. The browser gate runs in parallel workers

- Status: Superseded by [0066](0066-the-browser-suite-is-retired.md)
- Date: 2026-09-15

## Context

`playwright.config.ts` ran the browser matrix in one worker, so the five
projects of the matrix went one journey at a time. The suite already gives each
worker its own stack through `tests/e2e/support/stack.ts`, so the one worker
limit bought nothing that the fixture did not already give.

Two defects kept the suite from running wider. The migration advisory lock in
`packages/storage-server/src/migrate.ts` belongs to one database, but a role is
a cluster wide object, so two stacks that migrated together refused each other.
The port reservation in `tests/e2e/support/stack.ts` closed its socket before
the application listened, so two stacks could pick the same port.

## Decision

The browser gate runs one worker for each pair of cores, with two as the floor
and four as the ceiling. `playwright.config.ts` holds that count.
`fullyParallel` stays off, so the journeys of one file keep their written order
on the stack of their worker.

The role password statement in `packages/storage-server/src/migrate.ts` runs
again when PostgreSQL reports a busy catalog row. The stack takes the next free
port when the operating system refuses the one it reserved. A journey that
needs two versions closes each one with the visible Control and S accelerator,
because a version otherwise closes on a pause in typing and two quick edits
become one version.

The budget of one journey holds a browser that shares its machine. One
assertion still has to settle inside ten seconds, so a wrong screen fails fast.

## Consequences

- The gate proves the same journeys and finishes in a fraction of the time.
- A journey must not depend on a note, a folder, or a trash row that another
  file wrote, because the order of the files across the workers can change.
- The test cluster serves up to four stacks of one run at the same time, plus
  the extra stack of the first user journey. The ceiling keeps that inside the
  connection limit of the disposable service in `compose.test.yaml`.
- `tests/integration/concurrent-migrations.test.ts` holds the migration rule in
  place. It fails when the role password statement stops running again.
