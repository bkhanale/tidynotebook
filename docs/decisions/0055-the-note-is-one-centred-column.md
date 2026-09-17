# 0055. The note is one centred column

- Status: Accepted
- Date: 2026-09-17

## Context

`editorTheme` in `packages/editor/src/editor-theme.ts` gave a line the note
measure as a maximum width and pinned its inline margin to zero, so the text
started at the left edge of the editor column. `note-editor.tsx` in
`apps/web/src/features/editor/` put a side region of a fixed width to the right
of that column at the large width, whether or not the region had anything to
say. On a wide screen a band of empty canvas sat between the two, and the note
name and the word count were not held to the measure at all, so the parts of
one page did not share one column.
See [design 011](../design/011-depth-and-hierarchy.md).

## Decision

The note name, the note text and the note footer are one centred column of the
note measure. The editor adapter centres a line and a block widget in the space
the editor owns, and the header and the footer hold their content to the same
measure and centre it the same way.

The outline and the inbound links are not a column of the frame. They float
over the outer gutter of the note screen from the extra large width up, and
they are in the frame only when the note has an outline or an inbound link.

This refines [decision 0015](0015-the-note-surface-is-the-design.md), which
states that the note surface is the design, and it keeps
[decision 0025](0025-the-live-preview-is-the-one-note-surface.md), which states
that one surface reads and writes the note.

## Consequences

- The note reads as a page at every width, and the empty band is gone.
- The side region no longer takes width from the text at the large width, so
  the measure is reached on more screens.
- A person who wants the outline on a narrow screen reaches it through the
  command palette, not through a column that never fits.
- `tests/e2e/note-surface.spec.ts` proves that the name, the first line and the
  footer share one column, and that the side region is absent when the note has
  no outline and no inbound link.
