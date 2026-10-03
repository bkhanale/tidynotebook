# Markdown

NotesApp has one Markdown grammar and two readers of it. The editor and the
reader must never disagree about what a document means.

- `packages/markdown` is the definition. It parses with remark, applies the URL
  policy and the sanitizer, and returns HTML. It is the reference renderer. It
  gives the one readable text that the search index holds and the device
  search reads, so every excerpt is plain (records 0162 and 0167).
- `packages/editor` is the live preview. It reads the Lezer Markdown syntax
  tree that CodeMirror already parses and turns it into decorations. The
  Markdown source stays the document at every position.

There is no third scanner. The outline reads the same tree.

See [decision 0001](../decisions/0001-one-markdown-grammar.md),
[decision 0002](../decisions/0002-widgets-only-where-text-cannot-express.md),
and [decision 0003](../decisions/0003-read-mode-uses-the-shared-renderer.md).

## What holds the two paths together

`tests/integration/markdown-equivalence.test.ts` reads the shared corpus in
`packages/markdown/test-data/content.ts` through both paths and reduces each
result to the same list of structural facts. The two lists must be equal, in
order. An ordered item carries the value a reader shows; its style and its
renumber are in [decision 0089](../decisions/0089-an-ordered-item-shows-its-place-and-keeps-its-number.md).

The editor side of that list comes out of the same function that builds the
decorations, so a construct that stops being decorated also stops being
reported. Add a case to the corpus rather than writing a private sample.

The corpus lives in a TypeScript file and not in a `.md` file for two reasons.
A browser-safe package cannot read a file from disk in a test, and Prettier
would repair the deliberately malformed Markdown that the corpus needs.

## A parse in slices

A view parses a note in slices and a later parse reuses the partial tree, so a
block syntax of the editor must parse the same however the parse was cut.
`packages/editor/src/language-resume.test.ts` stops a parse at every offset of
the corpus and of the note of block syntax beside it, continues it, and
requires the tree of one pass
([decision 0155](../decisions/0155-the-editor-grammar-parses-the-same-in-slices.md)).
A new block syntax adds its cases to that note.

## Line breaks

A new line inside a paragraph is a line break on every surface, the way
Obsidian and Notion show it. A blank line starts a new paragraph. The stored
text keeps the CommonMark soft break, so the parse that the editor, the links
and the index read is CommonMark, and only the renderer writes the break
element. The two CommonMark hard break forms give the same break element.

The live preview keeps each source line on its own line and joins nothing,
so a paragraph never reflows under the caret. It hides the marker of a hard
break while the selection is away from its paragraph. Shift and Enter write a
plain new line that stays inside the list item or the quote. See
[decision 0107](../decisions/0107-a-new-line-is-a-line-break.md).
`render.test.ts` and `widgets.test.ts` hold the rule, and the corpus holds
one break of each kind.

## Delimiters that are ours to choose

`packages/markdown/src/math-syntax.ts` holds the math delimiter rule, and both
engines import it.

- Inline math is a doubled dollar pair, a backslash parenthesis pair, or one
  dollar by the rule of Pandoc. A dollar run closes on a run of its own size
  and can span lines; the other two forms stay on one line. One dollar opens before a
  character that is not a space and closes after one, with no digit after
  it, so a price stays text
  ([decision 0171](../decisions/0171-one-dollar-opens-math-by-the-rule-of-pandoc.md)).
  A pair that its line does not close stays text.
- Display math is a doubled dollar fence on its own line.

A footnote label follows the rule of GFM. `packages/markdown/src/footnote-syntax.ts`
states it, the editor grammar reads it, and its test compares it with remark
([decision 0156](../decisions/0156-the-editor-reads-gfm-footnotes.md)).

remark-math gives the renderer the dollar pair only, because the backslash pair
is a CommonMark character escape. `packages/markdown/src/math-parens.ts` adds
the second pair as a text construct on the backslash, ahead of that escape, and
`packages/markdown/src/math-dollar.ts` the one dollar, both with the tokens
remark-math already reads, so every form builds the same node. Every other
backslash keeps its CommonMark meaning. The editor reads one dollar through
`dollarMathEnd` of `math-syntax.ts`, the one scan of the rule.

## The live preview

How the editor draws the tree, its editing commands, its cost and its styling
are in [The live preview](live-preview.md).

## Safety

A note keeps the HTML elements of `packages/markdown/src/html-elements.ts`,
parsed with parse5, and the live preview draws the inline ones. Any other
element keeps its text alone
([decision 0157](../decisions/0157-a-note-keeps-a-safe-set-of-html-elements.md)).
A tag of GFM tagfilter and `select` reads as text, so no unclosed tag takes the
rest of the note, and the nesting of the HTML counts against the depth limit
([decision 0160](../decisions/0160-an-unclosed-tag-never-takes-the-rest-of-a-note.md)).
The URL policy keeps a small set of schemes and the two internal prefixes, and
it removes the destination of anything else rather than following it. An
external image loads over HTTPS and no other scheme, and it carries
`referrerpolicy="no-referrer"`. See
[decision 0067](../decisions/0067-an-external-picture-loads-by-itself.md).

`packages/markdown/src/policy.ts` is the one definition of both rules. A change
there is a change to the security surface, so it needs a test that proves the
refusal.

## Code and diagrams

`packages/markdown/src/code-languages.ts` is the one list of the languages of a
fence, and `code-tokens.ts` maps their tokens to the syntax colours. The
renderer and the editor read both, so a fence has one set of colours
([decision 0159](../decisions/0159-one-highlighter-colours-code-on-both-surfaces.md)).
Each entry is a CodeMirror language: the renderer reads its parser and the
editor mounts it whole, so a fence also keeps the editing of its language
([decision 0173](../decisions/0173-a-fence-language-is-a-codemirror-language-of-the-one-list.md)).
The published page draws a diagram in the frame of the editor with one script
that its policy names, and shows the source with no script
([decision 0158](../decisions/0158-a-published-diagram-draws-in-the-frame-of-the-editor.md)).
A diagram takes every colour from the palette and draws no shadow, in any kind
and any theme. `diagramThemeOptions` in `apps/web/src/diagram/frame.ts` holds
both rules, and its test walks the whole registry.

## Limits

A member of a workspace, or anybody who signs up, can write a note that the
server and every device parse, so the work of a parse stays in proportion to
the size of the note
([decision 0186](../decisions/0186-the-parse-of-a-note-grows-with-its-size.md)).
`packages/markdown/src/limits.ts` states four counts: the size of a note, the
nesting depth, the marks of one inline block, and the table cells of a note.

One reading of the lines runs before the parse. It checks the size and the
nesting of each line prefix, counts the table cells from a delimiter row to
the next blank line, and counts the marks of each part between blank lines.
Only when a part holds more marks than one block may, a parse with every
inline construct off finds the blocks of the one grammar, and each is held
to the limit (`parse.test.ts`). After the parse, the depth of the tree and of
the HTML of a note is checked.

There is no wall-clock timeout and no cost score, so a note passes or fails
the same way on every machine. Every entry point parses through
`parseMarkdown`, and the editor keeps its Markdown language only for a note
within `withinParseLimits` (`packages/editor/src/grammar-gate.ts`). A refused
note is never truncated: a reader shows its source, and the boundary answers
the domain code of each limit with a sentence the person can read.
