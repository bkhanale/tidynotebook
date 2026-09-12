# 0025. The live preview is the one note surface

- Status: Accepted
- Date: 2026-09-12

## Context

The note screen shows one note through two surfaces: the live preview editor in
`packages/editor` and Read mode in
`apps/web/src/features/editor/note-read-mode.tsx`, with a toggle and the key
`Cmd or Ctrl + Shift + P`. The live preview already renders every construct a
reader needs. Decision 0003 built Read mode to give `renderMarkdown` a user, so
the renderer would not drift from the editor. The equivalence gate
`tests/integration/markdown-equivalence.test.ts` now holds the two paths equal,
so that job no longer needs a surface a person sees. See
[design 006](../design/006-the-one-markdown-surface.md).

## Decision

The live preview is the one surface that a person reads and writes on. Read
mode, the Write and Read toggle, the `Cmd or Ctrl + Shift + P` switch, the
`toggleReadMode` action, and `note-read-mode.tsx` are removed. `renderMarkdown`
in `packages/markdown` stays as the reference oracle of the equivalence gate and
for readers that need HTML, such as export, the server index, and a future
share page. It keeps no surface that a person sees. A table and a block quote
stay editable text under decision 0002, so the one surface never draws a
bordered HTML table. This record supersedes decision 0003.

## Consequences

- The web application has one Markdown reader, so a rendering fault shows on the
  edit surface at once. The sandboxed diagram frame becomes the only `innerHTML`
  host, and `apps/web/AGENTS.md` drops the Read mode exception.
- The large note error state of Read mode is gone, because the source is always
  editable on the one surface.
- A person no longer gets a bordered HTML table or block level HTML for a quote
  or a code block. This is the cost of the closed widget set of decision 0002.
- `tests/e2e/mode-parity.spec.ts` retires. A new browser journey reads a note on
  the single surface and checks the heading, the code, the task, and the table.
  The equivalence gate stays the structural guard.
