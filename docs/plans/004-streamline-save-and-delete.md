# Plan 004. Streamline save and delete

Status: active

The live list is [the 0.2.0 release](../releases/0.2.0.md). This plan turns
[design 005](../design/005-streamline-save-and-delete.md) and its records into
ordered work. Each item names its record and its release row.

## Decisions

- [0022. Autosave and automatic versions](../decisions/0022-autosave-and-automatic-versions.md)
- [0023. One auto-expiring Trash](../decisions/0023-one-auto-expiring-trash.md)
- [0024. Remove the conflict and recovery surfaces](../decisions/0024-remove-conflict-and-recovery-surfaces.md)

The order is A, then B, then C. A makes last-writer-wins safe, so B depends on
it. C is independent of A and B and can run beside them. Each item keeps
`pnpm verify` green and updates the nested `AGENTS.md` it changes.

## Epic A. Autosave and automatic versions (0022)

1. A boundary policy in `apps/web/src/features/editor/`: create a version on a
   pause, a blur, and a route change. Keep the keystroke path free of the
   version write. A pure module with a unit test.
2. Coalesce and de-duplicate: a version equal in content to the head is not
   written. Reuse the unchanged-checkpoint suppression in
   `packages/storage-browser/src/local-store/versions.ts`.
3. Remove the Save button. Reduce `save-state.ts` to `Saving` and `Saved`, in
   one place. Drop the footer and sidebar save readouts.
4. Verification: `save-state.test.ts` for the two states, and a browser test
   that a version appears with no Save press.

## Epic B. Last-writer-wins, no conflict or recovery (0024)

1. Resolve a stale head by keeping the loser as a version and taking the later
   tip as the head. Simplify `recoverStaleHead` in `packages/sync/src/queue.ts`.
   This closes audit fault F2.
2. Remove the stale-draft bar in `apps/web/src/features/editor/`, the
   `attention` feature, and `apps/web/src/lib/parked-saves.ts`.
3. Drop the `recovery` table: a schema version in
   `packages/storage-browser/src/database.ts` and its upgrade in
   `migrations.ts`. Remove the recovery slice.
4. Narrow the sync-state copy in `apps/web/src/lib/sync-state.ts` to one calm
   line, with no refusal narration.
5. Verification: a browser test that edits one note on two devices and proves
   both texts are in History with the later one live.

## Epic C. One auto-expiring Trash (0023)

1. Add a retention field and a scheduled purge job in `apps/server/src/jobs/`
   that calls `purgeFiles` for a note past the window.
2. One delete interaction on every surface. Remove Delete permanently from
   `apps/web/src/features/trash/trash.tsx`. Use Restore for the undo notice.
3. Verification: a server test of the expiry job, and a browser test that
   deletes, restores, and confirms an expired note is gone.

## Epic D. Copy and terms

1. One term per concept: Save state, Trash, Restore, Delete, History, Read,
   Write. Remove the error-code leak in the former attention path.
2. Verification: the copy check and a browser test of the delete and restore
   labels.
