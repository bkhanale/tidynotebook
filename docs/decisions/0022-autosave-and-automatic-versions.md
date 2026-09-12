# 0022. Autosave and automatic versions

- Status: Accepted
- Date: 2026-09-12

## Context

The Save button did two jobs: it made the text durable and it created a version.
That coupling produced four save labels, and the split between "Saved on this
device" and "Saved" asked the person to read a sync fact. Records 0007 and 0017
describe that model. The version history is the safety net of the product, so no
change may remove it. See
[design 005](../design/005-streamline-save-and-delete.md).

## Decision

The note autosaves. Typing writes the local draft, as it does today. A version
is created automatically on a natural boundary: a pause in typing, a blur, or a
move away from the note. Two versions with identical content are collapsed, so a
version marks a real change. The Save button is removed. The save state reads at
most `Saving` and `Saved`, in one place, from
`apps/web/src/features/editor/save-state.ts`. History is unchanged and keeps
`restoreRevision`. This record supersedes records 0007 and 0017.

## Consequences

- A person cannot lose a restore point by forgetting to save.
- The screen holds no Save button and one save word at a time.
- More versions are created. Content de-duplication and coalescing of rapid
  edits hold the count down.
- The gate is `apps/web/src/features/editor/save-state.test.ts` for the state
  table, and a browser test that proves a version appears without a Save press.
