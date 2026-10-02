# 0157. A note keeps a safe set of HTML elements

- Status: Accepted
- Date: 2026-10-02

## Context

`renderMarkdown` in `packages/markdown/src/render.ts` runs `remark-rehype`
with `allowDangerousHtml` off, so every HTML node of a note leaves with its
tags. A line break of `<br>`, a subscript, a key in `<kbd>` and the title of a
`<details>` block are lost on the published page. The live preview shows the
same tags as source in the code colour. Audit of 2026-10-02, finding 3, and
[issue 235](https://github.com/bkhanale/notesapp/issues/235). See
[design 021](../design/021-the-published-page-draws-what-the-editor-draws.md).

## Decision

- The renderer keeps the HTML of a note and parses it with `rehype-raw`, the
  parse5 parser of the HTML standard. No other HTML parser is written.
- `packages/markdown/src/html-elements.ts` holds the allow list of the
  author: the elements, and the attributes of each, that a person may write.
  A pass right after the parse applies it. An element outside the list leaves
  its tags and keeps its children, so its text stays. `script`, `style` and
  the other elements of `authorStrippedElements` leave with their content.
  An attribute outside the list leaves.
- The renderer marks each element that it writes with a value of one render
  before the parse, and the pass removes that mark. An element with no mark
  is the work of the author, so a person cannot forge a link, a picture, a
  task box, a math or diagram placeholder, a footnote or an alert, even with
  the class or the data attribute of one. A raw link and a raw picture are
  not on the list: they lose their tags and keep their text.
- The schema of `packages/markdown/src/policy.ts` stays the last gate. It
  names the elements of the author list, and no style, no event attribute
  and no URL attribute of the author passes it.
- The live preview of `packages/editor/src/live-preview.ts` draws each
  element of `previewHtmlElements` between its opening and its closing
  `HTMLTag` of the Lezer tree, and hides the two tags with the reveal rule of
  an inline construct. A block element and `<br>` stay quiet source under
  record 0002.

This refines records 0001 and 0031.

## Consequences

- A published note shows the line breaks, the keys, the subscripts, the
  marks and the folded blocks that the author wrote.
- The renderer carries parse5. The web application does not import the
  renderer, so its bundle does not change. The legal pages of record 0140 and
  the guide site of record 0152 render through the same list.
- `policy.test.ts`, `html-elements.test.ts` and `render.test.ts` prove each
  kept element, each refusal of a neighbouring unsafe form and the kept text
  of a dropped element. `tests/integration/published-page.test.ts` proves the
  served page. `live-preview.test.ts` proves the drawn inline elements.
