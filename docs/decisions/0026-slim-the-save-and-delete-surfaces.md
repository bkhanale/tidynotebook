# 0026. Slim the save and delete surfaces, do not remove them

- Status: Accepted
- Date: 2026-09-12

## Context

Records 0023 and 0024 planned an auto-expiring Trash and the removal of the
conflict bar and the whole recovery, or Needs attention, surface. The build
found two data-loss risks. The recovery table is the durable sink for every
save the server refuses for good, not conflicts alone: `quota`, `note_too_large`,
`path_conflict`, and `invalid_content` all land there, so removing it loses a
person's edit on a real refusal. A real database test also showed that a
delete-wins conflict rule is not reachable without orphaning the concurrent
edit. Auto-purge is irreversible deletion on a timer. See
[design 005](../design/005-streamline-save-and-delete.md).

## Decision

The safety net stays, and the confusion is removed by making the rare surfaces
rare. A delete that a concurrent edit refuses keeps the note live, so the edit
wins and stays in History. An edit to a note deleted on another device is kept
as a new `(recovered)` note in the tree, not parked, so Needs attention only
ever shows a genuine resource refusal. The stale-draft bar is removed and the
local draft is kept and rebased on save (`recoverStaleHead` in
`packages/sync/src/queue.ts`, the editor in
`apps/web/src/features/editor/note-editor.tsx`). Trash keeps the manual Delete
permanently and gains no auto-purge. This record supersedes records 0023 and 0024.

## Consequences

- No refusal loses a person's text, and the recovery table stays.
- Needs attention appears only for a resource refusal, so it reads as a rare
  fix list rather than a second inbox.
- The gate is the real database test of the recovered note in
  `tests/integration/sync.test.ts` and the unit test in
  `packages/sync/src/engine.test.ts`.
