# 0137. Every page shares the note column and its side region

- Status: Accepted
- Date: 2026-09-30

## Context

Record 0055 centres the note in one column of the note measure and puts the
outline and the inbound links in a side region to its right, from the extra
large width up. `Page` in `packages/ui/src/layout.tsx` centred every other
page in the whole content area, at a width of its own: a reading width, or a
wide width for All notes, History and Review. The frame notices in
`apps/web/src/shell/shell.tsx` and the waiting states of the note used the
reading width too. At the extra large width a move from a note to Settings
moved the column to the right and changed its width. Settings has eleven
sections and no way to reach one but to scroll.

## Decision

- Every page of the frame is one row: a column of the note measure, centred
  in the space it owns, and a side region to its right. `pageRowClassName`,
  `pageColumnClassName` and `pageSideClassName` in
  `packages/ui/src/layout-classes.ts` state the three. `Page`, `PageRegion`
  and the note screen read them, so the column has one place and one width
  on every page. `Page` takes no width.
- The side region takes the same width on every page and shows from the
  extra large width up, as record 0055 states for the note. A page that
  shows nothing in it keeps the space, so the column does not move.
- A page with two or more sections lists them in the region under "On this
  page". A row scrolls to its section, and the section in view is the
  current row. `pageSectionsShown` states the rule. A page with one section
  or none shows no list, because a list of one row does not help a person
  move. The note keeps its outline and its links.
- The owner chose the note measure for every page and an empty region for a
  page of one section, on 2026-09-30.

## Consequences

- A move between any two pages at the extra large width keeps the column
  where it is and keeps its width.
- All notes, History and Review lose their wide width. A diff in History
  and in Review has the width of the note text that it compares.
- A page that adds a section adds it to the list that renders its sections,
  so the page and its list of sections do not disagree.
- `packages/ui/src/layout-classes.test.ts` holds the shared row, column and
  region, and the rule of the list. `apps/web/src/lib/note-column.test.ts`
  holds that the note reads the shared row and region.
- This refines records 0055 and 0091.
