/**
 * The shared Markdown corpus.
 *
 * Every consumer of this package checks itself against this one document, so
 * the parser, the renderer, the editor decorations, and the reading surface
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
 * escaping, Unicode in composed and decomposed form, an astral emoji, two
 * footnotes, one of two paragraphs and one in another case, double bracket
 * text in four forms, a note link, a reference link, a
 * malformed note identifier, blocked URL schemes, an attachment image, an
 * external image, a blocked image, raw HTML including a script element and an
 * `onerror` attribute, the safe HTML elements of record 0157 with a raw link
 * and an unknown element whose words stay, a folded `details` block, both
 * inline math pairs, display math, a Mermaid fence,
 * a hard line break, six ATX heading levels, both setext heading levels, an
 * ordered list with a start number, an ordered list nested three deep with a
 * lazy number and a bullet list inside it, inline math on one dollar beside
 * money and an escaped dollar, an alert quote, both thematic break
 * forms, an indented code block,
 * pointy, bare, and email autolinks, a nested block quote, and an unclosed
 * code fence at the end.
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

> [!WARNING]
> An alert states its tone and hides its marker.

[^one]: The footnote text with a [second note](/notes/${noteIdB}).

A second note[^Two] takes its label in another case.

[^two]: A note of two paragraphs.

    The second paragraph of the note.

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

Keys and marks: <kbd>Ctrl</kbd> + <kbd>S</kbd>, H<sub>2</sub>O, x<sup>2</sup>, <mark>marked</mark>,
one<br>two, a <a href="https://example.com/raw">raw link</a> and <unknown-tag>kept words</unknown-tag>.

<details>
<summary>Folded title</summary>

Folded *body* text.

</details>

Prices stay text: $5 and $10 today.

Inline math $$E = mc^2$$ inside a sentence.

Inline math \\(a^2 + b^2 = c^2\\) with the other pair.

Inline math $x^2 + y$ on one dollar, and an escaped \\$x$ stays text.

$$
\\int_0^1 x^2 \\, dx
$$

\`\`\`mermaid
graph TD;
  A-->B;
\`\`\`

Escaping check: 5 < 6 & 7 > 4, "quoted" and 'single'.

## Heading level two

### Heading level three

#### Heading level four

##### Heading level five

###### Heading level six

Setext heading level one
========================

Setext heading level two
------------------------

3. third item
4. fourth item

1. first step
   1. first detail
      1. first point
      1. second point
   2. second detail
      - a bullet between
        1. inner step
2. second step

***

---

    indented code line one
    indented code line two

Autolinks: <https://example.com/pointy>, https://example.com/bare, and
<person@example.com>.

> outer quote
>
> > inner quote

\`\`\`js
const unclosed = true;
`;

/**
 * The note of block syntax.
 *
 * A view parses a note in slices and a later parse reuses the partial tree,
 * so every block syntax must parse the same however the parse was cut
 * (record 0155). This note holds each block that the editor grammar knows,
 * at the top level, inside a quote and inside a list item, next to the
 * blocks it can be confused with: display math beside fences, a fence and a
 * `$$` line inside each other, fences of JavaScript, CSS and HTML whose
 * languages parse inside them, a table and an alert in a quote, footnote
 * definitions in a quote, in a list item and near the end, HTML blocks and
 * inline HTML of record 0157 beside a fence and in a quote, inline math on
 * one dollar of record 0171 beside money and in a quote, fences of a Lezer
 * language, a stream language and a mixed language of record 0173, and an
 * unclosed
 * display math block at the end. The corpus above holds one of each, and this
 * note holds the edges between them.
 */
export const blockSyntaxMarkdown = `---
title: Block syntax
---

# Display math and fences

$$
a^2 + b^2 = c^2
$$

\`\`\`js
const inline = '$$';
$$
\`\`\`

$$ tex
\\frac{1}{2}

\\sum_{i=0}^{n} i
$$

~~~
tilde fence with \`\`\` inside
~~~

\`\`\`python
def f(x):
    return "$$"
\`\`\`

\`\`\`sh
echo "a $b" # a comment
\`\`\`

\`\`\`php
<?php echo "a"; ?>
<b>page</b>
\`\`\`

$$$
x
$$
still the formula
$$$

\`\`\`\`markdown
\`\`\`
a fence inside a longer fence
\`\`\`
\`\`\`\`

A paragraph right before math.
$$
p
$$

> $$
> q = 1
> $$
>
> | Quoted | Table |
> | ------ | ----- |
> | a      | b     |

> [!TIP]
> An alert with code:
>
> \`\`\`sh
> echo tip
> \`\`\`

- An item with math:

  $$
  r
  $$

- [ ] A task with a fence:

  \`\`\`
  inside the item
  \`\`\`

| Left | Right |
| :--- | ----: |
| 1    |     2 |

<details>
<summary>An HTML block with $$ and a fence</summary>

\`\`\`
inside the folded block
\`\`\`

</details>

\`\`\`css
.note > p {
  color: red;
}
\`\`\`

\`\`\`html
<p class="lead">A page with <b>code</b>.</p>
<script>
  const ready = true;
</script>
<style>
  p { margin: 0; }
</style>
\`\`\`

Inline HTML: <kbd>Ctrl</kbd>, H<sub>2</sub>O and one<br>two.

One dollar $a^2$ opens math, and $5 and $10 stay money.
An escaped \\$b$ stays text.

> A quoted formula $q_1$ on one dollar.

> <div>
> quoted HTML
> </div>

<!-- a comment block
over two lines -->

    indented code with $$ in it

> Quoted text with a note[^q].
>
> [^q]: A definition in a quote.

- An item with a note[^l].

  [^l]: A definition in a list item.

Text after the blocks[^end].

[^end]: A definition near the end
with a lazy line.

    And an indented paragraph.

$$
an unclosed formula at the end
`;
