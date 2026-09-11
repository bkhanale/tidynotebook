# Audit: Markdown authoring and rendering

Audited on 2026-09-10 against commit `40eebba`.

Scope: `packages/markdown`, `packages/editor`, `apps/web/src/features/note-editor.tsx`,
`apps/web/src/diagram`, and the tests of those areas. Read only audit.

## Summary

The offline renderer in `packages/markdown` is the strongest part of this area. It is
correct on the CommonMark and GFM feature list, and its security tests are real tests.
The problem is that the application never uses it. The screen the user types in gets its
appearance from a second, hand written regular expression scanner in `packages/editor`,
so the product ships a preview that disagrees with its own renderer on escapes, footnotes,
autolinks, setext headings, thematic breaks, tables and code blocks. The three biggest
problems are: (1) a table, a diagram, a display math block and an image can not be edited
in place, and a keystroke after "Show source" deletes the whole block (MD-01); (2) the
KaTeX stylesheet is never loaded, so every rendered formula appears as scrambled text
(MD-02); (3) two, in fact three, independent Markdown implementations exist and drift is
already visible, which makes every future Markdown fix a three place fix (MD-08). The
editor also has no formatting shortcuts, no find and replace and no link completion, so
the authoring experience is below the stated goal. Total volume in this area is about
5,400 source lines, and 780 of them defend a single user machine against itself.

## Findings

| ID    | Sev | Area          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                  | File:line                                                                                                                            | Recommended fix                                                                                                                                                                                       |
| ----- | --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MD-01 | P0  | Live preview  | A rich block (table, diagram, display math, inline math, image) always replaces its source range. The state field updates only on a document change and never reads the selection, and `revealSource` selects the whole range while the widget stays. The next keystroke replaces the entire block.                                                                                                                                                          | `packages/editor/src/widgets.ts:648`, `:617`, `:376`                                                                                 | Rebuild the set on `selectionSet` too and drop any widget whose range intersects the selection or the cursor line. Add `EditorView.atomicRanges` for the widgets that remain.                         |
| MD-02 | P1  | Math          | `katex.min.css` is never imported in the web app or in the share page shell, so KaTeX output has no fonts, no strut heights and no absolute positioning. Every formula appears as a run of loose glyphs.                                                                                                                                                                                                                                                     | `apps/web/index.html:1`, `apps/web/src/tailwind.css:1`, `packages/editor/src/widgets.ts:535`, `apps/server/src/public/page.ts:41`    | Import `katex/dist/katex.min.css` from the deferred math module in the web app, and inline the needed rules and font faces in the share page shell.                                                   |
| MD-03 | P1  | Live preview  | `updateDOM` returns `true` for every widget without touching the DOM. CodeMirror calls it only when the new widget is not equal to the old one, so a source edit that keeps the range length leaves the old preview on screen. Change one table cell character or `$x$` to `$y$` and the preview goes stale.                                                                                                                                                 | `packages/editor/src/widgets.ts:409`                                                                                                 | Return `false`, or re-render the preview inside `updateDOM` and return `true` only for the diagram case where the source is unchanged.                                                                |
| MD-04 | P1  | Live preview  | Clicking a checkbox toggles the task of the current selection, not of the clicked line, because `toggleTaskSpec` reads `state.selection`. Verified: cursor on line 1, click on the line 3 box, line 1 flips. When the selected line holds no task the click does nothing at all.                                                                                                                                                                             | `packages/editor/src/create-editor.ts:177`, `packages/editor/src/commands.ts:54`                                                     | Pass the clicked position into a `toggleTaskAt(state, position)` command and keep `toggleTaskSpec` for the keyboard path.                                                                             |
| MD-05 | P1  | Live preview  | The scanner starts with `inFence = null` for every visible range. When the viewport starts inside a fenced block, the closing fence is read as an opening fence, so prose below a code block is styled as code and `#` inside code becomes a heading. Long notes with code blocks show this while scrolling.                                                                                                                                                 | `packages/editor/src/live-preview.ts:294`, `:430`                                                                                    | Derive the fence state from the Lezer tree (`syntaxTree`), or scan from the last known safe block start, not from the viewport start.                                                                 |
| MD-06 | P1  | Live preview  | Escapes and intraword rules are ignored. `\*star\*` is shown as italic `star\` with the escapes hidden, and `do_a_thing` becomes `do` italic `a` `thing`. The renderer prints literal asterisks and no emphasis. The preview therefore hides characters that are really in the file.                                                                                                                                                                         | `packages/editor/src/live-preview.ts:215`                                                                                            | Use the Lezer Markdown tree for marker ranges. It already handles escapes, flanking rules and intraword underscores.                                                                                  |
| MD-07 | P1  | Renderer      | Wiki references are a first class feature in the editor and in the index, but the renderer has no handler for them, so `[[Title]]` reaches HTML as literal text. The application also never resolves one; it shows "resolves in a later task".                                                                                                                                                                                                               | `packages/markdown/src/links.ts:64`, `:178`, `packages/editor/src/live-preview.ts:265`, `apps/web/src/features/note-editor.tsx:1018` | Either resolve wiki references (a title to file map passed into the renderer and into the editor) or remove the syntax from v0.1. Half support is worse than none.                                    |
| MD-08 | P1  | Architecture  | Three Markdown implementations exist: remark in `packages/markdown`, a regular expression scanner in `packages/editor`, and a third heading scanner for the outline panel. The corpus file states that every consumer checks itself against one document, but `packages/editor` does not depend on `@notesapp/markdown` at all, although the boundary checker already allows it.                                                                             | `packages/markdown/test-data/content.ts:1`, `tools/check-boundaries.mjs:38`, `apps/web/src/features/backlinks.tsx:13`                | See the architecture section. One parse per document, shared by preview, outline and links.                                                                                                           |
| MD-09 | P1  | Ergonomics    | No formatting keymap at all: no bold, italic, inline code, link, list toggle, heading level, block quote or indent commands. No find and replace (`@codemirror/search` is absent). No completion for note links or wiki links (`@codemirror/autocomplete` is absent). Only Mod-s, Mod-Enter and Alt-Enter are bound.                                                                                                                                         | `packages/editor/src/create-editor.ts:127`, `packages/editor/package.json:17`                                                        | Add a Markdown command set (Mod-b, Mod-i, Mod-k, Mod-e, Mod-1..6, Mod-Shift-l), `search(...)` with `searchKeymap`, and an `autocompletion` source for `[[` and `](` note links.                       |
| MD-10 | P1  | Performance   | Every keystroke runs a full document rescan and a compartment reconfigure. `buildRichWidgetDecorations` calls `doc.toString()` and `findRichWidgets` over the whole file, and `inside()` is linear per match, so cost grows faster than the document. The attachment effect runs on every keystroke and always calls `setAttachmentUrls(new Map(...))`, so `richResolvers` is a new object every keystroke and `setEditorRich` reconfigures the field again. | `packages/editor/src/widgets.ts:622`, `:167`, `apps/web/src/features/note-editor.tsx:409`, `:437`, `:459`, `:478`                    | Keep the map identity stable when nothing changed, memoize the resolvers on primitive values, and scan widgets per changed range or from the syntax tree.                                             |
| MD-11 | P2  | Theme         | The editor adapter reads `var(--font-mono)`, `var(--text-ui)`, `var(--radius-sm)` and the `--color-*` tokens, but `@theme inline` does not emit those custom properties. The built stylesheet contains none of them, so inline code, code blocks and the widget source fall back to the proportional font and lose their radius.                                                                                                                             | `packages/editor/src/live-preview.ts:511`, `packages/editor/src/create-editor.ts:82`, `apps/web/src/tailwind.css:4`                  | Declare the fonts, sizes and radii the editor needs as real variables (a plain `@theme` block or an explicit `:root` block in the one allowed CSS file).                                              |
| MD-12 | P2  | Live preview  | Every widget is a bordered box with a visible "Show source" button, including inline math. `$x$` inside a sentence becomes a block panel with a button, so the paragraph breaks apart.                                                                                                                                                                                                                                                                       | `packages/editor/src/widgets.ts:423`, `:555`                                                                                         | Render inline math as an inline span with no chrome, and reserve the box and the button for block level previews.                                                                                     |
| MD-13 | P2  | Both paths    | Single dollar math is on, so `It costs $5 and $10 today.` becomes a math widget in the editor and math in the renderer. Currency in notes is common.                                                                                                                                                                                                                                                                                                         | `packages/editor/src/widgets.ts:247`, `packages/markdown/src/parse.ts:44`                                                            | Set `singleDollarTextMath: false` in remark-math and require `$$` or `\(...\)` for inline math, and match the editor scanner to it.                                                                   |
| MD-14 | P2  | Live preview  | Table detection does not follow GFM. The delimiter row is matched by a loose character class and the cell count is never compared, so `a                                                                                                                                                                                                                                                                                                                     | b`followed by`---`, which is a setext heading, becomes a table widget that then falls back to a large "cannot be previewed" box.     | `packages/editor/src/widgets.ts:274`, `:337`                                                                                                                                                          | Take the table range from the syntax tree, or compare the delimiter cell count with the header cell count as GFM requires. |
| MD-15 | P2  | Live preview  | Many constructs are not styled at all: setext headings, thematic breaks (and `* * *` is shown as a bullet), footnote definitions and references, autolinks and bare URLs, images (only the link brackets are handled), indented code blocks, headings and lists inside a block quote, and emphasis that spans two lines.                                                                                                                                     | `packages/editor/src/live-preview.ts:291` to `:323`                                                                                  | Same fix as MD-06. A tree walk covers all of these for free.                                                                                                                                          |
| MD-16 | P2  | Math          | Three math defects. `sanitizeMathHtml` drops every element that is not a `span`, and KaTeX draws the square root radical with an inline `svg`, so `\sqrt{x}` loses its radical sign. `strict: 'error'` refuses any Unicode text in math mode, so `$café$` falls back to raw source. `output: 'html'` with no MathML marks all output `aria-hidden`, so a screen reader reads nothing.                                                                        | `packages/markdown/src/math.ts:171`, `:236`, `:237`                                                                                  | Allow `svg`, `path` and `line` with a numeric attribute allow list, use `strict: 'warn'`, and use `output: 'htmlAndMathml'`.                                                                          |
| MD-17 | P2  | Live preview  | Rich widgets use an inline `Decoration.replace` for ranges that cross line breaks and put block level DOM (`div`, `table`, `iframe`) inside it. CodeMirror can not measure that reliably, and there are no atomic ranges, so arrow keys walk into hidden text with no visible cursor.                                                                                                                                                                        | `packages/editor/src/widgets.ts:631`                                                                                                 | Use `Decoration.replace({ block: true })` with ranges that cover whole lines for tables, diagrams and display math, and declare `atomicRanges`.                                                       |
| MD-18 | P2  | Architecture  | 780 source lines and 635 test lines implement a parse cost pre-scan with thirteen limits, for a single user, self hosted application where the only author is the only attacker. `MarkdownLimitError` is not handled anywhere outside the package, so a note above the limits produces a 500 from the backlinks read instead of a message.                                                                                                                   | `packages/markdown/src/limits.ts:55`, `packages/storage-server/src/workspace-store.ts:550`                                           | Keep the input size cap and the nesting cap, delete the rest, and surface the one remaining error as a user message.                                                                                  |
| MD-19 | P2  | Accessibility | The container `div` around CodeMirror declares `role="textbox"` and an `aria-label`, and CodeMirror puts a second textbox inside it. `.cm-activeLine` is styled but `highlightActiveLine()` is not installed, so that rule is dead. `indentWithTab` captures Tab, which traps keyboard users inside the editor.                                                                                                                                              | `apps/web/src/features/note-editor.tsx:783`, `packages/editor/src/create-editor.ts:101`, `:165`                                      | Remove the outer role, label the CodeMirror content element, install `highlightActiveLine()` or drop the rule, and follow the CodeMirror advice for Tab (Escape then Tab, or a Mod-] and Mod-[ pair). |
| MD-20 | P2  | Ergonomics    | Paste and drop only accept image files. A pasted URL over a selection does not become a link, although `lang-markdown` exports `pasteURLAsLink` for exactly that. Pasted HTML arrives as plain text with no Markdown conversion. There is no attach button, no upload progress and no way to retry a failed upload.                                                                                                                                          | `apps/web/src/features/note-editor.tsx:787`, `:794`, `:566`                                                                          | Add `pasteURLAsLink`, an HTML to Markdown paste path, a file picker, and a progress and retry state for uploads.                                                                                      |
| MD-21 | P2  | Live preview  | Reveal is per marker, not per construct. With the cursor inside the word of `**bold**` both delimiters stay hidden, and moving in from the left reveals the opening pair only. The user edits inside characters they can not see. Obsidian, Typora and Bear all reveal a whole construct or a whole line.                                                                                                                                                    | `packages/editor/src/live-preview.ts:341`, `:359`                                                                                    | Reveal every marker that belongs to a construct or a line the selection touches.                                                                                                                      |
| MD-22 | P2  | Live preview  | Task boxes stay as the literal text `[ ]` and code ticks are never hidden, because `partitionMarkers` always reveals them. So the two most common inline constructs never look rendered.                                                                                                                                                                                                                                                                     | `packages/editor/src/live-preview.ts:370`                                                                                            | Replace the box with a real checkbox widget that carries its own position, and hide code ticks like any other marker.                                                                                 |
| MD-23 | P3  | Renderer      | The math placeholder round trip serializes to HTML and then re-parses it with a regular expression, and the decode chain expands `&#x26;` before the named entities, so an author written `&lt;` inside math becomes `<`. There is no injection risk, because KaTeX escapes its text and the output is sanitized, but the design is fragile.                                                                                                                 | `packages/markdown/src/render.ts:248`, `:274`                                                                                        | Render math on the hast tree with a raw node, or keep the source on the node and render before serialization.                                                                                         |
| MD-24 | P3  | Architecture  | Dead or unreachable code. `publicSharePage` is exported but no route registers it, so the only consumer of `renderMarkdown` is unreachable. `applyHeading`, `headingSlug`, `markdownLimits`, `parseTableSource`, `findRichWidgets`, `buildLivePreviewDecorations`, `scanTextMarkers` and `partitionMarkers` are used by tests only. `unified-diff.ts` and the `diff` dependency live in the editor package but serve the history screen.                     | `apps/server/src/index.ts:91`, `packages/editor/src/index.ts:8`, `packages/editor/src/create-editor.ts:258`                          | Register the share route or delete the page, move the diff helper into its own module, and stop exporting internals that only tests use.                                                              |
| MD-25 | P3  | Live preview  | The preview table ignores the alignment row, although the renderer emits `align` on every cell, and `parseTableSource` already returns the information. Fenced code shows no syntax colors, and the info string of a fence stays visible as bare text on its own line.                                                                                                                                                                                       | `packages/editor/src/widgets.ts:321`, `:497`, `packages/editor/src/live-preview.ts:296`                                              | Apply the alignment, install `syntaxHighlighting` with `codeLanguages`, and hide or style the info string.                                                                                            |
| MD-26 | P3  | Live preview  | Heading levels 4, 5 and 6 all get the level 3 style, so the outline is not visible in the text. There is also no heading folding.                                                                                                                                                                                                                                                                                                                            | `packages/editor/src/live-preview.ts:383`                                                                                            | Add the missing levels and `foldGutter` with the Markdown fold service.                                                                                                                               |
| MD-27 | P3  | Diagrams      | The frame listener is not `once`, although the comment says the frame waits for exactly one request, and it does not check the message origin. One iframe per diagram means one Mermaid instance per diagram. The external image button says "Load ..." but only reveals the source.                                                                                                                                                                         | `apps/web/src/diagram/frame.ts:306`, `packages/editor/src/widgets.ts:480`                                                            | Use `{ once: true }`, ignore a second request, and rename the button to "Show source" or make it import the bytes.                                                                                    |

## Security assessment

The security work in `packages/markdown` is sound, and the tests prove the important
properties rather than the output text.

- Raw HTML never reaches the reader. `remarkRehype` runs with `allowDangerousHtml: false`
  (`render.ts:293`), so a `script` block, an `onerror` attribute and an inline `b` element
  all disappear and only their text stays. Verified with a probe run.
- URL policy is an allow list (`policy.ts:71`). `javascript:`, `data:`, `vbscript:`,
  `file:`, protocol relative `//host`, control characters inside a scheme and every other
  relative path are blocked, and a blocked link keeps its text. An SVG data URI image is
  blocked. External links get `rel="noopener noreferrer"` and never a `target`.
- The sanitize schema is written out rather than derived (`policy.ts:156`), which is the
  right choice here. `id` values must carry the `user-content-` prefix, so a note can not
  clobber a page identifier, and the footnote prefix is applied once only.
- Math runs with `trust: false`, `strict: 'error'` and bounded `maxSize` and `maxExpand`
  (`math.ts:231`), and the KaTeX output passes a second, span only sanitizer. `\href`
  renders as text. The one `innerHTML` call in the editor (`widgets.ts:535`) receives that
  sanitized string, so it is safe, although it depends on an injected resolver rather than
  on a type that proves the string was sanitized.
- Diagram isolation is done correctly. The iframe uses `sandbox="allow-scripts"` without
  `allow-same-origin` (`frame.ts:194`), so the frame has an opaque origin and can not read
  the parent document, storage or cookies. Mermaid runs with `securityLevel: 'strict'`.
  The parent accepts a response only from that `contentWindow` with the matching request
  ID and clamps the height. `postMessage(..., '*')` is unavoidable with an opaque origin
  and is acceptable here.
- Attachments are safe. Only `image/png`, `image/jpeg`, `image/gif` and `image/webp` are
  accepted (`packages/core/src/files/attachments.ts:11`), content is inspected on upload,
  and the browser shows the bytes through a blob URL in an `img` element, where SVG script
  would not run in any case.

Open security notes, all low: the share page rewrites an attachment `img` source through
`attachmentHref` but leaves an attachment `a` href pointing at `/attachments/<id>`
(`render.ts:183`), which is a broken link today and would become a live link if a future
route serves that path; `MarkdownLimitError` is unhandled, so a very large note answers a
read with a 500; the diagram frame does not check the message origin.

## Architecture assessment and recommendation

Boundaries. The package boundaries are clean and are enforced by a checker.
`packages/markdown` performs no input or output, keeps offsets into the caller string and
passes attachments and diagrams through typed resolvers, which is what the rules ask for.
`packages/editor` imports no client and no storage. `note-editor.tsx` keeps one CodeMirror
view per working copy and changes theme, access and resolvers through compartments, so the
document, the undo history and the composition survive a React render. That part of the
design is right and should be kept.

The failure is one level up. The product has two rendering paths and they are not two
views of one model, they are two independent implementations of Markdown:

1. `packages/markdown`, about 1,990 source lines, remark based, correct, well tested, and
   reachable only through a share page that no route registers.
2. `packages/editor/live-preview.ts` and `widgets.ts`, about 1,230 source lines of regular
   expressions, which is what every user actually sees.
3. `noteOutline` in `apps/web/src/features/backlinks.tsx:13`, a third definition of what a
   heading is, which does not know about fenced code.

The corpus file claims the consumers are checked against one document so they can not
drift apart. Nothing enforces that, and they have already drifted on escapes, intraword
emphasis, setext headings, thematic breaks, footnotes, autolinks, images, indented code,
tables and code fence state. A user who writes a note, then shares it, gets two different
documents. Every future Markdown fix costs three edits and three test suites.

Code size is not proportionate to the feature set. About 5,400 source lines and 2,000 test
lines produce an editor with no bold shortcut, no find and replace, no link completion, no
syntax colors in code, and blocks that can not be edited. Meanwhile 780 lines defend a
single user machine against a parser denial of service that the same user would have to
write into their own note, and 234 lines of diff code live in the editor package for the
history screen.

Recommendation for v0.1: one parse, one source of truth, and no second Markdown grammar.

- Keep `packages/markdown` as the only definition of the language. Keep the URL policy,
  the sanitizer, the math module and the link extraction. Cut `limits.ts` down to an input
  size cap and a nesting cap.
- Delete the regular expression scanner. Build the live preview decorations from the Lezer
  Markdown tree that `markdown()` already installs (`create-editor.ts:159`), through
  `syntaxTree(state)` and `RangeSet` over the visible ranges. The tree already knows
  escapes, flanking rules, setext headings, thematic breaks, footnotes, autolinks, table
  ranges, indented code, and fence state at any position, which removes MD-05, MD-06,
  MD-14 and MD-15 in one change rather than in fifteen patches. The boundary checker
  already allows `editor` to import `markdown` (`tools/check-boundaries.mjs:38`), so the
  shared pieces can move across without a rules change.
- Keep widgets only for what a decoration can not express: images, Mermaid, and display
  math. Make them block replacements over whole lines, make them selection aware, and give
  tables plain text decorations with alignment classes rather than a rendered `table`
  element, so a table stays editable like text. This is what Obsidian Live Preview does,
  and it is the only way to keep "click into it and type" working.
- Add a read view for the share page and for a reading toggle, and render it with
  `renderMarkdown`, so the sanitized renderer has one real consumer and one obvious test:
  the same corpus through both paths.
- Trade offs. The tree based preview is harder to unit test in Node than a string scanner,
  because it needs a `Lezer` parse and `EditorState`, and it costs one dependency the
  package already has. Alternatives were considered: keeping two paths and adding an
  equivalence test would freeze the current mismatches instead of removing them; replacing
  CodeMirror with a rendered contenteditable editor (Milkdown, Tiptap, ProseMirror) would
  fix table and math editing but gives up the "source is the document" rule that the
  save model, the diff view and the offline recovery all depend on, so it is the wrong
  move for v0.1; and a two pane source and preview split would be the cheapest correct
  option, but the product goal asks for one pane.

## Feature matrix

Renderer means `packages/markdown` (`renderMarkdown`). Preview means what the editor shows.

| Feature                         | Renderer                   | Live preview                                                    |
| ------------------------------- | -------------------------- | --------------------------------------------------------------- |
| ATX headings                    | yes                        | partial (h4 to h6 all look like h3; the gap after `#` stays)    |
| Setext headings                 | yes                        | no                                                              |
| Emphasis and strong             | yes                        | partial (ignores escapes and intraword rules, single line only) |
| Strikethrough                   | yes                        | yes (single line)                                               |
| Inline code                     | yes                        | partial (ticks are never hidden)                                |
| Fenced code with language       | yes                        | partial (no colors, info string shows as text)                  |
| Indented code                   | yes                        | no                                                              |
| Block quotes                    | yes                        | partial (one level, no nested content styling)                  |
| Nested lists                    | yes                        | partial (bullet only, no indent guides)                         |
| Ordered list start number       | yes                        | partial (marker styled, start not honored visually)             |
| Loose and tight lists           | yes                        | no (no block spacing model)                                     |
| Task lists                      | yes (disabled inputs)      | partial (literal `[ ]`, click toggles wrong line)               |
| Tables with alignment           | yes                        | partial (widget, alignment ignored, not editable)               |
| Footnotes                       | yes (with back references) | no                                                              |
| Links (inline)                  | yes                        | yes                                                             |
| Reference links and definitions | yes                        | no                                                              |
| Autolinks (`<url>` and bare)    | yes                        | no                                                              |
| Wiki links                      | no                         | yes (styled and clickable)                                      |
| Images (attachment)             | yes                        | yes (widget, needs loaded bytes)                                |
| Images (external)               | placeholder span           | placeholder with a misleading button                            |
| Raw HTML                        | dropped, text kept         | left as text, no styling                                        |
| Hard breaks                     | yes                        | not applicable                                                  |
| Thematic breaks                 | yes                        | no (`* * *` shows a bullet)                                     |
| Entities                        | yes                        | no                                                              |
| Inline math                     | yes (unstyled, see MD-02)  | widget, breaks the line flow                                    |
| Display math                    | yes (unstyled, see MD-02)  | widget                                                          |
| Mermaid                         | placeholder `pre` only     | yes (sandboxed frame)                                           |
| Front matter                    | rendered as content        | rendered as content                                             |

## Test gaps

Renderer coverage is good: the corpus tests assert no script, no event handler, no blocked
scheme, blocked link and image behaviour, tables with alignment, task inputs, nested
lists, footnote back references, unclosed fences, escaping, Unicode, source stability and
offset integrity. The gaps are on the editor side and across the two paths.

1. No equivalence test between the two paths. The corpus is never rendered through the
   editor scanner, so every mismatch in the matrix above is invisible to the suite.
2. No test of `buildLivePreviewDecorations` or `buildRichWidgetDecorations`. Both need a
   DOM and there is no DOM based unit environment, so all decoration placement, hiding,
   reveal and widget DOM behaviour is untested.
3. No test for the viewport slice fence state (MD-05). Every scanner test calls
   `scanTextMarkers` with base 0 over a whole document.
4. No test for escapes or intraword emphasis in the scanner (MD-06), for setext headings,
   thematic breaks, footnotes, autolinks, indented code, or nested block quote content.
5. No test for the checkbox click path (MD-04). `toggleTaskSpec` is tested, but the
   mousedown handler that chooses the line is not.
6. No test that a rich block can be edited (MD-01), or that a source edit refreshes the
   preview (MD-03). `widgets.test.ts:8` states that these are checked by hand during
   development.
7. No test for the theme adapter. Nothing asserts that the CSS variables the editor reads
   exist in the built stylesheet, which is how MD-11 stayed hidden.
8. No test for math styling or for a math failure surface, and no test that the KaTeX
   stylesheet is present (MD-02). `math.test.ts` covers the HTML string only.
9. No diagram test at all. `apps/web/src/diagram/frame.ts` has 324 lines and zero tests,
   including the request and response validators and the height clamp, which are pure
   functions and easy to test.
10. No paste, drop or upload test. Image paste, the 20 MiB cap, a failed upload notice and
    the inserted Markdown are untested in unit and in browser tests.
11. Browser coverage is thin. `tests/e2e/features.spec.ts:33` asserts a heading, bold, a
    table widget, a quote and a code block are visible. There is no browser test for
    typing inside a table, toggling a checkbox, opening a link, math, a diagram, undo,
    list continuation on Enter, or a large document.
12. Performance is measured for the scanner only (`live-preview.test.ts:216`) and with a
    single line scan. The real per keystroke cost, the whole document widget scan and the
    compartment reconfigure (MD-10) are not measured.
13. `MarkdownLimitError` has no consumer test. No test asserts what a user sees when a
    note exceeds a limit.
