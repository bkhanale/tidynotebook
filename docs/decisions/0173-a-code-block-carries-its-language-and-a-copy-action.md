# 0173. A code block carries its language and a copy action

- Status: Accepted
- Date: 2026-10-02

## Context

A fence of the editor hides its fence lines while the caret is away, so its
language is not on the screen, and no surface copies a code block (issue 242,
audit finding 5). Record 0002 keeps the set of widgets closed. A published
page names one script only, for a diagram (record 0158). See
[design 022](../design/022-markdown-of-other-tools.md).

## Decision

- `codeBlockLabel` of `packages/markdown/src/code-languages.ts` names a block:
  the label of a listed language, the first word of any other info string,
  and nothing for no info string. A Mermaid fence is a diagram, not a block.
- `renderMarkdown` writes a fenced or indented block as a `figure` with the
  class `notes-code`, its label in a `figcaption`, and the `pre` inside.
- The editor draws a bar at the top of each code card in a layer over the
  text, as the controls of a table do (record 0147): the label and a copy
  button. It is no widget and holds no caret. The first line of the card keeps
  the room of the bar.
- The copy writes the code of the block, as the renderer reads it, to the
  clipboard. The button is a recipe of `packages/ui`, has an accessible name,
  takes the focus, and says Copied for two seconds.
- The one script of a published page is `apps/web/src/published/page.ts`,
  built as `assets/published-page-<hash>.js`. It draws the diagrams of record
  0158 and puts a copy button on each code block. A page that holds a diagram
  or a code block names it in `script-src` by its exact address, and only a
  page with a diagram names the frame. A page with neither keeps
  `script-src 'none'`. With no script a reader reads the label and the code.

This refines records 0002 and 0158.

## Consequences

- A person reads the language of every block and copies it with one press or
  one key, in the note and on a published page.
- A published page with code runs one file of the build.
- `render.test.ts` holds the figure, `security-headers.test.ts` and
  `published-document.test.ts` the policy and the page, `code-controls.test.ts`
  the text that a copy takes, and `tests/integration/published-page.test.ts`
  the served page.
