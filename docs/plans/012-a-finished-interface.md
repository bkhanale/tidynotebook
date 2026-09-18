# Plan 012: A finished interface

Status: complete

> The live items are [GitHub issues 129 to 135](https://github.com/bkhanale/notesapp/issues?q=is%3Aissue+%22Interface+012%22) on the project board.

This plan turns [design 012](../design/012-a-finished-interface.md) and decision
records 0061 to 0065 into ordered work. The system that the work builds is
[the design guide](../development/design.md).

## Decisions

- [0061. The application is set in one vendored family](../decisions/0061-the-application-is-set-in-one-vendored-family.md)
- [0062. The default action is ink and the blue carries meaning](../decisions/0062-the-default-action-is-ink-and-the-blue-carries-meaning.md)
- [0063. The resting edge of a control is the divider](../decisions/0063-the-resting-edge-of-a-control-is-the-divider.md)
- [0064. The frame header is the context of the route](../decisions/0064-the-frame-header-is-the-context-of-the-route.md)
- [0065. One recipe for a control and one grid for an icon](../decisions/0065-one-recipe-for-a-control-and-one-grid-for-an-icon.md)

## Items

1. Foundation. Vendor Geist and Geist Mono in `apps/web/public/fonts`, declare
   them in `apps/web/src/tailwind.css`, record them in
   `packages/ui/THIRD_PARTY_LICENSES.md`. Add `--radius-xl`, `--text-kbd`, a
   44 px header, and the note measure of 40 rem to the central theme. Derive
   the tone surfaces in `packages/ui/src/theme.ts` and prove them in
   `theme.test.ts`. Make the Default accent ink in
   `packages/ui/src/themes/default.ts` and hold the fallbacks of the stylesheet
   to the registry in `tests/integration/theme-variables.test.ts` (0061, 0062).
2. Recipes. Rewrite `packages/ui/src/control-classes.ts` with `buttonClassName`
   (four variants), `rowClassName`, `fieldClassName` and `kbdClassName`, the one
   focus treatment and `edge-line` at rest, and prove each in
   `control-classes.test.ts`. Redraw `packages/ui/src/icons.tsx` at a stroke of
   1.5, remove the unused icons, add the icons the menus and the palette need,
   and prove the grid in a `.ts` test. Rebuild `controls.tsx` (one `TextField`,
   a `Checkbox`), `layout.tsx` (`EmptyState` with no box, `ListRow` on
   `rowClassName`), `menu.tsx`, `dialog.tsx`, `notice.tsx`, `loading.tsx`, and
   add `toast.tsx`. Update `packages/ui/AGENTS.md` (0063, 0065).
3. The gate. Extend `tools/check-design-rules.mjs` with the rules of record
   0065 and scan `packages/editor/src` and
   `apps/server/src/routes/published-document.ts`. Add the negative cases to
   `check-design-rules.test.mjs`. Remove every entry of
   `tools/design-rules-allow.json` that the new primitives make unnecessary
   (0065).
4. The frame. Add `apps/web/src/shell/header-slot.tsx`. Rebuild the header in
   `apps/web/src/shell/shell.tsx` as the breadcrumb, the route actions, Search
   and the account avatar. Rebuild the sidebar as rows: the switcher in
   `apps/web/src/shell/workspaces.tsx`, the Search and New note rows, the
   Folders label with New folder, the tree rows in `apps/web/src/lib/tree-row.ts`
   with no guide lines, and the footer rows. Give every row of the command
   palette in `apps/web/src/shell/command-palette.tsx` its icon. Make `KeyHint`
   in `apps/web/src/shell/key-hint.tsx` draw one key cap for each key with the
   signs of the device from `apps/web/src/shell/modifier-key.ts`. Update
   `apps/web/AGENTS.md` and the unit tests of the breadcrumb and the tree row
   modules of `apps/web/src/lib/` (0064).
5. The note. Set the note in Geist through `packages/editor/src/editor-theme.ts`
   with muted list markers, a drawn task box, `edge-line` on a quote, a
   `rounded-lg` code block and no active line fill. Hold the heading ramp under
   the name. Remove the rules of the name row and the footer in
   `apps/web/src/lib/note-header-layout.ts` and
   `apps/web/src/features/editor/note-footer.tsx`. Place History, Publish and
   the note menu in the header slot from `apps/web/src/features/editor/`.
   Update `packages/editor/AGENTS.md` (0061, 0064).
6. The screens. Rebuild `apps/web/src/features/notes/notes-home.tsx` on
   `ListRow`, `apps/web/src/features/accounts/accounts.tsx` as sections with a
   segmented appearance control and ink chosen chips, and the sign in screen
   with the monochrome mark. Rebuild `history.tsx`, `trash.tsx` on `Toast`,
   `published-links.tsx`, `publish-dialog.tsx`, `attention.tsx`, the folder
   dialogs of `folders.tsx` on one `TextField`, and every error page on `Page`
   and `PageHeader`. Give `apps/server/src/routes/published-document.ts` the
   same class strings (0062, 0063, 0065).
7. Verification. Run `pnpm verify`. Prove records 0062 and 0064 in the pure
   modules: the one primary variant in
   `packages/ui/src/control-classes.test.ts`, the breadcrumb of the open note
   in `apps/web/src/lib/breadcrumb.test.ts`, and the row with no ring in
   `apps/web/src/lib/tree-row.test.ts`. Take a screenshot of every screen in
   light and in dark, and let the owner read each one against the guide. Set
   this plan to complete and design 012 to complete.

## Verification

Run `pnpm test:unit` while the work is in progress. Run `pnpm verify` before
the change is ready. No browser suite exists, so the frame, the navigation, the
note surface and the editor rendering rest on the pure modules, on the
integration tests of the built stylesheet and the served document, and on a
screenshot of every screen in light and in dark that the owner reads. See
[record 0066](../decisions/0066-the-browser-suite-is-retired.md).
