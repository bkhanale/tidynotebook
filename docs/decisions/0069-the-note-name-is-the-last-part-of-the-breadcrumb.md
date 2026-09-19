# 0069. The note name is the last part of the breadcrumb

- Status: Accepted
- Date: 2026-09-20

## Context

Record 0064 gives the frame header a breadcrumb whose last part is the name of
the route, and record 0055 puts the note name at the top of the note column as
the largest text of the screen. A person who opens a note therefore reads that
name twice, once in the header and once under it, and the sticky row in
`apps/web/src/features/editor/note-header.tsx` takes the first band of the note
for a word the header already states. The sidebar repeats the header the same
way: a Search row in `apps/web/src/shell/shell.tsx` opens the palette that the
header Search button opens. The note route also spends two header controls on
History and Publish, and on a phone those two stand beside the drawer toggle,
the breadcrumb, Search and the account, so the name has almost no width left.

## Decision

The last part of the breadcrumb is the name of the note, and it is the field a
person types the name into.

- `apps/web/src/shell/header-slot.tsx` carries a second slot. `HeaderLeafSlot`
  is the element of the breadcrumb that holds the last part, and `HeaderLeaf`
  is what a route renders to claim it. A route that claims the part replaces
  the word the frame would draw; a route that claims none keeps that word.
- The note route claims it with the name field. The note surface draws no
  header row, so the note text starts at the top of the page.
- The reason a name cannot be kept is one message on the note, not a line
  under a field that is now in the header.
- The note route puts one control in the header: the note menu. History and
  Publish are rows of that menu.
- The sidebar holds no Search row. Search is in the header and on `Cmd or
Ctrl + P`.

This refines records 0064, 0055 and 0015. The note name is no longer the
largest text of the note screen, and `text-3xl` now names a note on the
published page alone.

## Consequences

- The note screen shows one name and gives the whole page to the note.
- A phone header holds five controls where it held seven. That, and a gap of
  one step below the medium width, is what gives the name its room. The
  icon-only controls also take the compact recipe, so each keeps its touch
  target and draws the smaller mark that the rest of the product draws.
- History stops being an anchor, so a middle click no longer opens it in a new
  tab. The address stays, so a link to it still works.
- `apps/web/src/lib/note-name-field.ts` decides the name field,
  `apps/web/src/lib/note-menu.ts` decides the rows of the note menu, and
  `apps/web/src/lib/note-column.ts` decides the column the note and its footer
  share. Their unit tests hold each rule, and
  `tests/integration/note-editor-output.test.ts` reads the built result.
- This answers [issue 144](https://github.com/bkhanale/notesapp/issues/144).
