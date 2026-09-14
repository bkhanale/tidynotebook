# Verification

This page states what each check proves and where its result is written. It
records no measured value and no test count. A measurement belongs in the
report that the command writes, because prose does not fail when the code
changes.

## The gate

`pnpm verify` runs the contract lint, the generated file comparison, the strict
type check, the lint set, the format check, the unit tests, the integration
tests against a disposable PostgreSQL, and every production build. It must pass
before a change is ready.

Start the disposable database once with `tools/test-database/ensure-postgres.sh`.
It is safe to run again and safe to run while another checkout uses the same
service.

Select a subset by name while you work, for example
`pnpm test:integration -- browser-storage`. Every supplied selector must exist,
so a typo fails rather than running nothing. A suite with no test prints an
explicit message; it never claims that tests passed.

Unit test discovery covers `.ts` and `.mjs` test files only, because Node
cannot strip JSX. A React component is therefore proved by a unit test over the
pure functions behind it and by the browser gate, never by a component test
runner.

## Coverage

The test runner of Node measures coverage on each unit and integration run, and
it prints the report after the results. `tools/run-tests.mjs` sets the flags.
The report shows the product source only: it excludes the test files, the
generated clients, and the build output.

The report is a measurement, not a gate. No coverage threshold can fail the
run, so a number in the report never blocks a change. Read the report to find
the code that no test touches.

Turn the report off for a short result while you work:

```sh
NOTESAPP_COVERAGE=off pnpm test:unit
```

## The browser gate

`pnpm test:e2e` is the gate for the user interface. See
[decision 0014](../decisions/0014-browser-tests-are-the-interface-gate.md).

The gate starts the production web build and the real server against a unique
database and storage directory for each worker, and it creates the session
through the visible login form. The tests use the real IndexedDB store, the
generated client, and the sync engine, so nothing is stubbed below the
interface.

`playwright.config.ts` defines the projects: the desktop browsers plus emulated
phone and tablet viewports. An emulated viewport verifies responsive layout and
touch settings. **It is not evidence from a physical device.**

Install the browser runtimes and their host packages once:

```sh
pnpm exec playwright install
pnpm exec playwright install-deps
```

Failed and retried runs write traces, screenshots, and videos, and the machine
readable result sits next to the HTML report under `test-results/`. Read the
count of checks from that report, not from a document.

## What each area proves

| Area                            | Evidence                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Package imports                 | `tools/check-boundaries.mjs` and its fixture test.                                  |
| Request and response validation | `tests/integration/contract.test.ts`, including the operation coverage mapping.     |
| Row access                      | The identity, row access, revision, and history integration tests.                  |
| Replay order                    | The revision, attachment, history, and sync tests over receipts and preconditions.  |
| Immutable history               | The core graph tests and the storage constraints, plus restore and purge behaviour. |
| Multi-file atomicity            | Forced failed changesets in the storage, revision, history, and sync tests.         |
| Local draft preservation        | The browser storage and offline lifecycle tests over rollback, quota, and recovery. |
| Stale draft and stale delete    | The browser storage and sync tests.                                                 |
| Cleanup and purge races         | The attachment and history tests over reference locks, retries, and late writes.    |
| One Markdown grammar            | `tests/integration/markdown-equivalence.test.ts` over the shared corpus.            |
| Documents                       | `tools/check-docs.mjs` over the rules in [the document index](../README.md).        |

## Performance

Two commands hold a budget, and each prints its measurement and fails when the
budget is exceeded. The budgets live in the scripts, so they cannot go stale
here.

- `pnpm perf:service` builds the server, starts a disposable PostgreSQL, and
  measures the save and the search path in a container with a fixed CPU and
  memory limit. The corpus is generated, and no note content is printed. Save
  load uses one workspace per active user, because accepted changes in one
  workspace have a required total order. Search load uses one shared workspace.
- `pnpm perf:bundle` builds the production web application and measures the
  compressed JavaScript that the first route actually loads, excluding the
  deferred editor and rich rendering chunks.

The local interaction checks bound the typing transaction, the local draft
save, and a cached note read, using the Node adapters. They do not include
browser paint, real storage durability, device scheduling, or input method
behaviour. The web client also records bounded user timing measures with the
same names, so a browser profile can be compared with them.

## Evidence limits

The automated matrix is not physical-device evidence. A release assessment must
still sample the supported physical devices, persistent storage behaviour,
accessibility tools, security controls, and the restore procedure in the target
environment. The restore test is the one that a backup depends on: see
[Backup and restore](../guide/backup-and-restore.md).
