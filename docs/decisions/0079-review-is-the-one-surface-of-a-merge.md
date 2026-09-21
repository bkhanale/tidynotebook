# 0079. Review is the one surface of a merge

- Status: Accepted
- Date: 2026-09-21

## Context

A CRDT keeps both sides of two rewrites of one sentence, so a merged text can
read badly. Record 0024 removed a conflict bar that asked a person to choose.
A held save keeps work on one device only. See
[design 013](../design/013-conflict-free-sync-of-note-text.md).

## Decision

- A text merge asks nothing. The work of another device appears in the open
  note as one editor transaction.
- The device whose accepted save merged, or whose work was replayed (record
  0080), shows one line on that note: the note changed on another device at the
  same time, with a Review action.
- Review compares the text of the last save of this device before the merge
  with the current text, with the unified diff of History in
  `packages/editor/src/unified-diff.ts`. The person fixes the text in the note.
- The line leaves when the person opens Review or dismisses it. It is state of
  that device only.
- History marks a merged revision on every device.

This excludes a held save, a choice between two versions, and a conflict copy.

## Consequences

- One rare line is the whole conflict surface of text.
- The rule that decides the line is a pure module in `apps/web/src/lib/` with
  its own test, and each screen gets a screenshot in light and in dark.
