# 0073. A save names the revision it descends from

- Status: Accepted
- Date: 2026-09-20

## Context

`rebaseHeads` in `packages/core/src/files/commit.ts` is the one guard that
keeps a save from replacing text the device never saw. It compares
`expectedHeads` with the stored head. `checkpoint` in
`packages/storage-browser/src/local-store/versions.ts` and the commit of
`packages/storage-browser/src/local-store/file-actions.ts` both read that value
from the mirror at write time, while the content of the revision descends from
`parents`. The two disagree whenever the ordered feed moved the head under an
open working copy, and the guard then passes a submission that carries older
text. `tests/integration/sync.test.ts` proves the loss: a device that only
opens a note puts its own text back over a version another device wrote, the
answer names no superseded head, and nothing tells the person.

`applyRemoteChanges` and `activateSnapshot` in
`packages/storage-browser/src/local-store/snapshot.ts` already decide whether a
draft holds unsent work, because the dirty test needs the answer. They keep
every live draft anyway, so a draft that holds nothing keeps shadowing the head
that arrived and `readCachedNote` opens the old text. A restore from Trash and a
restore from History both land under that shadow.

## Decision

A submission states the accepted revision its content descends from. The
parent chain decides the value: the store walks up from the parent through its
own unaccepted checkpoints and names the first revision it did not create, or
an accepted one of its own. `expectedHeadOfParent` in
`packages/storage-browser/src/local-store/shared.ts` holds that rule, and
`checkpoint`, `moveFiles`, and `trashFiles` all read it. The mirror is no
longer asked what the precondition is.

A working copy that holds no unsent work is dropped when the accepted head of
its file moves. The dirty test of `applyRemoteChanges` and of
`activateSnapshot` already names those drafts, so the drop reuses that answer
and covers a live file as well as a tombstone.

The resolution of record 0026 stays: a save that really is behind is rebased by
the server, the head it passed becomes a history entry, and the answer names it
as superseded, so the person reads one notice instead of a prompt.

This excludes a client-side merge, a conflict prompt, and any second place that
decides a precondition.

## Consequences

- A device that only opens a note writes nothing and reads the newer text.
- A genuine save made over an older head is rebased, not silently applied, so
  the superseded notice of `packages/sync/src/queue.ts` reaches the person.
- A restore reaches the device that asked for it, because the draft that held
  the old text is gone.
- A caller cannot state a precondition of its own, so one rule answers it for
  every write of the local store.
- The gate is `tests/integration/browser-storage.test.ts` for the precondition
  and the dropped working copy, `tests/integration/sync.test.ts` for the served
  result of both devices, and the unit tests beside the changed modules.
