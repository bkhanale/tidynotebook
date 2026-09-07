# Holistic Client Repair Implementation Plan

**Goal:** Make every existing web journey durable, prompt, responsive, and easy to understand, with accurate save and conflict state.
**Architecture:** Keep IndexedDB as the browser working state and PostgreSQL as accepted shared state. Add committed local change events, per-file save snapshots, and an interruptible sync worker, then make React render those durable facts. Rebuild the shell around the editor and verify the complete behavior with real browsers.
**Tech stack:** TypeScript 7, React 19, React Router 8, Dexie 4, CodeMirror 6, Vite 8, Playwright 1.63, Fastify 5, PostgreSQL 18
**Design:** `docs/design/002-holistic-client-repair.md`

The sequence number `002` was checked after `git fetch origin --prune`. The remote has no `main` branch. Local `main` is `2bfc1187340bc4dddc65ccd43653c1ac1e356f78`, and the existing highest design and plan number is `001`. Recheck the remote before the final push.

## Global Constraints

- IndexedDB is the durable browser working state. PostgreSQL is the accepted shared state and revision history.
- Publish a local change signal only after its IndexedDB transaction commits.
- Never put note text, paths, or attachment bytes in cross-tab messages.
- Save status is per file and per mutation. It must not use a workspace-wide queue count as note acknowledgement.
- New checkpoints request an immediate sync pass. Only one sync pass can run at a time.
- Navigation state must never replace a durable local note read.
- Conflict retries keep stable mutation and conflict group identities.
- Successful conflict resolution clears every related local conflict record atomically.
- Login, loading, and fatal error styles must be in the initial application bundle.
- At 390 px, 768 px, and desktop widths, no primary action can be clipped or unreachable.
- Browser tests use the real application, PostgreSQL, IndexedDB, generated API client, and sync engine. They do not mock these boundaries.
- Use conventional commits and never force push.

### Task 1: Durable local events and per-file state

**Files:**
- Modify: `packages/sync/src/local-port.ts`
- Modify: `packages/sync/src/index.ts`
- Modify: `packages/storage-browser/src/database.ts`
- Modify: `packages/storage-browser/src/migrations.ts`
- Modify: `packages/storage-browser/src/local-store.ts`
- Modify: `packages/storage-browser/src/index.ts`
- Modify: `tests/integration/browser-storage.test.ts`
- Modify: `tests/integration/offline-lifecycle.test.ts`

**Interfaces:**
- Consumes: Existing `Draft`, `QueueEntry`, `CheckpointRecord`, `LocalAcceptedFile`, and `LocalStore` contracts.
- Produces: `LocalChange = { accountId: string; workspaceId: string; fileId: string | null; kind: 'draft' | 'queue' | 'file' | 'conflict' | 'cursor' | 'reset' }`; `LocalFileSummary`; `FileSaveSnapshot`; `LocalConflict`; `LocalStore.subscribe(listener: (change: LocalChange) => void): () => void`; `LocalStore.listLocalFiles(accountId: string, workspaceId: string): Promise<readonly LocalFileSummary[]>`; `LocalStore.readFileSaveSnapshot(accountId: string, workspaceId: string, fileId: string): Promise<FileSaveSnapshot>`; and `LocalStore.resolveConflict(accountId: string, workspaceId: string, conflictGroupId: string, result: AcceptedChangeset): Promise<void>`.

- [x] Step 1: Extend `QueueEntry` and its IndexedDB row with nullable `conflictGroupId`, nullable `branchMutationId`, `branchState` values `none`, `pending`, `submitted`, or `failed`, and nullable `errorCode`. Add a Dexie schema migration that supplies safe defaults to old rows and validates all new fields.
- [x] Step 2: Define `LocalChange` as workspace-scoped invalidation metadata with kinds `draft`, `queue`, `file`, `conflict`, `cursor`, or `reset`. Define `LocalFileSummary` from accepted file metadata plus the newest draft so unsynced creates, renames, and deletes are visible.
- [x] Step 3: Define `FileSaveSnapshot` with file ID, latest draft sequence, latest mutation ID, queue state, conflict group ID, accepted head ID, local head ID, and `hasUncheckpointedDraft`. Implement its IndexedDB query without reading another file's queue state.
- [x] Step 4: Add a store-owned event channel. Publish after successful write transactions from `saveDraft`, `checkpoint`, `markSending`, conflict updates, `acknowledge`, snapshot activation, remote change application, conflict resolution, and private-data clearing. Use `BroadcastChannel` when available and an in-process listener set in every environment. Messages contain only partition and invalidation metadata.
- [x] Step 5: Implement `listLocalFiles` by merging accepted metadata and newest working drafts by file ID. Keep the newest local path and deletion state. Implement `resolveConflict` as one transaction that updates accepted heads from the server result, accepts related checkpoints, removes related queue entries, marks matching local branches resolved, and publishes file, queue, and conflict invalidations.
- [x] Step 6: Add integration coverage for commit-only event publication, two store instances receiving invalidation, fallback behavior without `BroadcastChannel`, local-only file listing, per-file isolation, schema migration, and atomic conflict cleanup.
- [x] Step 7: Run `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm --filter @notesapp/storage-browser typecheck` and `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm test:integration -- browser-storage offline-lifecycle`. Expect every selected check to pass.
- [x] Step 8: Commit with `feat(storage-browser): add reactive local file state`.

### Task 2: Immediate sync and stable conflict submission

**Files:**
- Modify: `packages/sync/src/queue.ts`
- Modify: `packages/sync/src/engine.ts`
- Modify: `packages/sync/src/engine.test.ts`
- Create: `packages/sync/src/queue.test.ts`
- Modify: `packages/sync/src/index.ts`
- Modify: `apps/web/src/app.tsx`

**Interfaces:**
- Consumes: Task 1 `QueueEntry` metadata and committed local events.
- Produces: `SyncEngine.requestSync(): void`; branch submission that stores one stable `branchMutationId` and `conflictGroupId`; sync notices that include affected file and mutation IDs.

- [x] Step 1: Extend `SyncEngine` with `requestSync()`. Replace the fixed sleep loop with an abortable wake gate that resolves on explicit request or the 15-second safety interval. Coalesce several wake requests and run no concurrent cycles.
- [x] Step 2: Keep one branch mutation ID and conflict group ID on the queue entry before the first branch request. Retry the identical branch body after a transport failure. Store `submitted` only after server acceptance and `failed` with the stable server error code after a retryable failure.
- [x] Step 3: Include file IDs in pushed, conflict, and preserved notices. Do not announce accepted state before `LocalStore.acknowledge` commits.
- [x] Step 4: Update `useWorkspaceSync` to expose a stable workspace runtime value with `requestSync`, current notice, and running state. Request sync for committed queue invalidations, browser `online`, and window focus. Keep the same engine until store, account, or workspace changes.
- [x] Step 5: Add deterministic tests with injected clock and sleep for immediate wake, wake coalescing, no concurrent cycles, safety polling, stopped engines, stable branch identities across retry, and file-scoped notices.
- [x] Step 6: Run `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm --filter @notesapp/sync typecheck` and `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm --filter @notesapp/sync test:unit`. Expect all sync tests to pass.
- [x] Step 7: Commit with `feat(sync): wake sync for durable checkpoints`.

### Task 3: Durable note loading and reactive navigation

**Files:**
- Create: `apps/web/src/local-state.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/features/new-note.tsx`
- Modify: `apps/web/src/features/note-editor.tsx`
- Modify: `apps/web/src/features/shell.tsx`
- Create: `apps/web/src/local-state.test.ts`

**Interfaces:**
- Consumes: Task 1 store subscription, `listLocalFiles`, `readCachedNote`, and Task 2 workspace runtime.
- Produces: `useLocalQuery<T>(store, partition, query, fallbackMs)`, `mergeFileSummaries(local, remote)`, and note routes that load only from durable state.

- [x] Step 1: Implement `useLocalQuery` with a generation counter. Subscribe to matching local invalidations, reread on window focus, and use a 30-second fallback timer. Cancel obsolete reads when its partition or query changes.
- [x] Step 2: Remove `FreshFileState` and `readFreshState`. Make `NoteEditorLoader` call `readCachedNote` for every route load. Use the newest durable draft working copy and accepted cache from the store. Return a clear missing-note state only when the durable query returns null.
- [x] Step 3: Keep new-note creation local-first. Save the initial draft, then navigate with only the route. Give new paths a collision-resistant visible name such as `untitled-YYYYMMDD-HHMMSS.md`, while path validation remains authoritative.
- [x] Step 4: Make `Sidebar` query `listLocalFiles`, merge later server metadata without replacing newer local state, and update after create, rename, delete, acknowledgement, pull, and conflict resolution. Preserve folder expansion and active-file state.
- [x] Step 5: Add unit tests for local-over-remote merging, local-only files, newer local rename and delete, stable sorting, invalidation reload, and cleanup. Add an integration assertion that a newly created durable draft reloads without router state.
- [x] Step 6: Run `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm --filter @notesapp/web typecheck`, `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm --filter @notesapp/web test:unit`, and `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm test:integration -- browser-storage`. Expect all checks to pass.
- [x] Step 7: Commit with `fix(web): load notes from durable local state`.

### Task 4: Accurate editor save lifecycle

**Files:**
- Modify: `apps/web/src/features/save-status.tsx`
- Modify: `apps/web/src/features/note-editor.tsx`
- Modify: `packages/sync/src/checkpoints.ts`
- Modify: `packages/sync/src/checkpoints.test.ts`
- Create: `apps/web/src/features/save-status.test.ts`

**Interfaces:**
- Consumes: Task 1 `FileSaveSnapshot`, Task 2 `requestSync`, and Task 3 local query adapter.
- Produces: `resolveSaveState` based only on current-file durable state; Save, rename, delete, automatic checkpoint, and route-leave flows that wait for local commit and wake sync.

- [x] Step 1: Replace workspace queue counters and the component `acknowledged` guess with the current file's `FileSaveSnapshot`. Add the visible `syncing` state. Show `Saved to server` only when the newest local checkpoint mutation is acknowledged and there is no newer draft.
- [x] Step 2: Make draft persistence sequence-safe across content and path edits. Keep `Saving locally` until the exact write resolves. Clear a storage error only after a later local transaction succeeds.
- [x] Step 3: Make explicit Save await the draft write and checkpoint transaction, record the returned mutation ID, then call `requestSync`. Make auto-save, rename, delete, Ctrl+S, and route leave call the same checkpoint helper. Prevent double checkpoint creation when these events overlap.
- [x] Step 4: Keep an undurable editor buffer mounted after IndexedDB failure. Keep the copy action and before-unload warning. Disable destructive route actions until the write succeeds or the user explicitly leaves through the browser warning.
- [x] Step 5: Add tests for a brand-new empty note, local draft only, queued checkpoint, sending checkpoint, accepted checkpoint, newer uncheckpointed draft, file-specific conflict, storage quota, and overlapping Save calls.
- [x] Step 6: Run `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm --filter @notesapp/sync test:unit` and `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm --filter @notesapp/web test:unit`. Expect all selected tests to pass.
- [x] Step 7: Commit with `fix(web): report the durable note save state`.

### Task 5: Complete conflict resolution lifecycle

**Files:**
- Modify: `apps/web/src/features/conflicts.tsx`
- Modify: `apps/web/src/features/note-editor.tsx`
- Modify: `packages/storage-browser/src/local-store.ts`
- Modify: `tests/integration/sync.test.ts`
- Modify: `tests/integration/revisions.test.ts`
- Create: `apps/web/src/features/conflicts.test.ts`

**Interfaces:**
- Consumes: Task 1 `LocalConflict` and `resolveConflict`, Task 2 stable branch metadata, generated `listBranches`, `getRevision`, `submitBranch`, and `resolveBranches` operations.
- Produces: A conflict list that joins local queue state to server groups, retry of only failed branch uploads, and successful local cleanup after server resolution.

- [x] Step 1: Replace the workspace-wide pending-conflict list with durable `LocalConflict` records. Show whether a branch upload is pending, failed, or submitted. Retry only `pending` or `failed` records with their stored branch mutation and group IDs.
- [x] Step 2: After `resolveBranches` succeeds, call `store.resolveConflict` with the server accepted changeset. Do not remove local state before the server response. Refresh branch data and file state after the local transaction commits.
- [x] Step 3: Before resolution submission, compare the loaded head to the current server head. If it moved, preserve edited resolution text in component state, reload the new comparison, and require review before submit.
- [x] Step 4: Keep both tips and final path choices visible. Preserve attachment whole-version selection and text hunk editing. Scope conflict badges and editor status to affected files.
- [x] Step 5: Add integration tests for stale content, stale rename, stable branch retry identity, one accepted merge with both parents, local cleanup, reload after resolution, and an idempotent repeated server reply.
- [x] Step 6: Run `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm test:integration -- sync revisions` and `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm --filter @notesapp/web test:unit`. Expect all tests to pass.
- [x] Step 7: Commit with `fix(conflicts): clear resolved local branches`.

### Task 6: Rebuild the application shell and responsive editor

**Files:**
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/shell.css`
- Modify: `apps/web/src/features/shell.tsx`
- Modify: `apps/web/src/features/accounts.tsx`
- Modify: `apps/web/src/features/note-editor.tsx`
- Modify: `apps/web/src/features/sharing.tsx`
- Modify: `apps/web/src/features/history.tsx`
- Modify: `apps/web/src/features/search.tsx`
- Modify: `apps/web/src/features/backlinks.tsx`

**Interfaces:**
- Consumes: Existing `@notesapp/ui` controls and the repaired reactive web state.
- Produces: Styled initial routes, a responsive shell, a primary editor surface, accessible drawers and panels, and reachable actions at supported widths.

- [ ] Step 1: Import `shell.css` from `main.tsx` and remove the lazy-only import. Confirm that login, loading, not-found, invitation, and fatal states receive theme tokens and layout styles before authenticated code loads.
- [ ] Step 2: Rework the shell grid with `minmax(0, 1fr)`, `min-width: 0`, bounded sidebar width, stable viewport height, and independent scrolling. Remove intrinsic widths that cause viewport shrink-to-fit.
- [ ] Step 3: Simplify the header. Keep brand, workspace context, mobile menu, New note, theme, and account access. Use icon labels and responsive text rules so New note and Save stay reachable at 390 px.
- [ ] Step 4: Make the editor the primary pane. Remove duplicate visible titles, constrain readable text width without creating unused canvas, and put sharing, history, outline, backlinks, and search in clearly labelled secondary panels or drawers.
- [ ] Step 5: Make the mobile navigation drawer modal: manage focus, Escape, backdrop, `aria-expanded`, and return focus. Use at least 44 px touch targets for primary mobile controls. Respect reduced motion.
- [ ] Step 6: Review all existing controls for visible focus, associated labels, status announcements, error messages, keyboard reachability, and contrast in Tokyo Night Night and Day.
- [ ] Step 7: Run `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm --filter @notesapp/web typecheck`, `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm --filter @notesapp/web build`, and `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm perf:bundle`. Expect all commands and bundle budgets to pass.
- [ ] Step 8: Commit with `feat(web): rebuild the responsive notes workspace`.

### Task 7: Real browser verification infrastructure

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `playwright.config.ts`
- Create: `tests/e2e/support/stack.ts`
- Create: `tests/e2e/support/account.ts`
- Create: `tests/e2e/support/browser-state.ts`
- Create: `tests/e2e/auth-and-layout.spec.ts`
- Create: `tests/e2e/notes.spec.ts`
- Create: `tests/e2e/offline.spec.ts`
- Create: `tests/e2e/conflicts.spec.ts`
- Create: `tests/e2e/features.spec.ts`
- Modify: `docs/dev/verification.md`

**Interfaces:**
- Consumes: Production server build, `compose.test.yaml`, owner bootstrap command, real browser routes, IndexedDB, and generated application operations.
- Produces: `pnpm test:e2e`, isolated stack fixtures, reusable authenticated contexts, and artifact capture for failed journeys.

- [ ] Step 1: Pin `@playwright/test` at `1.63.0`. Add `test:e2e` and `test:e2e:headed` scripts. Configure Chromium, Firefox, WebKit, 390 by 844 phone, 768 px tablet, and desktop projects. Keep trace, screenshot, and video only for failed or retried tests.
- [ ] Step 2: Build a worker-scoped stack fixture that creates a unique PostgreSQL database and storage directory, runs migrations and owner bootstrap, starts one application server on a free loopback port, waits for readiness, and always cleans up its process, database, and directory.
- [ ] Step 3: Add UI login helpers and browser-state helpers that clear cookies, service workers, caches, local storage, and IndexedDB between tests. Do not bypass session creation with an injected browser token.
- [ ] Step 4: Cover login computed styles, desktop and phone overflow, drawer keyboard behavior, new-note local visibility, exact reload content, immediate Save acknowledgement, rename, delete, offline reload, reconnect sync, two-context conflict creation and resolution, history, sharing, search, outline, and backlinks.
- [ ] Step 5: Use visible labels, roles, URLs, and API outcomes for waits. Forbid fixed sleeps longer than a short animation frame. Capture console errors and fail tests on unexpected page errors.
- [ ] Step 6: Document exact local commands, required Docker service, browser installation, artifact paths, and the physical-device limitation.
- [ ] Step 7: Run `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm test:e2e`. Expect every supported browser project to pass. If a browser runtime is unavailable, install its documented system dependencies and rerun rather than skipping coverage silently.
- [ ] Step 8: Commit with `test(e2e): cover critical browser journeys`.

### Task 8: Holistic regression pass and documentation

**Files:**
- Modify: `docs/dev/verification.md`
- Modify: `docs/dev/local-storage.md`
- Modify: `docs/dev/files-and-revisions.md`
- Modify: `docs/ops/self-hosting.md`
- Modify: `README.md`
- Modify: `progress.md`
- Modify: `docs/plans/002-holistic-client-repair.md`

**Interfaces:**
- Consumes: All repaired code and automated suites from Tasks 1 through 7.
- Produces: Accurate operation and verification documents, completed plan checkboxes, and one verified production build for handoff.

- [ ] Step 1: Run `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm verify`. Fix every failure in its owning package and rerun until the command passes.
- [ ] Step 2: Run `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm test:e2e`, `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm perf:bundle`, and `/home/bkhanale/workspace/bkhanale/notesapp/.tooling/bin/pnpm perf:service`. Fix every reproducible regression and rerun the affected full command.
- [ ] Step 3: Build the production application. Stop the old notes application listener, start exactly one repaired process bound to `0.0.0.0:3000`, and verify the login, create, edit, Save, reload, rename, delete, and conflict flows through the host and local-network URL.
- [ ] Step 4: Inspect desktop, 768 px, and 390 px screenshots. Check that `document.documentElement.scrollWidth` is not greater than `clientWidth`, primary actions are visible, focus order is useful, and both themes remain readable.
- [ ] Step 5: Update the local storage, revisions, verification, self-hosting, README, and progress documents to match the implemented event, sync, conflict, test, and port behavior. Do not claim physical-device coverage.
- [ ] Step 6: Check `git diff --check`, scan changed files for credentials and note content, and confirm that only intended worktree files changed.
- [ ] Step 7: Commit with `docs: record repaired client workflows`.

### Task 9: Main branch delivery

**Files:**
- Modify: No source files. This task changes Git references and the live process only.

**Interfaces:**
- Consumes: A clean, reviewed, fully verified `feat/holistic-app-repair` branch and the explicit request to deliver directly to `main`.
- Produces: Local and remote `main` at the verified repair commit, without a force push, plus one live local-network application on port 3000.

- [ ] Step 1: Fetch `origin` and confirm whether `origin/main` now exists. If it exists, require local `main` and the repair branch to be a fast-forward from it. If it does not exist, confirm that local `main` still equals `2bfc1187340bc4dddc65ccd43653c1ac1e356f78`.
- [ ] Step 2: Run the finish-stage review against `main..feat/holistic-app-repair`. Resolve every important finding and rerun the complete verification commands affected by each change.
- [ ] Step 3: Fast-forward local `main` to the repair branch from the main checkout. Do not merge with a merge commit and do not force update any reference.
- [ ] Step 4: Push local `main` with `git push -u origin main`. Never use `--force` or `--force-with-lease`.
- [ ] Step 5: Confirm the remote main SHA equals local main, the main worktree is clean, one application listens on port 3000, and its LAN login page returns the repaired CSS bundle.
