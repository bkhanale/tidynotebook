# Streamline save and delete

Status: active

This design studies the save, delete, and trash workflow and states how to make
it simple for a Markdown notes application. It follows the audit of
[the workflow](../audits/2026-09-12/save-delete-trash.md), which found two kinds
of fault: a deleted note that comes back, and a workflow that shows the person
more concepts than a notes application needs.

## The problem

The application shows one save and delete story across five destinations: the
note editor, Trash, History, Needs attention, and the offline settings. A
person meets four save labels, three delete interactions, two words for one
operation, and a second inbox for saves that a server refused. Most of these
surfaces exist to explain a sync engine to the person. A notes application does
not need them.

The audit also found a class of correctness fault. The purge of a note left
local traces behind, so the note came back. A separate defect un-deleted a note
whose deletion a stale head refused. The correctness fault of the purge path is
fixed on its own, before this redesign, because it hurts a person today. This
design decides the shape of the workflow that the redesign then builds.

## What forces the choices

Three facts shape the options.

- The version history is the safety net of the whole product. A person must be
  able to read and restore an earlier version, so no option may remove History.
- Every superseded edit already becomes a version. When last-writer-wins keeps
  the loser as a version, no edit is ever lost, so the client does not have to
  ask a person to resolve a conflict.
- The product stays local first. A note works with no connection. This keeps
  the sync engine, so the redesign hides it rather than removes it.

## The save model

The Save button today does two jobs at once: it makes the text durable, and it
creates a version. That coupling is the source of most save labels. A person
reads "Saved on this device" against "Saved" and has to care whether a server
acknowledged the save, which is a sync fact, not a note fact.

Option A, autosave with automatic versions. The text autosaves as the person
types, which already happens to the local draft. A version is created for the
person on a natural boundary: a pause in typing, a move away from the note, or a
close. Two versions with the same text are collapsed, so a version marks a real
change. The Save button goes. The status collapses to at most "Saving" and
"Saved" in one place. History keeps working, and it improves, because a person
can no longer lose a restore point by forgetting to save. The cost is more
versions, which content de-duplication and coalescing hold down.

Option B, keep the Save button and cut its states to two. This is the smallest
change, but it keeps the button, the manual version, and the split between
device-durable and server-acknowledged that confuses the person.

This design takes option A. It removes the most confusion, and it keeps the
version history that the product depends on. See
[decision 0022](../decisions/0022-autosave-and-automatic-versions.md).

## The delete model

Delete today has three interactions and two vocabularies. The sidebar deletes
with no confirmation. The editor asks first. Trash offers Delete permanently.
Undo and Restore are the same operation under two words.

Option A, hard delete with an undo window. Delete removes the note at once, and
a short undo notice is the only way back. This is the fewest concepts, but it
drops recovery when the notice does.

Option B, one auto-expiring Trash. Delete moves the note to one Trash. The Trash
empties itself after a fixed time, so a person never selects Delete permanently.
There is one delete interaction, one Trash, one word for the way back, and no
Needs attention. Recovery stays for the retention window.

This design takes option B. It keeps a safety net and still removes the manual
permanent delete, the second vocabulary, and the second inbox. See
[decision 0023](../decisions/0023-one-auto-expiring-trash.md).

## The refused-save and conflict surfaces

Needs attention is a second inbox that holds saves a server refused, with its
own verbs: Retry, Save as new note, Copy text, and Discard. The stale-draft bar
asks a person to keep their text or take the latest version. Both exist because
a save can be refused or can meet another device.

Automatic versions make these surfaces unnecessary. When the loser of a
last-writer-wins save is kept as a version, the client never has to ask a person
to choose, and it never has to park refused text, because the text is already in
History. This removes the conflict bar, the Needs attention screen, the parked
saves module, and the recovery table. It is a large cut for near-zero visible
loss, and it removes a class of edge-case code. See
[decision 0024](../decisions/0024-remove-conflict-and-recovery-surfaces.md).

The concurrent-edit resurrection that the audit names F2 belongs here. Under
last-writer-wins the delete and the edit both become versions, and the tip
decides the live state. The client no longer un-deletes a note behind the
person's back, so F2 closes with this model rather than with a separate patch.

## What stays

History, Read and Write, and the command palette stay. The offline behavior
stays, but the person does not read the sync queue. The words narrow to Save
state, Trash, Restore, Delete, History, Read, and Write.

## Decisions

- [0022. Autosave and automatic versions](../decisions/0022-autosave-and-automatic-versions.md)
- [0023. One auto-expiring Trash](../decisions/0023-one-auto-expiring-trash.md)
- [0024. Remove the conflict and recovery surfaces](../decisions/0024-remove-conflict-and-recovery-surfaces.md)
- [0026. Slim the save and delete surfaces, do not remove them](../decisions/0026-slim-the-save-and-delete-surfaces.md)

The build of 0023 and 0024 found that removing the recovery surface loses text
on a resource refusal, and that an auto-expiring Trash is irreversible. Record
0026 supersedes both: it keeps the safety net and slims the surfaces instead.

The ordered work is in [plan 004](../plans/004-streamline-save-and-delete.md),
and the rows are in [the 0.2.0 list](../releases/0.2.0.md).
