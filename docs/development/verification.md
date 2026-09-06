# Implementation verification

This record covers the Task 22 implementation gate. It does not contain E2E,
device, or release evidence. Those checks need the separate Task 23 approval
and the Task 24 environments.

## Complete implementation review

The review checked the design against the source and the named test suites.

| Area                            | Evidence                                                                                                                                                                                                                                                                            | Result                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Package imports                 | `tools/check-boundaries.mjs` checks cycles, deep imports, browser to server imports, and application HTTP calls outside generated output.                                                                                                                                           | Pass                                 |
| Request and response validation | `contract.test.ts` checks operation coverage, media types, closed write bodies, invalid input, response shape, cancellation, and identity hooks.                                                                                                                                    | Pass                                 |
| Roles and scope                 | Identity, row access, revision, history, sharing, and MCP integration tests check workspace grants and database row policies.                                                                                                                                                       | Pass                                 |
| Replay order                    | Revision, attachment, history, and sync tests check receipt replay before current preconditions and retain one immutable request digest.                                                                                                                                            | Pass                                 |
| Immutable history               | Core graph checks and storage constraints reject changed revision identities and invalid parents. History tests check restore and purge behavior.                                                                                                                                   | Pass                                 |
| Multi-file atomicity            | Storage, revision, history, and sync tests force failed changesets and conflict groups and check that no partial state remains.                                                                                                                                                     | Pass                                 |
| Local draft preservation        | Browser storage and offline lifecycle tests check transaction rollback, quota failure, later drafts after acknowledgment, recovery copies, and account partitions. Task 22 added direct cached note opening so an offline route uses the newest local draft before any server read. | Pass at module and integration level |
| Cleanup and purge races         | Attachment and history tests check reference locks, cleanup retries, purge blockers, share removal, quota release, and late writes after purge.                                                                                                                                     | Pass                                 |

The review found two measured implementation defects and one local opening
defect. Concurrent searches were serialized by a workspace write lock. Search
also could not use the GIN index efficiently through the forced row policy.
Read-only transactions now skip the write lock, and migration `0010` adds a
permission-checked indexed search function. Search results use a bounded source
preview after the indexed match, so they do not parse 50 full Markdown files a
second time. The note route now reads a cached note or newest local draft before
it uses the generated server operation. Cached tombstones stay explicit, so a
deleted local note cannot reopen old accepted content.

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

CI installs pnpm 12.3.4, uses the frozen lockfile, starts the disposable
PostgreSQL service, runs the complete gate, enforces both performance commands,
and always removes the disposable volume. The workflow pins official actions
to full commit identifiers. It contains no E2E job or browser tooling.

## Service performance

Command: `pnpm perf:service`.

The 2026-09-06 local run used Node 26.8.1 on Linux x64. The measurement process
ran with a two CPU cgroup limit, a 4 GiB memory limit, and 20 active users.
PostgreSQL was version 18.6. The disposable corpus held 10,000 ordinary notes
from exactly 5 KiB through 20 KiB, plus one exact 1,048,576 byte stress note.
No note content was printed.

| Operation           | Samples |    Percentile |       Budget | Result |
| ------------------- | ------: | ------------: | -----------: | ------ |
| Save service time   |     100 | p95 189.45 ms | below 200 ms | Pass   |
| Search service time |     100 |  p95 26.34 ms | below 300 ms | Pass   |

Save load used one workspace per active user because accepted changes in one
workspace have a required total order. Search load used one shared workspace
with all 10,000 notes. The GIN index performs the full text match before the
query returns a source-preserving preview of at most 1,024 characters. The
report records the model so it does not claim a different contention pattern.

## Web bundle

Command: `pnpm perf:bundle`.

The budget script builds the production web application, reads only JavaScript
referenced by the built `index.html` script and module preload tags, compresses
each file with gzip level 9, and excludes deferred editor and rich rendering
chunks. The 2026-09-06 final run measured 144,544 bytes against the 256,000
byte budget. Result: Pass.

## Local interaction checks

The following Node module and IndexedDB adapter checks use 60 samples each.
They enforce the local code budgets, but they do not include browser paint,
real storage durability, device scheduling, or IME behavior.

| Check                                                   | Samples |  Percentile |       Budget | Result |
| ------------------------------------------------------- | ------: | ----------: | -----------: | ------ |
| Editor typing transaction and changed-line preview scan |      60 | p95 3.13 ms |  below 50 ms | Pass   |
| Local draft save with fake IndexedDB                    |      60 | p95 0.25 ms | below 150 ms | Pass   |
| Cached note read with fake IndexedDB                    |      60 | p95 0.15 ms | below 150 ms | Pass   |

The web client also records bounded User Timing measures named
`notesapp.typing-handler`, `notesapp.local-draft-save`, and
`notesapp.cached-note-open`. Live preview scans visible full lines only. Rich
widgets keep oversized content as editable source.

## Local browser sample

A temporary official Chrome for Testing 152.0.7977.82 linux64 binary measured
the production build through the real notesapp HTTP boundary and its test
identity adapter. Five warm loopback runs loaded the signed-out login route and
sent one input interaction. No browser package, harness, configuration, or test
file was added to the repository.

| Check                     | Samples | Percentile |         Budget | Result |
| ------------------------- | ------: | ---------: | -------------: | ------ |
| Largest Contentful Paint  |       5 |  p75 44 ms | below 2,500 ms | Pass   |
| Interaction to Next Paint |       5 |  p75 24 ms |   below 200 ms | Pass   |

Three interaction samples had no Event Timing entry at Chrome's 16 ms minimum
threshold. The calculation used 15.99 ms as an upper bound for those samples.
This small headless sample covers only the signed-out page on a fast local
connection. It is not field data and does not represent the editor, a phone,
real network delay, or storage work.

## Browser and device evidence still required

Task 23 must first receive explicit E2E authorization. Task 24 must then record
the supported browser matrix, real device samples, editor LCP and INP, storage
durability, accessibility, security, restore, and full operational evidence.
The application is not release ready while that evidence is absent.
