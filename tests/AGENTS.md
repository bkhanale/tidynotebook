# tests

Read the root [AGENTS.md](../AGENTS.md) first. This file adds the rules of
this directory. The recipe for a whole feature is in
[docs/development/feature-workflow.md](../docs/development/feature-workflow.md).

## Purpose

The two suites that need more than one package: the integration tests against
a real PostgreSQL service and a real listening server, and the Playwright
browser journeys.

## What lives here and what does not

- `integration/` holds one file per area. `integration/support/` holds the
  disposable database, the identity provider, and the listening server.
- `e2e/` holds the browser journeys. `e2e/support/` holds the per worker
  application stack and the account helpers.
- A unit test does not live here. It lives next to its module in a package
  `src` tree and runs under `pnpm test:unit`.

## Allowed imports

Any workspace package, because this tree is the top of the graph. The
transport rules still apply here: a test calls a generated operation or
`app.inject()`, never a handwritten HTTP call.

## How to add a common thing here

- **An integration test.** Add `integration/<area>.test.ts`. Take a
  disposable database from `support/database.ts` and a listening server from
  `support/server.ts`. Run it with
  `pnpm test:integration -- <area>` after `tools/test-database/ensure-postgres.sh`.
- **A browser journey.** Add `e2e/<journey>.spec.ts` and use the `stack`
  worker fixture from `support/stack.ts`, which owns its own database and its
  own port. Drive the interface through roles and accessible names.
- **A first user test.** Start with an empty database and use the real setup
  screen. Do not create the account through a test only bootstrap route.

## Testing conventions here

`integration` runs under `node --test` through `pnpm test:integration`, which
starts the PostgreSQL service from `compose.test.yaml` and builds first. Each
integration file creates its own disposable database, so files do not share
state. `e2e` runs under `pnpm test:e2e` across chromium, firefox, webkit, and
a 390 px phone viewport. A test must prove the result through the public
interface and check the server state, not an internal call.

## Forbidden here

- No `fetch`, no `axios`, and no other handwritten transport. Use a generated
  operation, or `app.inject()` for a request that no operation can express.
- No fixed delay. Wait for a condition, a locator, or a state.
- No weakened assertion and no skipped failing test.
- No shared database between test files, and no leaked temporary directory.
- No dependence on a test only route in a browser journey.
- No assertion on an internal identifier that a person never sees.

## Key files

| File                              | Purpose                                |
| --------------------------------- | -------------------------------------- |
| `integration/support/database.ts` | One disposable database per test file  |
| `integration/support/server.ts`   | A real listening server                |
| `integration/contract.test.ts`    | Every operation and its handler        |
| `integration/row-access.test.ts`  | The row access policies                |
| `e2e/support/stack.ts`            | One owned application stack per worker |
| `../playwright.config.ts`         | The browser matrix                     |
