# 0066. The browser suite is retired

- Status: Accepted
- Date: 2026-09-18

## Context

The Playwright suite under `tests/e2e` cost more wall clock than it returned.
A full matrix ran five projects, and each worker of each project started a
production web build, a real server, a database of the test cluster, a storage
directory and a browser. The run stood in front of every landing. The owner
decided on 2026-09-18 that the price is higher than the proof.

## Decision

The repository holds no browser test. `tests/e2e`, `playwright.config.ts`, the
`@playwright/test` dependency and the `test:e2e` scripts are gone.

`pnpm verify` is the verification gate. It runs the contract lint, the
generated file comparison, the strict type check, the lint set, which holds
`tools/check-design-rules.mjs` as the design gate, the format check, the unit
tests beside each module, the integration tests against a real PostgreSQL
service and a real server, every production build, and the type aware lint.

What a person sees is proved at two levels. The pure module that decides it
carries a unit test: a class recipe in `packages/ui/src/control-classes.ts`, a
layout rule in `apps/web/src/lib/`, a derived value in
`packages/ui/src/theme.ts`. An integration test reads the built or served
result: the stylesheet in `tests/integration/theme-variables.test.ts` and
`tests/integration/published-styles.test.ts`, and the document in
`tests/integration/web-delivery.test.ts` and
`tests/integration/published-page.test.ts`.

This record supersedes [0014](0014-browser-tests-are-the-interface-gate.md) and
[0036](0036-the-browser-gate-runs-in-parallel-workers.md).

## Consequences

- A landing costs one `pnpm verify`, and no machine installs a browser.
- Four things lose their automatic proof, and the gate refuses a defect in
  none of them: keyboard behaviour in a real browser, the offline path of the
  service worker, editor rendering, and the layout at a phone width.
- Those four rest on manual review. Before a branch lands, drive each screen
  that the change touches and take a screenshot of it in light and in dark.
- A defect that a person finds gets its regression test at the level that can
  hold it: the pure module, or the built or served result.
- `tests/` holds the integration suite only. `tests/AGENTS.md` states that.
