# Markdown

NotesApp has one Markdown grammar and two readers of it.

- `packages/markdown` is the definition. It parses with remark (CommonMark
  plus the GFM set plus math), applies the URL policy and the sanitizer, and
  returns HTML. It is the reference.
- `packages/editor` is the live preview. It reads the Lezer Markdown syntax
  tree that CodeMirror already parses and turns it into decorations. The
  Markdown source stays the document at every position.

There is no third scanner. The outline reads the same tree through
`outlineOf(state)`.

## What holds them together

`tests/integration/markdown-equivalence.test.ts` reads the shared corpus in
`packages/markdown/test-data/content.ts` through both paths and reduces each
result to the same list of structural facts: headings with their level and
text, list items with their depth and their ordered flag, code blocks with
their info string, tables with their row and column counts, block quotes with
their depth, task items with their checked flag, and thematic breaks. The two
lists must be equal, in order.

The editor side of that list comes out of `buildPreview`, the same function
that builds the decorations, so a construct that stops being decorated also
stops being reported. Add a case to the corpus rather than writing a private
sample.

## Delimiters that are ours to choose

`packages/markdown/src/math-syntax.ts` holds the math delimiter rule and both
engines import it.

- One dollar is money. `It costs $5 and $10 today.` is text.
- Inline math is `$$...$$` or `\(...\)` on one line. Math ends at the first
  closing pair, and a pair that its line does not close stays text.
- Display math is a `$$` fence on its own line with an optional info string
  that holds no dollar sign.

remark-math gives the renderer the dollar pair only, because `\(` is a
CommonMark character escape. `packages/markdown/src/math-parens.ts` adds the
second pair as a micromark text construct on the backslash, ahead of that
escape, and it writes the tokens remark-math already reads, so both pairs
build the same node. Every other backslash keeps its CommonMark meaning:
`\\(x\)` is an escaped backslash and then text.

## Feature matrix

Renderer means `renderMarkdown` in `packages/markdown`. Preview means what the
editor shows while you type.

| Feature                            | Renderer                  | Live preview                                                     |
| ---------------------------------- | ------------------------- | ---------------------------------------------------------------- |
| ATX headings, levels one to six    | yes                       | yes, six distinct sizes, markers hidden                          |
| Setext headings                    | yes                       | yes, underline hidden                                            |
| Emphasis and strong                | yes                       | yes, escapes and intraword rules respected                       |
| Strikethrough                      | yes                       | yes                                                              |
| Inline code                        | yes                       | yes, ticks hidden, mono                                          |
| Fenced code with a language        | yes                       | yes, syntax colors, fences dimmed, language label                |
| Indented code                      | yes                       | yes                                                              |
| Block quotes, nested               | yes                       | yes, one bar per level                                           |
| Lists at any depth                 | yes                       | yes, one bullet at every depth                                   |
| Ordered list start number          | yes                       | yes, the number is kept and styled                               |
| Tight and loose lists              | yes                       | yes, one vertical rhythm                                         |
| Task lists                         | yes, disabled inputs      | yes, a real checkbox bound to its own line                       |
| Tables with alignment              | yes                       | yes, text with dim separators and per column alignment, editable |
| Footnote reference and definition  | yes, with back references | yes, styled, source kept                                         |
| Links, inline                      | yes                       | yes, target hidden, shown when the cursor is inside              |
| Reference links and definitions    | yes                       | yes, styled, brackets kept                                       |
| Autolinks, pointy, bare, and email | yes                       | yes                                                              |
| Images, attachment                 | yes                       | yes, block widget                                                |
| Images, external                   | placeholder span          | compact placeholder with a Load action and a failure message     |
| Raw HTML                           | dropped, text kept        | kept as plain text, dimmed mono                                  |
| Hard breaks                        | yes                       | marked, source kept                                              |
| Thematic breaks, `---` and `***`   | yes                       | yes, both render as a rule                                       |
| Entities                           | yes                       | left exactly as written                                          |
| Escapes                            | yes                       | left exactly as written, never emphasis                          |
| Inline math, `$$` and `\(`         | yes, both pairs           | yes, both pairs, inline, no box                                  |
| Display math                       | yes                       | yes, block widget                                                |
| Mermaid                            | placeholder `pre`         | yes, sandboxed frame                                             |
| Front matter                       | document content          | document content                                                 |

## How the preview decides what to show

Reveal is per construct, never per marker.

- A block construct shows its source when the selection touches the line that
  carries its marker. A fenced block shows its fences when the selection is
  anywhere inside it.
- An inline construct shows its source when the selection touches the whole
  construct, so a cursor inside a bold word shows both `**` runs.

Widgets exist only where text cannot express the result: an attachment image,
a Mermaid diagram, and a display math block. Each covers whole lines, is
atomic for cursor movement, disappears while the selection touches it, and
puts the cursor at the start of its source when clicked. Tables stay text so
they can be edited in place.

## Cost

Decorations are built for the visible ranges only, from the tree. Nothing
reads the whole document as a string per keystroke. `buildPreview` reports how
many tree nodes it entered, and `packages/editor/src/live-preview.test.ts`
bounds that count for a six thousand line document instead of timing a clock.

## Styling

The editor writes its presentation in TypeScript, because CodeMirror builds
its own DOM and a utility class cannot reach it. Every value is a central
theme variable declared in `apps/web/src/tailwind.css`.
`editorThemeVariables` in `packages/editor/src/editor-theme.ts` names the list
and `tools/theme-variables.test.mjs` asserts that the built stylesheet
declares all of them.

The note surface is 16 px body text on a 1.65 line height at a measure of
about 68 characters, with one heading ramp from twice the body size at level
one down to body size at level six, one vertical rhythm, and monospaced text
at 0.9 em.
