# 0180. A start that fails shows the application error screen

- Status: Accepted
- Date: 2026-10-03

## Context

A full load of a note address showed a white page on a few loads in each
thousand. A loop of loads in `tools/performance` found the cause. Each blank
load was a load that the service worker controlled (record 0044), and a
module of the entry, such as the main module or one of its imports, ended as
an aborted request a few milliseconds after the navigation. The built shell
asks for the modules of the entry twice: through the `modulepreload` links
that Vite writes and through the module script. On a controlled load both
requests reach the worker, and the browser aborted one of them. The module
graph of the entry then failed. With the worker blocked, and with the
preload links removed from a controlled load, the same loop showed no blank
load.

A failure before the first render reaches no route boundary of record 0161,
because React draws nothing yet. A module that does not arrive, an error
while the entry runs, or a rejected promise of the start therefore left the
root empty, and the person saw a white page with no action.

## Decision

- The shell writes the `modulepreload` links of the entry only on a load that
  the worker does not control. A small inline script of the shell reads
  `navigator.serviceWorker.controller` and adds the links when it is empty.
  A controlled load reads its modules from the precache through the module
  script alone, so one request reaches the worker for each module.
  `apps/web/src/pwa/module-preload.ts` holds the rewrite of the built shell.
- An inline script of the shell watches the start until React draws. A
  module script that does not load shows the load failure screen of record
  0161, and an error or a rejected promise shows its stop screen. Both
  screens are drawn at build time from `apps/web/src/start-failure.ts`,
  which uses `routeErrorScreen` and the `Page`, `PageHeader` and `Button` of
  `packages/ui`, so the start failure and a route failure are one screen.
  Reload is the one action.
- The screen shows into an empty root only. The first render of React takes
  the root back, so the watch changes nothing on a start that succeeds.

This refines records 0044 and 0161. It excludes a retry of a module import
and a worker that answers a module from the network when the precache holds
it.

## Consequences

- No full load leaves a white page: a start either draws the application or
  states that it did not load and offers Reload.
- The first load of a browser, which no worker controls, keeps the preload
  of the entry. A controlled load asks the precache for each module in turn,
  which costs little because each answer is local.
- `apps/web/src/pwa/module-preload.test.ts` holds the rewrite,
  `apps/web/src/start-failure.test.ts` the two screens, and
  `tests/integration/web-build.test.ts` the built shell.
