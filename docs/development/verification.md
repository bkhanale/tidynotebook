# Verification

This document lists the checks, the commands that run them and the budgets
they enforce. It records no measured value. A measurement belongs in the
report that the command writes, not in prose, because prose does not fail when
the code changes.

## Automated gate

The root `pnpm verify` command runs these checks in order:

1. OpenAPI contract lint.
2. Generated file comparison.
3. Strict TypeScript compilation.
4. Exact version checks, type-aware lint, and package boundaries.
5. Formatting.
6. Unit tests.
7. Integration tests against disposable PostgreSQL.
8. All production builds.

CI installs the pinned pnpm version, uses the frozen lockfile, starts the
disposable PostgreSQL service, runs the complete gate, enforces both
performance commands, and always removes the disposable volume. The workflow
pins official actions to full commit identifiers.

## End-to-end browser gate

The browser gate starts the production web build and the real Fastify server
against a unique PostgreSQL database and storage directory for each worker. It
creates the session through the visible login form. The tests use the real
IndexedDB store, generated API client, and sync engine.

Ensure that the test database is ready before the gate:

```sh
tools/test-database/ensure-postgres.sh
```

Install the supported browser runtimes and their host packages once:

```sh
pnpm exec playwright install
pnpm exec playwright install-deps
```

Run the complete matrix with:

```sh
pnpm test:e2e
```

Use `pnpm test:e2e:headed` for an interactive Chromium run. Failed and retried
runs put traces, screenshots, and videos in `test-results/playwright`. The
HTML report is in `playwright-report` and the machine readable result is
`test-results/playwright/results.json`. CI publishes both as artefacts. Read
the count of checks from that report.

The projects are defined in `playwright.config.ts`. They cover desktop
Chromium, Firefox and WebKit, plus emulated phone and tablet viewports. An
emulated viewport verifies responsive layout and touch settings. It is not
evidence from a physical device.

The critical journeys include first-user setup, login styles, responsive
overflow, drawer focus, create, save, reload, rename, delete, trash restore,
offline reload, reconnect sync, version history and restore, search, and
outline. The capability test removes `crypto.randomUUID` and `crypto.subtle`
before application startup to match the reduced API surface of a plain HTTP
local-network origin.

## What each area proves

| Area                            | Evidence                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package imports                 | `tools/check-boundaries.mjs` checks cycles, deep imports, browser to server imports, and application HTTP calls outside generated output.         |
| Request and response validation | `contract.test.ts` checks operation coverage, media types, closed write bodies, invalid input, response shape, cancellation, and identity hooks.  |
| Row access                      | Identity, row access, revision, and history integration tests check the database row policies.                                                    |
| Replay order                    | Revision, attachment, history, and sync tests check receipt replay before current preconditions and retain one immutable request digest.          |
| Immutable history               | Core graph checks and storage constraints reject changed revision identities and invalid parents. History tests check restore and purge behavior. |
| Multi-file atomicity            | Storage, revision, history, and sync tests force failed changesets and check that no partial state remains.                                       |
| Local draft preservation        | Browser storage and offline lifecycle tests check transaction rollback, quota failure, later drafts after acknowledgment, and recovery copies.    |
| Stale draft and stale delete    | Browser storage and sync tests check that a draft over an older head is reported and that a stale delete does not remove newer text.              |
| Cleanup and purge races         | Attachment and history tests check reference locks, cleanup retries, purge blockers, side-record removal, quota release, and late writes.         |

## Service performance

Command: `pnpm perf:service`.

The command builds the server, starts a disposable PostgreSQL, and measures
the save and search paths in a container with a two CPU limit and a 4 GiB
memory limit. The corpus is generated, and no note content is printed.

| Operation           | Budget           |
| ------------------- | ---------------- |
| Save service time   | p95 below 200 ms |
| Search service time | p95 below 300 ms |

Save load uses one workspace for each active user, because accepted changes in
one workspace have a required total order. Search load uses one shared
workspace with all notes. The command fails when a budget is exceeded and
prints the measured percentile.

## Web bundle

Command: `pnpm perf:bundle`.

The budget script builds the production web application, reads only JavaScript
referenced by the built `index.html` script and module preload tags, compresses
each file with gzip level 9, and excludes deferred editor and rich rendering
chunks. Deployable assets use `apps/web/dist/web`; TypeScript package output
uses `apps/web/dist`. Vite cleans the deployable directory on every build, so
old hashed assets cannot collect in the service worker precache.

| Check                    | Budget              |
| ------------------------ | ------------------- |
| Initial JavaScript, gzip | below 256,000 bytes |

The command prints the measured size and fails when the budget is exceeded.

## Local interaction checks

The Node module and IndexedDB adapter checks enforce the local code budgets.
They do not include browser paint, real storage durability, device scheduling,
or IME behavior.

| Check                                                   | Budget       |
| ------------------------------------------------------- | ------------ |
| Editor typing transaction and changed-line preview scan | below 50 ms  |
| Local draft save with fake IndexedDB                    | below 150 ms |
| Cached note read with fake IndexedDB                    | below 150 ms |

The web client also records bounded User Timing measures named
`notesapp.typing-handler`, `notesapp.local-draft-save`, and
`notesapp.cached-note-open`. Live preview scans visible full lines only. Rich
widgets keep oversized content as editable source.

## Evidence limits

The automated matrix is not physical-device evidence. A release assessment
must still sample the supported physical devices, persistent storage behavior,
accessibility tools, security controls, and restore procedure in its target
environment.
