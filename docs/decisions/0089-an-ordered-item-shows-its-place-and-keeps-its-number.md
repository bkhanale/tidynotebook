# 0089. An ordered item shows its place and keeps its number

- Status: Accepted
- Date: 2026-09-23

## Context

The live preview keeps the written number of an ordered item at every depth
(`packages/editor/src/live-preview.ts`), so a nested list shows no hierarchy.
The published page draws decimal at every depth
(`apps/server/src/routes/published-document.ts`). `continueBlockSpec` in
`packages/editor/src/keymaps.ts` numbers only the item that Enter writes, so
an insertion, a deletion, a paste, or an indent leaves the rest of the run
out of sequence. CommonMark numbers a list from its first item and ignores
the later numbers, so the source and the reader can disagree. Tab adds the
indent unit of two spaces, which is less than the content column of a `1. `
item, so Tab does not nest an ordered item. Record 0002 closes the set of
widget kinds.

## Decision

- An ordered item shows the value that CommonMark gives it: the start of its
  list plus its place in the list. The style follows the number of ordered
  lists around it, in the cycle decimal, lower alpha, lower roman, which
  is the cycle of Notion.
  `packages/markdown/src/ordered-markers.ts` holds the cycle and the label,
  and both readers of a note read it.
- The live preview draws that label in place of the written marker, as it
  draws a bullet in place of `-`. The written marker comes back while the
  selection touches its line. A drawn marker is presentation of a marker and
  not a new widget kind of record 0002. The reveal rule keeps its one
  exception of record 0033.
- The published page gives a nested ordered list the same cycle with
  descendant variants through six ordered levels.
- Every edit of a person renumbers each ordered list that the edit touches, in
  the same transaction, so one undo step removes the edit and its numbers. A
  remote change, an undo, and a composition are never renumbered. A list keeps
  its start unless the edit wrote the first marker. A list that an indent or
  an outdent makes restarts at one when it is nested.
- A renumbered marker that grows or shrinks moves the later lines of its item
  by the same width, so the children of the item stay its children.
- Tab nests a list item under the item above it, at the content column of
  that item. Shift and Tab moves an item to the column of its parent.

## Consequences

- The source stays numeric CommonMark and GFM (record 0021), and the live
  preview and the reader agree on the value of every ordered item.
  `tests/integration/markdown-equivalence.test.ts` compares that value.
- A person cannot keep an out-of-sequence number inside a run. A reader would
  not show that number anyway.
- The published page repeats the cycle to a depth of six ordered lists and
  keeps the last style below that. The live preview has no depth limit.
- `packages/editor/src/list-numbering.test.ts` holds the renumber rules and the
  undo step. `packages/editor/src/live-preview.test.ts` holds the label at each
  depth.
