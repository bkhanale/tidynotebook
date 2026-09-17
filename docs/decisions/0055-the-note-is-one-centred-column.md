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

The side region of the outline and the inbound links never takes width from
the measure. It appears from the extra large width up, which is the first
width where the full measure and the region both fit, and not from the large
width, where the region shortened every line of the note. The outline section
inside it appears only when the note has a heading, and the panel that reads
the headings owns that section, so the two cannot disagree.

This refines [decision 0015](0015-the-note-surface-is-the-design.md), which
states that the note surface is the design, and it keeps
[decision 0025](0025-the-live-preview-is-the-one-note-surface.md), which states
that one surface reads and writes the note.

## Consequences

- The note reads as a page at every width, and the empty band is gone.
- The note reaches its full measure on every screen below the extra large
  width, because the side region is not there to shorten it.
- A note with no heading shows no outline section and no sentence about it. An
  outline of nothing is not a state worth a line.
- The side region names both of its parts, which answers
  [issue 114](https://github.com/bkhanale/notesapp/issues/114).
- `tests/e2e/note-surface.spec.ts` proves that the name, the first line and the
  footer share one centred column, and that the side region is absent at the
  large width.
