# 0177. The first screen loads no editor

- Status: Accepted
- Date: 2026-10-02

## Context

A cold start loaded 28 script files, about 517 KB compressed, before All
notes stated the note count (issue 266, `pnpm perf:start`). About 212 KB of
it was the editor engine: the frame imported the shortcut list and the
formatting rows of the palette from `@notesapp/editor`, and that entry
loads CodeMirror. `pnpm perf:bundle` read only the scripts that
`index.html` names, so the lazy modules of the frame and of All notes never
reached the budget of record 0136. Each module of a screen also waited for
the one above it: the session check, then the frame, then the page.

## Decision

- The frame imports nothing that loads the editor. The open note gives the
  palette its formatting rows through `NoteScreenActions`, and the list of
  shortcuts loads with its dialog.
- The first screen is the scripts that `index.html` names and every module
  that the frame and All notes import, as `firstScreenScripts` of
  `tools/performance/first-route.ts` reads them from the build. The budget of
  record 0136 holds that whole set, so the gate measures more than before
  and its figure keeps its source.
- `tests/integration/web-build.test.ts` fails when the editor engine, KaTeX
  or Mermaid is in the first screen.
- The router starts the modules of the routes that the first address
  matches while the session check runs, so a note address loads the editor
  in parallel with the frame and its list.

This refines record 0136. It excludes a lower figure in
`tools/performance/bundle-budget.mjs` without a source.

## Consequences

- A cold start of All notes reads no CodeMirror code. The worker still
  caches the editor after the load (record 0044).
- A new import of the editor package in the frame fails the gate.
