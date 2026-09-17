# Plan 011: Depth and hierarchy in the interface

Status: complete

> The live item is [GitHub issue 123](https://github.com/bkhanale/notesapp/issues/123) on the project board.

This plan turns [design 011](../design/011-depth-and-hierarchy.md) and decision
records 0052 to 0055 into ordered work.

## Decisions

- [0052. Three planes and one elevation scale](../decisions/0052-three-planes-and-one-elevation-scale.md)
- [0053. The divider is derived from the palette](../decisions/0053-the-divider-is-derived-from-the-palette.md)
- [0054. Motion is a named scale in one module](../decisions/0054-motion-is-a-named-scale-in-one-module.md)
- [0055. The note is one centred column](../decisions/0055-the-note-is-one-centred-column.md)
- Kept: [0015. The note surface is the design](../decisions/0015-the-note-surface-is-the-design.md)
- Kept: [0016. A theme is data in one registry](../decisions/0016-themes-are-data-in-one-registry.md)
- Kept: [0025. The live preview is the one note surface](../decisions/0025-the-live-preview-is-the-one-note-surface.md)

## Items

1. Derive the divider in `packages/ui/src/theme.ts`, name it in
   `derivedPropertyNames`, write it with every other property, and state the
   invariant in `packages/ui/src/theme.test.ts`. Update the counts in
   `apps/web/src/theme-wiring.test.ts`. Map it in the central theme of
   `apps/web/src/tailwind.css` (0053).
2. Add the elevation scale and the easing scale to the central theme of
   `apps/web/src/tailwind.css`, built from the scrim of the palette (0052).
3. Add `packages/ui/src/motion.ts` with the named transitions and its unit
   test, export it from `packages/ui/src/index.ts`, and read the names from
   every animated thing in `packages/ui` and `apps/web` (0054).
4. Give the frame header in `apps/web/src/shell/shell.tsx` the chrome plane,
   and give the raised plane its elevation step in `packages/ui/src/layout.tsx`,
   `menu.tsx`, `dialog.tsx` and the trash toast (0052).
5. Replace each divider that a person must see with the derived value, in
   `packages/ui/src/layout.tsx`, `apps/web/src/features/notes/notes-home.tsx`,
   `apps/web/src/lib/note-header-layout.ts` and the frame (0053).
6. Centre the note column in `packages/editor/src/editor-theme.ts`, hold the
   note name and the note footer to the same measure, and float the side region
   of `apps/web/src/features/editor/note-editor.tsx` so that it appears only
   when it has content (0055).
7. Raise the note name above the note heading ramp and add the heading
   tightening scale, in `apps/web/src/lib/note-header-layout.ts`,
   `apps/web/src/tailwind.css` and `packages/editor/src/editor-theme.ts` (0015).
8. Refuse a built in shadow utility, a duration utility, an easing utility and
   a transition utility outside `packages/ui/src/motion.ts`, in
   `tools/check-design-rules.mjs`, and add the negative cases to its test
   (0052, 0054).
9. Add the browser coverage: one column on the note screen, the side region
   absent on a note with no outline and no inbound link, and the three planes
   in order. Update the `AGENTS.md` of each directory that changed.

## Verification

Run `pnpm test:unit` while the work is in progress. Run `pnpm verify` before
the change is ready. Run the full browser matrix, because the note surface, the
frame and the editor rendering all change.
