# tests

Read the root [AGENTS.md](../AGENTS.md) first. This file adds the rules of
this directory. The recipe for a whole feature is in
[docs/development/feature-workflow.md](../docs/development/feature-workflow.md).

## Purpose

The two suites that need more than one package: the integration tests against
a real PostgreSQL service and a real server, and the browser journeys.

## What lives here and what does not

- `integration/` holds one file per area. `integration/support/` holds the
  disposable database, the identity provider, the listening server, and the
  Tailwind compiler of the web build.
- `e2e/` holds the browser journeys. `e2e/support/` holds the per worker
  application stack and the account helpers.
- A unit test does not live here. It lives next to its module in a package
  `src` tree and runs under `pnpm test:unit`.

## Allowed imports

Any workspace package, because this tree is the top of the graph. A test calls
a generated operation or `app.inject()`, never a handwritten HTTP call.

## How to add a common thing here

- **An integration test.** Add `integration/<area>.test.ts` with a database
  from `support/database.ts` and a server from `support/server.ts`. Run
  `pnpm test:integration -- <area>` after `tools/test-database/ensure-postgres.sh`.
- **A browser journey.** Add `e2e/<journey>.spec.ts` and use the `stack`
  worker fixture from `support/stack.ts`, which owns its own database and its
  own port. Drive the interface through roles and accessible names.
- **A reader journey.** Open a published address in a second browser context,
  which holds no session, and move a link or a ticket past its life with
  `stack.runPublicationRetention`, never with a delay.
- **A first user test.** Start with an empty database and use the real setup
  screen. Do not create the account through a test only bootstrap route.

## Testing conventions here

`integration` runs under `node --test` through `pnpm test:integration`, which
starts the PostgreSQL service of `compose.test.yaml` and builds first. Each
file makes its own disposable database. `e2e` runs under `pnpm test:e2e` over
chromium, firefox, webkit and emulated phone and tablet viewports. A test
proves the result through the public interface and checks the server state.

`pnpm test:e2e` runs several workers at the same time, and each one owns its
stack. The journeys of one file keep their written order, but the order of the
files can change, so a journey gives every note and every folder a name of its
own and depends on nothing another file wrote. See
[decision 0036](../docs/decisions/0036-the-browser-gate-runs-in-parallel-workers.md).

## Forbidden here

- No `fetch`, no `axios`, and no other handwritten transport. Use a generated
  operation, or `app.inject()` for a request that no operation can express.
- No fixed delay. Wait for a condition, a locator, or a state. A journey that
  needs a return to the window sends `blur` and then `focus`, because the
  harness cannot make a window active and `bringToFront` sends no event.
- No weakened assertion and no skipped failing test.
- No shared database between test files, and no leaked temporary directory.
- No dependence on a test only route in a browser journey.
- No assertion on an internal identifier that a person never sees.
- No browser journey that reads a note, a folder, or a trash row that another
  file wrote.

## Key files

| File                                          | Purpose                                 |
| --------------------------------------------- | --------------------------------------- |
| `integration/support/`                        | The disposable database and the server  |
| `integration/contract.test.ts`                | Every operation and its handler         |
| `integration/row-access.test.ts`              | The row access policies                 |
| `integration/published-write-refusal.test.ts` | Every write, with a published token     |
| `e2e/published-link.spec.ts`                  | The reader with no session              |
| `e2e/published-access.spec.ts`                | The password, the expiry and Revoke     |
| `e2e/support/stack.ts`                        | One owned application stack per worker  |
| `../playwright.config.ts`                     | The browser matrix and the worker count |
