# 0028. The command palette uses P

- Status: Accepted
- Date: 2026-09-13

## Context

Decision 0010 puts the command palette on `Cmd or Ctrl + K`.
`packages/editor/src/keymaps.ts` now uses that key for the Markdown link
command, so the shell and the editor compete for one input. Project board
issue 66 requires a separate palette key.

## Decision

`Cmd or Ctrl + P` opens the command palette. `Cmd or Ctrl + K` inserts a
Markdown link. `Cmd or Ctrl + O` stays as an alias for the palette. This
record replaces only the shortcut choice in decision 0010.

## Consequences

- The shell prevents the browser print action when it handles the palette key.
- The shortcut list names the palette and link commands separately.
- The Playwright matrix proves both commands from the note editor.
