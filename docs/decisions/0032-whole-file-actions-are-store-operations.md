# 0032. A whole-file action is one store operation

- Status: Accepted
- Date: 2026-09-14

## Context

The path and the deletion state of a note live on every working copy of that
note. A `Draft` carries `path` and `deleted`, a `CheckpointRecord` carries
both, and the accepted row carries both. Move to folder, the tree drag, Rename
folder, and Delete each built the action in the screen: they read the note,
invented a working copy, saved a draft, and checkpointed it.

Every other working copy kept the old value. The open editor holds the path in
a ref and the deletion state in another, so its next autosave wrote the old
path back and the note left the folder again, and a deletion behind its back
could be undone by the same route. The reverting save also queues, so the old
value reaches the server and every other device. Only the note screen learned
about a move, and only for the dialog. The sidebar carried a special case that
called into the editor to delete the open note, because the two paths could not
otherwise agree.

## Decision

A whole-file action is one operation of the `LocalStore` port. Two exist:
`moveFiles` and `trashFiles` in `packages/sync/src/local-port.ts`, both
implemented by `packages/storage-browser/src/local-store/file-actions.ts`.

One transaction covers every named file. Each file gets one checkpoint that
states its new path or its tombstone, and **every stored draft of that file is
brought to the same state**, keeping its text and its sequence. No working copy
can hold the old path or claim a trashed note is live, so no later save can
write the action back.

A screen holds neither value. `apps/web/src/features/folders/apply-moves.ts`
and `apps/web/src/features/editor/note-delete.ts` call the port. The editor
follows the store: it reads its path from the note list and its deletion state
from `FileSaveSnapshot`. The `movedPath` property, the `movedNote` state, and
the sidebar special case that deleted the open note through the editor are
removed.

The store refuses the write that a screen makes from an older belief, because
a screen learns of an action after it lands. `checkpoint` refuses a live
revision for a file the store holds as deleted, and `saveDraft` keeps that
deletion while it keeps the text. Only a restore, which the server owns, brings
a note back.

An action needs a local row, so `cacheServerNote` keeps the note that a screen
read over HTTP before the ordered feed reached the store. Without it a device
that opened a note it had not received yet named a create precondition for a
file the server already has, and the workspace refused the write.

This excludes an action composed of `saveDraft` plus `checkpoint` by a caller,
and it excludes a second working copy created for an action.

## Consequences

- A move and a deletion are atomic per file set. A folder rename no longer half
  moves, and a folder deletion no longer half deletes.
- The sidebar no longer asks whether a note is open before it deletes it.
- `Draft.path` and `Draft.deleted` stay. Removing them would change the save
  model of record 0022, because a typed rename is recovery data until a version
  is created.
- A `stale` refusal is not a failed save. The editor reads the store again and
  reports nothing, because nothing was lost and nothing is for the person to
  fix. A refusal the person must act on, such as a note this device has not
  received yet, states one sentence on the note screen.
- A note a person can open is a note they can act on. The read of the screen is
  kept, so the first action after opening does not have to fail first.
- The gate is `tests/integration/browser-storage.test.ts`, which proves that a
  later save of an open working copy keeps the moved path and does not bring a
  trashed note back, and the browser journeys in
  `tests/e2e/nested-folders.spec.ts` and `tests/e2e/sidebar-delete.spec.ts`.
