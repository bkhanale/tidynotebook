# 0217. The home page of the landing site may use a wide column

- Status: Refined
- Date: 2026-10-10

The current [page family rules](../development/layouts.md#public-pages) refine
the layout scope. The rationale below remains as history.

## Context

Record 0137 gives every page the column of the note measure. The landing
site of record 0198 has a home page that shows the product. A hero headline,
a row of features and a screenshot of the application need more room than the
note measure gives. The largest type step, `text-3xl`, names a note on the
published page only.

## Decision

- The home page of the landing site may use a wide column: `max-w-5xl`. Every
  other page keeps the note column of record 0137. This includes the other
  pages of the landing site and the guide.
- The hero headline of that page takes `text-3xl` with `tracking-display`.
- A feature item on that page shows its icon at 20 px.
- A product screenshot on that page is a raised surface: `rounded-lg`,
  `edge-subtle` and `shadow-overlay`. It shows the light image in light and
  the dark image in dark through `prefers-color-scheme`, with no script. The
  image is a real capture of the application, never a drawing.
- Everything else is unchanged: one primary button with an ink fill, two
  weights, the named type steps, sentence case and no capitals.

## Consequences

- The wide column has one page and one width. A second wide page needs a new
  record.
- `docs/development/design.md` states the rules. The application needs no
  change, and `tools/check-design-rules.mjs` needs no change.
- This refines records 0137 and 0198.
