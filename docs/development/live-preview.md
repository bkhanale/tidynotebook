# The live preview

This page owns how `packages/editor` draws the Markdown tree and how its
editing commands treat the blocks of a note. The grammar itself is in
[Markdown](markdown.md).

## What the preview shows

Reveal is per construct, never per marker.

- A block construct shows its source when the selection touches the line that
  carries its marker. A fenced block shows its fences when the selection is
  anywhere inside it.
- An inline construct shows its source when the selection touches the whole
  construct, so a cursor inside a bold word shows both marker runs.
- A bullet and a task box are drawn at every caret, and no caret rests in
  them: a tap beside a box puts the caret on the item text. A bullet is drawn
  once a space follows it. Their source comes
  back only while a range selection covers the marker, so a person sees what
  a copy takes. See
  [decision 0033](../decisions/0033-a-task-box-is-a-control-not-a-marker.md)
  and [decision 0132](../decisions/0132-a-list-marker-holds-no-caret.md).

A footnote reference shows its label as a raised mark in the quiet text
colour, and a definition shows the same mark and the footnote text of the
theme. A reference whose label the note does not define stays text, as GFM
reads it
([decision 0156](../decisions/0156-the-editor-reads-gfm-footnotes.md)). While the
parse has not reached the end of a long note, every label counts as defined,
and the tree that reaches the end draws the preview again.

An inline HTML element of `previewHtmlElements` in
`packages/markdown/src/html-elements.ts` takes its look between its two tags,
and the tags follow the reveal rule of an inline construct. Any other tag, and
each tag of an HTML block, reads as a quiet mark, and the words between the
tags read as the text of the note
([decision 0157](../decisions/0157-a-note-keeps-a-safe-set-of-html-elements.md)).

A widget exists only where text cannot express the result: an image, a diagram,
and math. A table stays editable text: each row of the source is one row of a
real table and each cell holds its own padding, so the columns line up without
a widget and every cell is edited where it stands. The padding never shows, and
a cell wraps, so a column takes the width of its text
([decision 0147](../decisions/0147-a-table-sizes-to-its-text-and-its-controls-sit-on-its-edge.md)). The delimiter row follows
the same reveal rule as every other marker, because the columns already state
what it says. Each widget covers whole lines or one span, is atomic for cursor
movement, disappears while the selection touches it, and puts the cursor at the
start of its source when clicked. A picture is a button that opens the image
viewer, and a click beside it opens the source
([decision 0145](../decisions/0145-a-click-on-a-picture-opens-the-image-viewer.md)).
A widget that cannot render falls back to its source with one short sentence,
so a note never loses text to a failed render.

## Editing commands

The commands shape lines from their text, and a command that needs the block
of a line reads the tree. `packages/editor/src/keymaps.ts` holds the keys.

- Enter on an empty list item ends the list, and an empty quoted line ends one
  level of the quote. A blank line separates the caret from the block, because
  CommonMark joins a line of text under a paragraph as a lazy continuation, and
  the published page then showed the next words inside the last item. An empty
  nested item moves out one level instead.
- Typing a fence opener and Enter never changes how the text below reads.
  `typedFenceOpeners` keeps the openers typed on the line of the caret, and
  Enter at the end of one always writes the closer. Enter at the end of an
  opener that was there before writes it only when the tree does not close
  the block and the block holds no text, so a fence of code whose language a
  person edits stays whole. Only a line whose text can open a fence is
  parsed.
  `packages/editor/src/fence-close.ts` holds the rule.
- Home is a smart Home. On a list or a quoted line it goes to the start of the
  text after the markers, and a second press goes to the start of the line,
  except into a drawn marker. `homeTarget` in
  `packages/editor/src/list-marker.ts` holds the rule.

## Cost

Decorations are built for the visible ranges only, from the tree. Nothing reads
the whole document as a string per keystroke. The preview builder reports how
many tree nodes it entered, and its unit test bounds that count for a large
document instead of timing a clock, so the test does not depend on machine
load.

## Styling

The editor writes its presentation in TypeScript, because CodeMirror builds its
own DOM and a utility class cannot reach it. Every value is a central theme
variable declared in `apps/web/src/tailwind.css`.
`packages/editor/src/editor-theme.ts` names the list, and
`tests/integration/theme-variables.test.ts` asserts that the built stylesheet
declares all of them. The published page draws the same constructs with
descendant variants in `apps/server/src/routes/published-document.ts`, which
`tests/integration/published-styles.test.ts` holds to the built stylesheet. A
code block is one card on both surfaces: in the editor, its first and its last
visible line carry the top and the bottom edge and the radius.
