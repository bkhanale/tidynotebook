# Architecture audit of the whole repository

- Date: 2026-09-23
- Commit read: 4bf918d

This audit reads the whole repository for a stable architecture, industry
standard practice, best practice and modularity. It also gives the status at
this commit of each finding of the
[architecture review of 2026-09-11](../2026-09-11/architecture-review.md),
which read commit `107b36a`, 337 commits earlier. A finding names the code by
path and line. A finding is not a fix: each defect becomes an issue on the
[GitHub project board](https://github.com/users/bkhanale/projects/2).

## How the audit ran

Six read-only reviews ran in parallel, one for each area: the server and the
PostgreSQL storage, the domain and the sync engine, the web application, the
editor and Markdown and UI packages, the browser store and the contract, and
the tooling and the gate. Each review read the directory guides and the
decision records of its area before the code. The owner of this audit then
read the code of each finding that is marked "(checked)" a second time. A
finding without that mark comes from one review only.

No test, build or container ran for this audit. The gate duration and the
runtime behaviour of the container image are not measured here.

## Verdict

No finding blocks a release. The base of the architecture stays above the
usual standard:

- `tools/check-boundaries.mjs` parses the source and fails `pnpm lint` on a
  forbidden import.
- The server checks every request and every response against the contract.
- Three PostgreSQL roles and forced row level security protect each
  workspace.
- The compiler is strict, and the code has no type assertion other than
  `as const`.

Most findings of the 2026-09-11 review are fixed. The risk has moved to two
places. First, the move to the document model of records 0076 to 0088 is not
complete in `packages/sync`, and old save model paths remain beside it.
Second, the CI workflow is off and the browser suite is retired, so no
automatic check stands between a `v*` tag and a published image.

## Fix first

These findings can lose work, weaken security, or stop the application.

### Sync and local data

1. (checked) A batch retry after a lost reply sends a different body.
   `submitBatch` marks only the first entry as sending, with the digest of the
   whole batch (`packages/sync/src/queue.ts:662-663`). The next cycle sees a
   `sending` head and sends that entry alone (`queue.ts:620-621`). When the
   lost batch did commit, the server answers `mutation_reused`
   (`packages/core/src/files/commit.ts:354-355`), and accepted work goes to
   Needs attention. This breaks record 0085. Fix: store the member mutation
   ids with the frozen digest and send that exact batch again.
2. (checked) One note that is too large blocks the whole queue.
   `submissionAction` maps every 413 to `leave` (`queue.ts:258`), and each
   cycle sends only the head entry (`queue.ts:618-625`).
   `document_too_large` is also a 413
   (`apps/server/src/plugins/problem.ts:297`), so no later save of the
   workspace goes out. Record 0084 forbids this. Fix: keep `quota_exceeded`
   apart from `document_too_large`, park the second, and continue.
3. Unsent work on a purged note is deleted with no notice. A `purged` refusal
   calls `forgetPurgedFiles` (`queue.ts:767-777`), which removes drafts,
   checkpoints, queue entries and recovery copies
   (`packages/storage-browser/src/local-store/snapshot.ts:726-745`).
   `tests/integration/sync.test.ts:595-650` asserts this. Record 0083
   requires a new note with a stable identity.
4. The protocol version does not show the breaking format change.
   `syncProtocolVersion` is 1 at `v0.4.0` and at this commit
   (`packages/core/src/files/snapshot.ts:33`), and the server has no detection
   of the old save shape. A cached 0.4 client reads "compatible", and the
   upgrade path of record 0086 never starts.
5. The sender lease does not keep a second engine out. All engines of one tab
   share one owner id (`apps/web/src/app.tsx:783`, `:963`). A background
   engine that stops releases the shared lease
   (`packages/sync/src/engine.ts:519-521`) while the foreground engine still
   sends. The lease is renewed once per cycle (`engine.ts:428`), and a first
   snapshot can run longer than the 30 s lease.
6. (checked) The browser schema upgrade is not atomic across tabs.
   `ensureSchema` reads `meta` outside a transaction, writes `in-progress`
   from that value, and migrates in a second transaction
   (`packages/storage-browser/src/migrations.ts:560-588`). No Web Lock wraps
   the open. Two tabs can both read the old version, and the second can run
   `upgradeRelease04` again on migrated data.
7. A full disk shows the wrong advice. Dexie reports a full disk at commit as
   an `AbortError` that holds the `QuotaExceededError` in `inner`.
   `toLocalStorageError` reads only the outer name
   (`packages/storage-browser/src/database.ts:599-607`), so the person reads
   "did not commit" and not "Local storage is full". The test at
   `tests/integration/browser-storage.test.ts:634-660` throws only
   synchronously and misses this.

### Server and deployment

8. (checked) A zip bomb gets past the import size bound. The expanded total
   adds the size that the entry header declares, and `inflateRawSync` runs
   with no `maxOutputLength` (`apps/server/src/routes/unzip.ts:76-82`). The
   real size is compared only after the whole entry is inflated, on the event
   loop. Fix: pass `{ maxOutputLength: size }`.
9. (checked) Production sets no statement, lock or idle timeout.
   `apps/server/src/app.ts:480-483` opens the workspace store with no options,
   so `packages/storage-server/src/workspace-store/index.ts:249-257` sets no
   `statement_timeout`. A wait on the workspace advisory lock has no bound.
   The comment at `workspace-store/index.ts:107-111` says a statement timeout
   bounds the wait, which is not true.
10. (checked) The running server can read the migration credential.
    `docker-compose.yml:89-95` gives the `app` service
    `migration_database_url` and both role passwords for its whole life. The
    migration role owns the schema, so a code execution defect in the server
    can turn off row level security. Fix: run the migrations in a one-shot
    service, and give `app` only the runtime and identity secrets.
11. Engine messages and server paths reach an API answer.
    `apps/server/src/jobs/inspect-image.ts:111` returns the `execFile`
    message, the worker passes the raw sharp message
    (`inspect-image-worker.ts:133`, `:142`), and `routes/import.ts:306-310`
    passes any `Error.message`. `plugins/problem.ts:540-544` copies them into
    `detail`.
12. (checked) The default sign-in limit is loose. The custom rule for
    `/sign-in/*` (`apps/server/src/auth/better-auth.ts:158-162`) takes 100
    attempts in 60 s by default (`apps/server/src/config.ts:505-514`). It
    replaces the library default of 3 in 10 s.

### Web application and editor

13. (checked) The live document session is opened in `useMemo` and released
    in an effect (`apps/web/src/features/editor/note-editor.tsx:263-266`,
    `:785-788`). `StrictMode` (`apps/web/src/main.tsx:24`) runs the effect a
    second time on the released session in development, and `subscribe` then
    throws (`packages/note-document/src/session.ts:106-107`). In production, a
    reload that keeps the same key opens a second session that nothing
    releases. Fix: open and release the session in one effect keyed on the
    working copy.
14. (checked) A service worker install succeeds with a partial precache.
    `precacheShell` ignores each failed fetch
    (`apps/web/src/pwa/service-worker.ts:152-173`), and `activate` deletes the
    old, complete cache (`service-worker.ts:309-315`). The next offline launch
    can miss a lazy chunk. Fix: fail the install when an entry fails, so the
    old worker stays.
15. The application has no error boundary and no `errorElement`
    (`apps/web/src/router.tsx:105-164`). A tab that stays open across a deploy
    can fail to load an old chunk and then shows the default error screen with
    a stack.
16. Sign out from the header skips the lifecycle rules. `doSignOut` ignores
    the result and sets no offline marker (`apps/web/src/app.tsx:1069-1076`).
    The full rules are in `apps/web/src/pwa/lifecycle.ts:195-217`, and only
    Settings calls them.
17. (checked) A widget click uses an old position. `RichWidgetType.eq`
    ignores `from` (`packages/editor/src/widgets.ts:447-455`), and the
    `mousedown` listener keeps the first instance (`widgets.ts:496-511`).
    After an edit above the widget, a click puts the caret at the old offset.
    When the note got shorter, the dispatch throws a `RangeError`. Fix: find
    the position with `view.posAtDOM` at click time.
18. The Yjs binding and the view can start with two different texts. When
    `replaceDocumentText` refuses, `openBoundNote` opens the stored bytes with
    no signal (`packages/editor/src/document-binding.ts:180-185`), but the
    view starts from `initialText` (`packages/editor/src/create-editor.ts:165`).
19. Math HTML goes around `rehype-sanitize`. KaTeX output goes through a regex
    tokenizer (`packages/markdown/src/math.ts:275-317`) and a regex splice
    after `rehype-stringify` (`packages/markdown/src/render.ts:411-438`). It is
    safe today only because KaTeX escapes its text. The same path keeps the
    prior finding MD-23 open.

### Release

20. (checked) No automatic gate stands before a published image. The CI
    workflow is `disabled_manually`. `.github/workflows/release.yml` builds and
    pushes `:VERSION` and `:latest` for any `v*` tag with no `pnpm verify` and
    no run of the image. The install layer of `Dockerfile:14-25` does not copy
    the manifests of `packages/logging` and `packages/note-document`, and no
    test starts the built image. Fix: a release job that runs `pnpm verify`
    and a container smoke test before the push.

## Architecture and modularity

- Decision 0018 is still far from the tree, and several directory guides now
  describe the drift as the rule.
  - `packages/storage-server` has no `postgres/` directory, and
    `identity-store.ts`, `snapshots.ts` and `attachments.ts` hold SQL outside
    a repository.
  - In `packages/core`, only `publications/` has `errors.ts`, and only
    `files/` and `publications/` have `model.ts`. `workspaces/service.ts`
    holds 7 use cases.
  - `apps/web` has no `src/app/` directory. The checker defers the ban on an
    import from one feature into another
    (`tools/check-boundaries.mjs:176-180`), and 9 such imports exist.
  - Twelve server files outside `apps/server/src/app.ts` import
    `@notesapp/storage-server`, for example `routes/files.ts:1` and
    `auth/actor.ts:15`. The port types `AttachmentStore`,
    `PublishedLinkStore` and `IdentityStoreHandle` live in the adapter, not in
    `core`.
  - Fix: finish the move, or write a record that refines 0018.
- Large modules keep growing.
  - `apps/web/src/shell/shell.tsx` has 1954 lines, and `ShellFrame` alone
    holds about 725 (`:1220-1944`), with a palette action table of 170 lines
    and no test (`:1470-1641`).
  - `apps/web/src/app.tsx` has 1144 lines and 7 hooks, so it is not the
    provider tree only.
  - `buildPreview` is one closure of about 735 lines
    (`packages/editor/src/live-preview.ts:437-1172`).
  - `LocalStore` has 53 methods (`packages/sync/src/local-port.ts:615-1205`),
    and its test fake has 575 lines. `WorkspaceTransaction` has about 25
    methods (`packages/core/src/files/ports.ts:236-411`).
  - The line cap covers `features/` only (`tools/check-boundaries.mjs:171`).
- The old save model stays beside the new one.
  - `superseded` is computed in `commit.ts:232-242` and announced in
    `queue.ts:310-334`, but the web app drops it
    (`apps/web/src/lib/sync-state.ts:59`).
  - Port members have no production caller: `isAcceptedRevision`
    (`ports.ts:327`), `rebaseDraft`, and `stale` and `acceptedText` of
    `LocalCachedNote` (`local-port.ts:287-320`).
  - The `delete-refused` and recovered note branches
    (`queue.ts:438-483`) cannot happen for a note. The `unseen_work` refusal
    falls through to `parkRefusedSave` (`queue.ts:794`) and has no sentence in
    `apps/web/src/lib/parked-saves.ts`.
  - `docs/development/architecture.md:33-66` still describes Save and the
    rebase, and its package table leaves out `note-document` and `logging`.
- Logic sits in the wrong layer.
  - `finalizeAttachment` (`apps/server/src/routes/attachments.ts:312-437`) and
    `importWorkspace` (`routes/import.ts:281-356`) are whole use cases inside
    handlers. The import commits the notes and each image apart, so a failure
    leaves a partial import, and an imported image skips the attachment size
    cap.
  - The unit of work is written about nine times in `packages/storage-server`
    (`transaction.ts:75-123`, `attachments.ts:301-344`,
    `identity-store.ts:170-210` and others), and the lock key expression is
    repeated. Attachment reads take the workspace write lock
    (`attachments.ts:320-322`).
  - The public entry of `packages/storage-server` exports test helpers
    (`src/index.ts:41-43`, `:64`), and `routes/handlers.ts:47-70` builds stub
    stores in production code.
- Work on each keystroke is too large.
  - `onLocalWork` merges the whole document in an IndexedDB transaction on
    each keystroke (`note-editor.tsx:769-784`,
    `packages/storage-browser/src/local-store/versions.ts:128-181`). The
    change it sends starts four subscribers, and one of them re-renders the
    shell tree (`apps/web/src/shell/files.tsx:152-166`).
  - The widget state field walks the whole tree five times on each selection
    change (`packages/editor/src/widgets.ts:876-888`).
    `docs/development/markdown.md` says this work stays in the visible
    ranges.
- Two scanners remain beside the Lezer tree, against decision 0001.
  - (checked) `insideCodeFence` scans each line from line 1 with a regular
    expression on each Enter and paste
    (`packages/editor/src/keymaps.ts:102-122`).
  - The footnote style comes from a text probe
    (`packages/editor/src/live-preview.ts:1060-1063`).
- One fact has more than one source.
  - `readProperty` has 7 production copies, for example
    `apps/server/src/values.ts:2`, `apps/server/src/routes/publications.ts:96`
    and `packages/sync/src/engine.ts:72`. The prior review found 5.
  - `folderOf` answers `null` at the root in `apps/web/src/lib/relative-time.ts:38`
    and `''` in `apps/web/src/lib/note-name.ts:34`.
  - Route addresses are built by hand in 46 places in 20 files.
  - Lists kept by hand have drifted. `tools/check-agents-md.mjs:36-51`
    leaves out `packages/logging`. The `test:unit` build filter
    (`package.json:17`) leaves out `markdown` and `note-document`. The perf
    image digest in `package.json:30` differs from `Dockerfile:3`. The
    throttle list (`apps/server/src/plugins/register.ts:497-502`) is apart
    from the contract. Fix: derive each list from its one source.
- The HTTP status to action map of the sync client is written in six places
  with small differences (`engine.ts:304-311`, `queue.ts:255-260`,
  `queue.ts:562-565`, `snapshot.ts:189-231`, `snapshot.ts:278-283`).

## Standard practice gaps

- Gate.
  - Record 0066 retired the browser suite. The service worker, the real
    IndexedDB upgrade, CodeMirror and focus now have no automatic proof, and
    IndexedDB runs only on `fake-indexeddb`. Industry practice keeps a thin
    smoke suite, for example five journeys in one browser before each release.
  - `pnpm verify` builds more than once (`package.json:12`, `:17`, `:18`,
    `:28`), with no task cache.
  - The web app has no React hooks lint (`.oxlintrc.json:3`) across about 80
    effects, and `apps/web/src/shell/files.tsx:354-386` already misses a
    dependency.
  - `tests/integration/disposable-database.test.ts:36` has a fixed 200 ms
    delay, and `packages/sync/src/engine.test.ts:787-797` polls on real
    timers. Both break the test rules.
- Supply chain.
  - No SBOM, no provenance, no image signature, and no vulnerability scan.
  - `release.yml` moves `latest` on any `v*` tag, so a patch tag on an older
    line moves `latest` back.
  - `tools/release-check.mjs:566-572` checks that a signature block is there,
    not that it verifies.
  - The last two Dependabot runs failed.
- Contract.
  - The authentication operations are TypeScript in `auth-contract.ts` and
    escape `contract:lint`.
  - The client does not check the sync answers that it writes to IndexedDB
    (`packages/sync/src/engine.ts:582-652`).
  - `packages/api-client/src/configure.ts:74-79` keeps a bearer token path
    that the server refuses (`apps/server/src/auth/actor.ts:232`).
  - The 429 and 503 answers declare no `Retry-After`, and `info.version`
    stays `0.1.0`.
- Operations.
  - `docker-compose.yml` sets no `read_only`, `cap_drop`,
    `no-new-privileges` or resource limit.
  - The runner copies the application with `--chown=notesapp`
    (`Dockerfile:51-56`), so the runtime user can change its own code. The
    image has no `HEALTHCHECK`.
  - Each log record has two `time` keys
    (`packages/logging/src/index.ts:117`), and a 500 logs only the error name
    (`apps/server/src/app.ts:378-382`).
  - Four pools hold up to 35 connections for each process, and no setting
    changes them.
  - The image worker has no concurrency bound and inherits the full
    environment (`apps/server/src/jobs/inspect-image.ts:92-96`).
- Process cost.
  - The repository holds 91 decision records in 18 days and about 7.2k lines
    of custom checkers in `tools/`. The drift of the hand-kept lists above
    comes from this. Standard tools can take part of the work: a dependency
    graph tool, an unused export finder, a task cache, and a release notes
    tool.
  - `docs/plans/003-v0.1-revamp.md` still says `Status: active`, and 0.1.0 is
    released.

## Status of the 2026-09-11 findings

| Finding                               | Status       | Evidence at this commit                                                                                               |
| ------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| P0-1 reset token in the log           | Fixed        | `apps/server/src/request-log.ts:20`, `request-log.test.ts:9-20`                                                       |
| P1-1 schema version in three places   | Fixed        | `migrate.test.ts`, `tests/integration/schema-version.test.ts:23-27`                                                   |
| P1-2 no migration lock                | Fixed        | `packages/storage-server/src/migrate.ts:56`, `tests/integration/concurrent-migrations.test.ts`                        |
| P1-3 auth rate limit by default only  | Partly fixed | Explicit in `better-auth.ts:153-176`, but loose (item 12). API routes other than setup and publications have no limit |
| P1-4 shutdown is not a drain          | Fixed        | `apps/server/src/lifecycle.ts:177-216`, `routes/health.ts:273-285`                                                    |
| P1-5 `trustedOrigins` too broad       | Fixed        | `better-auth.ts:192` reads `config.servedOrigins` (record 0039)                                                       |
| P1-6 `local-store.ts` god module      | Fixed        | `packages/storage-browser/src/local-store/`. Few unit tests beside it, and `legacy.ts` has 848 lines                  |
| P1-7 work on each keystroke           | Partly fixed | Outline, scan and count wait for quiet (`document-work.ts:27-49`). `recordTiming` still runs, and a new path came in  |
| P1-8 root routes outside the contract | Fixed        | `paths/health.yaml`, `paths/ready.yaml` (record 0040). Two auth navigation routes stay outside                        |
| P1-9 size of `shell.tsx`              | Worse        | 1954 lines, from 1037                                                                                                 |
| P1-9 size of `note-editor.tsx`        | Partly fixed | Loader, header, footer and attachment hook moved out. `NoteEditorBody` stays one component                            |
| P2 active-note module global          | Fixed        | `apps/web/src/features/editor/active-note.tsx:47-71`                                                                  |
| P2 keyed `div` remount                | Fixed        | `apps/web/src/app.tsx:1136-1144` keys a fragment                                                                      |
| P2 unbounded `loadAllFiles`           | Fixed        | `apps/web/src/lib/file-load.ts:42-62` stops at 1000                                                                   |
| P2 no coverage                        | Fixed        | `tools/run-tests.mjs:60-70`, as a report with no threshold                                                            |
| P2 no Renovate or Dependabot          | Fixed        | `.github/dependabot.yml`. The last two runs failed                                                                    |
| P2 no catalog                         | Fixed        | `pnpm-workspace.yaml`, held by `tools/check-versions.mjs`                                                             |
| P2 incomplete project references      | Partly fixed | `storage-server` and `storage-browser` still lack `note-document`, and the app `tsconfig.json` files lack `logging`   |
| P2 no `Content-Disposition`           | Fixed        | `routes/attachments.ts:466-474`                                                                                       |
| P2 no JSON depth limit                | Open         | `apps/server/src/plugins/register.ts:771`                                                                             |
| P2 `/ready` gives full detail         | Partly fixed | No version in the detail. The default is still `full` (`routes/health.ts:63-65`)                                      |
| P2 probes open their own client       | Fixed        | `workspace-store/index.ts:374-401` (record 0041)                                                                      |
| P2 no absolute session limit          | Open         | `better-auth.ts:221-226`                                                                                              |
| P2 `createOwner` has no origin check  | Fixed        | `apps/server/src/auth/setup.ts:59`                                                                                    |
| P2 Compose hardening                  | Open         | `docker-compose.yml:46-121`                                                                                           |
| P2 host and port outside the config   | Fixed        | `apps/server/src/config.ts:365-366` (record 0042)                                                                     |
| P2 stale documents                    | New drift    | `docs/development/architecture.md:33-66`                                                                              |
| P2 `readProperty` copies              | Worse        | 7 copies, from 5                                                                                                      |
| P2 orphan `apps/mcp-stdio`            | Fixed        | The directory is gone                                                                                                 |
| P2 `check-versions.mjs` has no test   | Fixed        | `tools/check-versions.test.mjs`                                                                                       |
| P2 container never started in CI      | Open, worse  | CI is off, and `release.yml` does not start the image                                                                 |
| P2 history sort has no index          | Open         | `packages/storage-server/src/schema.ts:373`, `history-repository.ts:232`                                              |

## Strengths to keep

- `tools/check-boundaries.mjs` enforces the package graph, browser safety, one
  public entry and generated transport from the parsed source, with its own
  fixture tests.
- `apps/server/src/plugins/register.ts:598-675` checks the request and the
  response of each operation against the contract.
- The drain on shutdown is a state machine with injected timers
  (`apps/server/src/lifecycle.ts:177-216`).
- The migration role, the runtime role and the identity role are apart, and a
  migration refuses a role that is a superuser or that bypasses row level
  security (`packages/storage-server/migrations/0000_initial.sql:355-373`).
- Yjs stays behind `packages/note-document`, and seeded property tests prove
  convergence under duplicate, reordered and late delivery.
- The sanitizer is a written allow list
  (`packages/markdown/src/policy.ts:116-380`). All 19 XSS vectors that the
  review tried were blocked.
- Contrast is tested for every theme in the registry
  (`packages/ui/src/theme.test.ts`).
