# Plan 005: The one Markdown surface

Status: complete

> The live prioritized list is [docs/releases/0.1.0.md](../releases/0.1.0.md).
> This plan stays as the record of the ordered work that shipped.

This plan turns [design 006](../design/006-the-one-markdown-surface.md) and
[decision 0025](../decisions/0025-the-live-preview-is-the-one-note-surface.md)
into ordered work. The order is the contract: remove the second surface, close
the live preview gaps, then prove the one surface.

## Decisions

- [0025. The live preview is the one note surface](../decisions/0025-the-live-preview-is-the-one-note-surface.md)
- Kept: [0002. Widgets only where text cannot express](../decisions/0002-widgets-only-where-text-cannot-express.md)
- Superseded: [0003. Read mode is the second consumer of the renderer](../decisions/0003-read-mode-uses-the-shared-renderer.md)

## Items

1. **Remove the second surface.** Delete
   `apps/web/src/features/editor/note-read-mode.tsx`. In
   `apps/web/src/features/editor/note-editor.tsx` remove the `NoteMode` state,
   the header toggle, the `Cmd or Ctrl + Shift + P` handler, the mount of
   `ReadMode`, the `hidden` class on the editor container, and the
   `renderMarkdown` ref. Relocate `diagramFramePath` into `note-editor.tsx`,
   because the editor still passes it to the diagram resolver.
2. **Remove the switch from the shell.** Drop `toggleReadMode` from
   `apps/web/src/features/editor/note-actions.tsx` and the "Toggle Read mode"
   action from `apps/web/src/shell/shell.tsx`. Remove the switch row from the
   `shortcuts` list in `packages/editor/src/keymaps.ts`.
3. **Drop the content policy exception.** Remove the `note-read-mode.tsx`
   `inner-html` entry from `tools/design-rules-allow.json`, and remove the Read
   mode line from `apps/web/AGENTS.md`. The diagram frame is the only
   `innerHTML` host left.
4. **Hide the code fence lines (MD-25, QA-25).** In
   `packages/editor/src/widgets.ts` hide the opening and the closing fence line
   of a fenced code block through the block state field, the same way the setext
   underline hides. A mermaid fence is a diagram widget, so it is left out. The
   fences show again while the selection touches the block. Fenced code is
   already highlighted in place by `packages/editor/src/language.ts`.
5. **Prove the one surface.** Retire `tests/e2e/mode-parity.spec.ts`. Add a
   browser journey that reads a note on the single surface and checks the
   heading, the code, the task, and the table. Add a `widgets.test.ts` case for
   the hidden fence lines and their reveal. The equivalence gate
   `tests/integration/markdown-equivalence.test.ts` stays the structural guard.
6. **Polish inside decision 0002.** The heading rhythm in
   `packages/editor/src/editor-theme.ts` now gives a heading more space above
   than below, from the central spacing scale. Every value stays a central
   theme variable. Deeper aesthetic tuning of a quote, a table, and a code
   block is optional and needs a live visual session, so it is not part of
   this plan.

## Verification

`pnpm verify`, then the browser journey of item 5. The equivalence corpus and
the editor decoration tests hold the render, and the new journey holds the look
of the one surface.
