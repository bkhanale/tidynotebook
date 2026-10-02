# 0166. History shows a version as the note and as a difference

- Status: Accepted
- Date: 2026-10-02

## Context

`apps/web/src/features/history/history.tsx` lists the versions of a note.
Each row reads "Saved" and a relative time, so the versions of one minute all
read "Saved just now". A row opens to a line difference with the newest
version and the raw text in a `pre`, and nothing on the row shows that it
opens. The difference shows a line whose only change is its line ending as
removed and added (issue 254).

## Decision

- The rows group by day, and each row names its time of day. A row shows the
  seconds when another row of its day falls in the same minute, so no two
  rows read the same. `apps/web/src/lib/history-times.ts` holds the rule.
- The newest version reads Current version and has no Restore. Every other
  row keeps Restore.
- A row carries a chevron and opens a panel of two tabs: Changes, the line
  difference with the current text, and Preview, the version as the note
  surface draws it, in a read-only editor of `packages/editor` that a lazy
  module of `apps/web/src/features/history/` creates. It is not a working
  copy and it writes nothing.
- `apps/web/src/lib/diff-rows.ts` aligns a hunk into rows. A line that differs
  only in its line ending reads as unchanged, and the counts of a row come from
  the same rows, so the row and its difference agree. Review reads the same
  rows (record 0087).
- `tabClassName` in `packages/ui/src/control-classes.ts` is the recipe of a
  tab.

This excludes a rendering of the version as HTML, which needs `innerHTML`, and
a side by side comparison.

## Consequences

- Two versions of one minute are two rows a person tells apart.
- A person reads a version as it looked before they restore it.
- `history-times.test.ts`, `diff-rows.test.ts` and `control-classes.test.ts`
  hold each rule.
