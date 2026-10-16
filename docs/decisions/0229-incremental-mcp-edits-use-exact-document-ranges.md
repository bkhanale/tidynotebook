# 0229. Incremental MCP edits use exact document ranges

- Status: Accepted
- Date: 2026-10-16

## Context

An assistant often adds a line or changes one sentence while a person types.
The whole-note version condition of record 0227 refuses that work. A whole
text diff can also remove character identities outside the named anchor.
[Design 027](../design/027-incremental-note-edits-through-mcp.md) states the
accepted scope and retry order.

## Decision

- Add `append_to_note` and `patch_note` with write scope. Keep `edit_note`
  and its version condition unchanged. Each accepted call creates one
  History version through a changeset of one revision of one note.
- Resolve unique exact text and parser headings against the head that the
  tool reads. Count overlapping matches. List and task anchors stay deferred.
- Apply bounded offset, length and text ranges directly to the document,
  from last to first. Refuse overlap, equal insert points, invalid bounds,
  split Unicode pairs and excessive size. Do not use a whole-text diff.
- Derive the mutation identity from the grant, tool name and canonical
  input. The input version identifies the call. It does not prevent a merge.
- Check an input-only receipt probe before any note read. Check it again
  before a note-state refusal. Never replace authorization or locked-account
  refusals with a retry answer. A used identity returns an earlier-attempt
  success with no version or text. Rebuild once after an epoch mismatch.
- Keep the rename and edit-over-Trash rules of record 0083. A range removes
  only the character identities that the tool names. Concurrent inserted
  characters survive, but Yjs promises no insert order or Markdown structure.

This refines record 0227 for the two new tools only.

## Consequences

No public contract operation, stored data, setting or image command changes.
The tool list grows by two tools. Clients see them on their next tool list.
The document service gains an internal range operation. Test adapters must
supply that operation.

Range unit tests prove exact identities, Unicode and bounds. Tool unit tests
prove schemas, headings, changeset shape and receipt order. The served MCP
integration tests use explicit barriers for retry and document races. A
browser check proves that a remote append keeps the editor and caret, and
stays outside local undo.
