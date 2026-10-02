# 0165. A long list renders a window of its rows

- Status: Accepted
- Date: 2026-10-02

## Context

`apps/web/src/features/notes/notes-home.tsx` renders every note. With 1010
notes the page holds 11582 elements and a move from a note to the list takes
about 200 ms at the median (issue 256, `docs/audits/2026-10-02/performance.md`).
The tree has the same cost with its folders open. See
[design 023](../design/023-names-the-tree-and-long-lists.md).

## Decision

- A list of many rows renders the rows in view and a few on each side, and
  keeps the height of the rest as padding above and below them. The tree and
  each group of All notes take a window.
- `apps/web/src/lib/row-window.ts` is the pure rule: from the offset of the
  list in its scroller, the height of the scroller, the stride of one row and
  the count, it returns the first and the last row and the two paddings.
- `apps/web/src/shell/row-window.ts` is the one hook that measures the stride
  of a rendered row and writes the two paddings through a reference, as record
  0058 writes the place of an overlay. No `style` attribute is added.
- Each row states `aria-posinset` and `aria-setsize`. The tree keeps one row
  in the tab order, and the first row of the window takes that place when the
  row is out of it. Every heading of All notes stays in the document, so the
  list of sections works (record 0137). All notes keeps its scroll offset for
  the session.
- The list of the notes area reads every page, up to `maxNoteListFiles` of
  `packages/core/src/files/read.ts`, which only stops a server that never
  ends its pages. It stopped at `maxListedFiles`, so 1010 notes showed 1000.
- The module is our own and not `@tanstack/react-virtual`: the rows of a list
  share one stride (record 0065), the library writes through a `style`
  attribute that `tools/check-design-rules.mjs` refuses, and it would add a
  dependency to the first route (record 0136).

This excludes a window over rows of many heights and `content-visibility` as
the answer, which keeps every element.

## Consequences

- The page holds a bounded number of rows at any count of notes.
- Find in page finds the rows in the window only. The palette searches every
  note.
- `apps/web/src/lib/row-window.test.ts` holds the rule at each edge.
