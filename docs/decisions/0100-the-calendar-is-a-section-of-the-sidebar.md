# 0100. The calendar is a section of the sidebar

- Status: Accepted
- Date: 2026-09-25

## Context

Record 0099 put the calendar of daily notes on a page of its own, reached from
a footer row of the sidebar. The owner read it and asked for the calendar in
the sidebar, beside the tree, so a day opens from every page with one press.
The page also held the two settings of record 0099, which then need another
place. Record 0093 states what the sidebar holds.

## Decision

- The calendar is a section of the sidebar, between the tree and the footer
  rows. The tree scrolls above it, so the resting divider separates the two
  (record 0063). The Daily notes page, its route and its footer row go.
- The first row of the section is its month title, which shows or hides the
  month, then three compact icon actions: Open today's note, Previous month and
  Next month. Whether the month shows is a device choice, like the open
  folders of the tree, and it shows by default.
- A day is a cell of the grid of record 0099, with the same keys. A day fills
  the width of its cell and is 28 px high on a desktop and 32 px under touch,
  because seven cells of 44 px do not fit the narrowest sidebar. The target
  stays above the 24 px minimum of WCAG 2.5.8. `calendarDayClassName` holds it.
- The day of the open daily note is the selected day, so the calendar states
  where the person is, as the tree does.
- The template and the start choice are a section of the Settings page, named
  Daily notes. They still belong to the member in the open workspace.
- The command palette keeps Open today's note.

This refines records 0093 and 0099.

## Consequences

- A person opens the note of any day from every page without a page change.
- The tree has less height when the month shows. The section hides to give it
  back.
- `calendar-month.test.ts`, `daily-note.test.ts` and `control-classes.test.ts`
  hold the rules.
