# 002: Holistic client repair

Date: 2026-09-07

Status: Approved on 2026-09-07

This design repairs the web application as one coherent system. It preserves the existing server, API contract, revision graph, and IndexedDB model. It replaces the client coordination that currently causes false save states, slow sync, stale navigation, lost content after reload, and incomplete conflict cleanup. It also rebuilds the application shell so that login, editing, navigation, and phone layouts are usable.

The design is based on direct source inspection and browser reproduction against the real application stack. The implementation must not hide failures with UI delays, forced reloads, or optimistic labels that do not match durable state.

## 1. Architecture

Keep the existing local-first boundary. IndexedDB is the durable browser working state. PostgreSQL is the accepted shared state and revision history. The API and generated client remain the network boundary.

Add one reactive workspace runtime in the web application. It owns a local store connection, a sync controller, and a small change signal. A successful IndexedDB transaction publishes a content-free signal. React readers then query the durable store again. A `BroadcastChannel` carries the same signal to other tabs. A short timed refresh is only a fallback when browser messaging is unavailable.

The sync controller becomes interruptible. A new checkpoint wakes it immediately. Network reconnect, window focus, sign-in recovery, and the existing safety interval can also wake it. Only one sync run can execute at a time. A wake request during a run causes one more pass after the current pass finishes.

Save state is per note and per mutation. The editor reports local persistence, queued sync, active sync, accepted server state, and conflict state from durable records. It must not infer a server save from an empty workspace-wide queue.

Conflict records retain the server conflict group identity and the local queue identity. Resolution clears or acknowledges all related local entries in one browser transaction. A resolved conflict must not return after reload or create a duplicate branch.

Load every note from durable local state first. The accepted server cache is the fallback. Navigation state may contain a route hint, but it must never replace a durable read. This removes the reload path that can reopen a new note with empty content.

Move global shell and authentication styles into the initial application entry. Feature styles may remain split only when the page does not need them before the lazy feature loads. The shell uses a responsive layout with explicit shrink boundaries, a mobile navigation drawer, a compact command header, and one focused writing surface.

## 2. Components

### Sync package

Extend queue records with enough identity to describe their lifecycle:

- file ID and mutation ID
- pending, sending, conflict, accepted, or failed state
- server conflict group ID when a stale write creates a branch
- retryable error category without note content

Expose a per-file save snapshot instead of asking the UI to combine a global queue count with local booleans. The sync engine exposes `requestSync()` in addition to `run()` and `stop()`.

### Browser storage package

Publish a local change signal only after an IndexedDB transaction commits. Add durable queries for the local file list, a file save snapshot, and unresolved conflict records. Store conflict group metadata returned by the server. Add a transaction that clears resolved conflict entries and updates the accepted local head.

Do not put note text in `BroadcastChannel` messages. The message identifies the workspace and changed record type. Receivers reread IndexedDB.

### Web application

Create React adapters for workspace state, local file lists, note save snapshots, and conflicts. These adapters subscribe to committed local changes and use a low-frequency fallback refresh. Remove component-owned copies of durable data where they can become stale.

The note loader always reads the local store. New-note creation writes the initial draft before navigation. The file tree merges accepted server files with unsynced local files and updates after create, rename, delete, sync, and conflict resolution.

The editor keeps its in-memory text while local persistence runs. It presents precise states: `Saving locally`, `Saved locally`, `Syncing`, `Saved to server`, `Conflict`, and `Save failed`. The explicit Save command creates a checkpoint and requests sync immediately. Automatic checkpoints use the same path after their debounce interval.

Conflict resolution uses the stored conflict group ID. It preserves edits if the accepted head changes while the resolution screen is open, asks the user to review the new head, and does not discard either branch.

Import the base tokens and shell styles from the application entry. The login page, loading state, error state, and lazy feature fallback then use the same theme. The desktop shell contains a compact header, a resizable or fixed-width navigator, and the editor. Secondary tools such as sharing, backlinks, outline, and history open in panels instead of sitting above the writing surface. On narrow screens, navigation and secondary tools become drawers or sheets and the primary actions stay reachable.

### Browser journey suite

Add Playwright tests under `tests/e2e`. They start the real server and web build with an isolated PostgreSQL database and isolated browser storage. They use public UI and API behavior. They do not mock IndexedDB, sync, or conflict responses.

## 3. Data flow

### Create and edit

1. New-note creation commits the initial draft to IndexedDB.
2. The local store publishes a file-list change signal.
3. Navigation opens the file ID. The loader rereads the durable draft.
4. Each edit saves a new working draft locally. The UI shows `Saving locally` until the transaction commits.
5. After commit, the UI shows `Saved locally`. The current text is safe across reload and offline use.
6. A manual or automatic checkpoint receives a mutation ID and enters the queue.
7. The checkpoint wakes the sync engine. The matching note shows `Syncing`.
8. A server acknowledgement records the accepted head and removes the exact queue item.
9. Only the matching note shows `Saved to server`.

### Reload and multiple tabs

On reload, the route supplies only the file ID. The loader compares the working draft, pending checkpoints, and accepted cache and returns the newest durable local state. It does not reuse route state as note content.

When another tab commits a local change, its content-free broadcast causes this tab to reread the affected workspace data. If broadcast is unavailable, the fallback refresh and focus event provide eventual convergence.

### File navigation

The file tree starts with the local file list, including unsynced notes. Server refresh updates accepted metadata without removing newer local drafts. Rename and delete use the same commit, signal, checkpoint, and immediate-sync sequence as content edits.

### Offline and reconnect

While offline, local draft commits continue. Checkpoints remain queued and the note shows `Saved locally` with an offline explanation. The `online` event requests sync. Successful acknowledgement advances the accepted cache and save state without a page reload.

### Conflict and resolution

When the server rejects a stale base, it creates or returns a conflict group. The browser stores that group ID on the exact queue item. The conflicting note and conflict view read the same durable record.

Resolution submits the selected or edited content with the current conflict group. On success, one local transaction updates the accepted revision, acknowledges related checkpoints, removes the local conflict record, and signals the file list and editor. On retryable failure, the conflict remains with its group ID. If the accepted head moved, the screen reloads that head and preserves the user's resolution draft for review.

## 4. Error handling

An IndexedDB write failure keeps the current editor buffer in memory. The UI shows `Save failed`, explains that the content is not durable, and provides a copy action. Navigation and page close use a warning while an undurable buffer exists. Quota errors and general storage errors have separate messages.

A network failure never changes `Saved locally` to failure when the local transaction succeeded. It leaves the exact checkpoint queued. Retry occurs on reconnect, focus, explicit Save, and the safety interval. Authentication expiry pauses network sync, keeps local data, and sends the user through sign-in without deleting drafts.

Server validation and permission failures attach to the exact mutation and note. They do not mark unrelated notes as failed. The UI gives the server problem title and a safe corrective action without exposing internal data.

A stale revision or path creates a tracked conflict branch. A failed branch submission stays retryable with the same mutation identity. A successful resolution clears its durable local conflict state. Idempotent retries must not create another branch.

If `BroadcastChannel` is unavailable, the application logs no fatal error and uses focus plus timed refresh. A receiver treats every message as a request to reread data, not as authoritative state.

The initial HTML bundle includes the styles needed by login, loading, and fatal error screens. If a deferred feature module fails, the shell shows a usable retry screen. It must not show unstyled controls or a blank page.

## 5. Verification

The repair is complete only when automated tests and direct browser checks agree.

### Package and integration tests

- Add sync tests for immediate wake, single-run serialization, per-file acknowledgements, offline retry, stable mutation IDs, conflict group persistence, and resolution cleanup.
- Add browser-storage tests for committed change signals, local file queries, per-file save snapshots, cross-tab invalidation, and atomic conflict cleanup.
- Add web tests for durable route loading, local file-tree updates, accurate save labels, authentication style loading, and responsive shell state.
- Keep all existing unit, integration, generated-client, boundary, lint, type, and formatting checks green.

### Real browser tests

Run critical journeys in Chromium, Firefox, and WebKit where the environment supports them:

- login renders with the theme before any authenticated feature loads
- create a note and see it in navigation before server sync
- type, observe local persistence, save, and receive prompt server acknowledgement
- reload immediately and recover the exact content
- rename and delete while navigation updates without reload
- edit offline, reload offline, reconnect, and sync without data loss
- create a two-context stale-revision conflict, resolve it, and confirm that it stays resolved after reload
- open history, sharing, search, outline, and backlinks without blocking the editor
- use keyboard navigation and visible focus for primary commands and dialogs
- verify 390 px, 768 px, and desktop viewports without horizontal overflow or unreachable primary actions

Tests use isolated accounts and data. They must wait on visible state or API outcomes, not arbitrary long delays.

### Manual acceptance

Run the production build on one process bound to `0.0.0.0:3000`. Verify the login and core editing journey from the host and from the local-network URL. Inspect desktop and phone viewport screenshots. Confirm that only one application listener owns port 3000.

Run the repository verification command, the new end-to-end suite, and the bundle budget check before commit. Record any physical-device limit accurately. A Linux WebKit run is useful coverage, but it is not a claim that physical iOS Safari or Android Chrome was tested.

## Consequences

The client gains a small reactive runtime and more durable queue metadata. This is more structure than component polling, but it makes local persistence, network acceptance, and conflict state explicit and testable. The server and public API need only compatible additions if the existing conflict response lacks an identity already present in the domain.

The browser suite increases setup time and CI duration. It protects the user journeys that package tests cannot cover. The application remains local-first and keeps all note content inside the existing stores and transports.
