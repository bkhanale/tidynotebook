# 0007. Keep the save model and close its gaps

- Status: Accepted
- Date: 2026-09-10

## Context

Four records hold the text: the draft in IndexedDB, the local version, the
queue entry, and the server version in PostgreSQL. The model is correct, but
several edges had no answer: a draft older than the accepted head, a rebase
that moved the parent, a rebase across a delete or a rename, and a save that
the server refuses for good.

## Decision

The four records stay separate. The gaps close as follows. A draft written
over an older accepted head is detected when the note opens, and the person
chooses. A rebase that moved the parent returns the superseded revision and
the client shows a notice. A rebase across a deletion or a rename boundary is
refused with `stale_head` and the client refreshes. A folder rename is
metadata only. A refused save is written to the recovery area and listed on
the Needs attention screen. An unchanged Save is a no operation. The message
`Manual save` is no longer written.

## Consequences

- There is no conflict screen and no branch. History stays one line.
- Typing never creates a version, and Save never needs a connection.
- The note screen reports its state as `data-save-state` on the editor
  element, from `apps/web/src/features/save-state.ts`.
