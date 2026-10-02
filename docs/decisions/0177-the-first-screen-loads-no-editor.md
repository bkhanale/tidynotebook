# 0177. The first screen loads no editor

- Status: Accepted
- Date: 2026-10-02

## Context

A cold start loaded 28 script files, about 517 KB compressed, before All
notes stated the note count (issue 266, `pnpm perf:start`). About 212 KB of
it was the editor engine: the frame imported the shortcut list and the
formatting rows of the palette from `@notesapp/editor`, and that entry
loads CodeMirror. The device search of the palette imports the plain text
rule of `@notesapp/markdown`, which brought the Markdown parser and the HTML
reader of the renderer into the first route. Settings was a static part of
it too. `pnpm perf:bundle` read only the scripts that `index.html` names, so
the lazy modules of the frame and of All notes never reached the budget of
record 0136. Each module of a screen also waited for the one above it.

## Decision

- The frame imports nothing that loads the editor. The open note gives the
  palette its formatting rows through `NoteScreenActions`. The list of
  shortcuts loads with its dialog, the device search with the first search
  (`shell/device-search.ts`), and Settings with its page.
  `packages/sync` states that it has no side effects, so its unused modules
  leave a chunk.
- The first screen is the scripts that `index.html` names, the lazy chunks
  of the frame and All notes, and every chunk that they import, as
  `firstScreenScripts` of `tools/performance/first-route.ts` reads them from
  the build. `tools/performance/bundle-budget.mjs` holds that set to the size
  that this record left with a margin of about one twentieth. The figure of
  record 0136 stays the ceiling of every budget.
- `tests/integration/web-build.test.ts` fails when CodeMirror, KaTeX or
  the HTML reader of the renderer is in the first screen.
- The router starts the modules of the routes that the first address
  matches while the session check runs, so a note address loads the editor
  in parallel with the frame and its list.

This refines record 0136.

## Consequences

- A cold start of All notes reads no CodeMirror code and no renderer. The
  worker still caches them after the load (record 0044).
- A change that grows the first screen past the margin changes the budget
  line and states why.
