# 0078. One rule for each conflict that is not text

- Status: Superseded by [0083](0083-metadata-conflicts-preserve-unseen-text-work.md)
- Date: 2026-09-21

## Context

Record 0076 merges text. A path and a deletion state are single values, so two
devices can still disagree about them. Record 0026 kept an edit to a deleted
note as a new recovered note. See
[design 013](../design/013-conflict-free-sync-of-note-text.md).

## Decision

The server decides each case in `packages/core/src/files/commit.ts`. The
device whose intent did not win reads one notice.

- **A save that did not change the path.** It keeps the current path. A save
  changes the path only when its path differs from the path of the head that
  its precondition names, as `rebasedPath` holds today.
- **Two paths for one note.** A rename or a move that the server accepts last
  wins. The other path stays in History.
- **An edit against a move to Trash.** The edit wins in both orders. A deletion
  carries the state vector of its device. The server refuses the deletion when
  the document holds operations that state does not cover, and the note stays.
  An edit for a note in Trash applies and brings the note back.
- **Two new notes at one path.** Both stay. The second takes the next free name
  in the form of the create action.
- **An edit against a permanent delete.** The delete is final. The device
  creates a new note from its own text at the same path, with a new document.
- **A folder move against an edit inside it.** Both apply.

This replaces the recovered copy of record 0026 with the note itself. It
excludes a prompt for a path and a delete that wins over unseen text.

## Consequences

- No rule drops text of the person.
- The notice text follows the copy rules and names no identifier.
- `tests/integration/sync.test.ts` proves each case with two devices, and the
  edit against a move to Trash in both orders.
