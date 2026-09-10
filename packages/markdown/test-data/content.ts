/**
 * The shared Markdown corpus.
 *
 * Every consumer of this package checks itself against this one document, so
 * the parser, the renderer, the editor decorations, and the public share page
 * cannot drift apart. Add a case here rather than inventing a private sample.
 *
 * The corpus is TypeScript rather than a `.md` file because this package must
 * stay browser safe: the boundary checker allows a test file to import
 * `node:test` and `node:assert` only, so a test cannot read a file from disk.
 * The document is held in a template literal, which the formatter leaves
 * exactly as written, so the byte offsets that the range tests rely on are
 * stable.
 *
 * Escapes to keep in mind while editing: a backtick is written as an escaped
 * backtick, and a backslash that belongs to the Markdown is doubled.
 */

/** A file identifier used by the note links in the corpus. */
export const noteIdA = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
/** A second file identifier, used by a footnote link and a definition. */
export const noteIdB = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
/** A revision identifier used by the attachment image in the corpus. */
export const attachmentIdA = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';

/**
 * The corpus document.
 *
 * It contains front matter, nested lists, task items, a table with alignment,
 * escaping, Unicode in composed and decomposed form, an astral emoji, a
 * footnote, double bracket text in four forms, a note link, a reference link, a
 * malformed note identifier, blocked URL schemes, an attachment image, an
 * external image, a blocked image, raw HTML including a script element and an
 * `onerror` attribute, inline and display math, a Mermaid fence, a hard line
 * break, and an unclosed code fence at the end.
 */
export const corpusMarkdown = `---
title: Corpus example
tags: [demo, markdown]
---

# Heading with *emphasis*

A paragraph with **strong**, ~~struck~~, \`inline code\`, and an escaped \\*star\\*.
Unicode: caf\u00e9 in composed form, cafe\u0301 with a combining mark, and \u{1F30D}.

A hard break ends this line\\
and this line follows it.

- level one
  - level two
    - level three with a [note link](/notes/${noteIdA})
- [x] finished task
- [ ] open task

| Column   | Right |
| :------- | ----: |
| cell \`a\` |     1 |
| cell b   |     2 |

> A quote with a footnote[^one] and a [[Bracket Title]] run of text.

[^one]: The footnote text with a [second note](/notes/${noteIdB}).

Bracket forms: [[Ambiguous]], [[Ambiguous|shown label]], \`[[in code]]\`, and \\[[escaped]].

A [reference link][ref] resolves through a definition.

[ref]: /notes/${noteIdB}

An unresolved target: [broken note](/notes/not-a-uuid).

Unsafe links: [click me](javascript:alert(1)), [encoded](data:text/html;base64,PHNjcmlwdD4=),
[protocol relative](//evil.example.com/steal), [local file](file:///etc/passwd), and
[vbscript](vbscript:msgbox(1)). A safe [external site](https://example.com/page) stays.

![diagram attachment](/attachments/${attachmentIdA})

![external picture](https://example.com/photo.png)

![bad image](javascript:alert(2))

<script>alert('raw block')</script>

<img src="x" onerror="alert(3)">

Inline raw <b>bold text</b> and <span onclick="alert(4)">span text</span>.

Inline math $E = mc^2$ inside a sentence.

$$
\\int_0^1 x^2 \\, dx
$$

\`\`\`mermaid
graph TD;
  A-->B;
\`\`\`

Escaping check: 5 < 6 & 7 > 4, "quoted" and 'single'.

\`\`\`js
const unclosed = true;
`;
