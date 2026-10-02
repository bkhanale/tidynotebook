# The published page draws what the editor draws

Status: complete

## The problem

A note has two readers. The live preview of `packages/editor` is the surface
where the owner writes, and the published page of
`apps/server/src/routes/published.ts` is the surface where a person with no
account reads. Record 0025 makes the live preview the one surface of a person
who writes, and record 0031 makes `renderMarkdown` of `packages/markdown` the
renderer of the published page. The audit of 2026-10-02 published one sample
note and compared the two surfaces side by side. Its findings 3 and 4 list
the places where they disagree. Four issues hold them: 235, 236, 237 and 238.

The reader sees less than the writer in three ways that need a choice.

1. HTML in a note is lost. `renderMarkdown` drops every HTML node with its
   tags. `hi<br>next` becomes one word, `H<sub>2</sub>O` loses its
   subscript, a key in `<kbd>` reads as a plain word, and the title of a
   `<details>` block disappears. The editor shows the same tags as source in
   the colour of code.
2. A Mermaid diagram is drawn in the editor and shows as source on the
   published page. The renderer writes a `data-diagram` placeholder, and
   nothing on the page draws it.
3. Code on the published page has no colour. The editor highlights a fence
   with the Lezer parsers of `packages/editor/src/language.ts`, and the page
   shows plain text. In light, the block has no fill either.

A fourth set of differences needs no choice, only care: the published task
item shows a bullet and a native box, a table header ignores its alignment
and the table fills the column, and the first heading is close to the size
of the second.

## What other tools do

The GitHub renderer is the reference most notes come from. It keeps a fixed
subset of HTML through a sanitizer with an allow list of elements and
attributes. An element outside the list loses its tags and keeps its text,
and a script, a style and an event attribute never travel. It draws a Mermaid
fence in a sandboxed frame on a separate origin, with a script, and it shows
the source when the frame cannot load. It highlights code on the server, so a
page with no script still shows colour.

Obsidian Publish and GitLab draw a diagram in the browser of the reader with
a script. Obsidian highlights code in the browser too. Bear and Typora export
static HTML with the colours already in it.

## HTML in a note

**Keep dropping it.** This costs nothing to build and loses text that the
author wrote: the title of a `<details>` block, the words of a `<kbd>`, and
every line break of a `<br>`.

**Keep the text and drop every tag.** The words survive, and the meaning of
the tags does not. A subscript reads as a digit, and two lines join.

**Parse the HTML and keep a safe subset.** remark gives an `html` node for
each tag, and `rehype-raw` turns those nodes and the tree around them into one
HTML tree through parse5, the parser of the HTML standard. A pass right after
that parse reads the allow list of the author: the elements and the
attributes that a person may write. An element outside the list leaves its
tags and keeps its children, so its text never vanishes. A script and a
style leave with their content. The sanitizer of `policy.ts` stays the last
gate behind it. The cost is one more dependency, parse5, in the renderer, and
a second list beside the schema of the sanitizer.

The renderer writes elements of its own that a person must not forge: a
link and a picture after the URL policy, a task box, a math placeholder, a
diagram placeholder, a footnote and an alert. The renderer marks each of its
elements with a value of one render before the parse, and the pass reads that
mark. An element that an author wrote has no mark, so it gets the author
list even when it names a class or an attribute of the renderer. A raw link
and a raw picture stay out of the author list. A link and a picture are
Markdown constructs, and the URL policy reads them there.

**Write a small tag scanner.** A scanner that pairs `<kbd>` with `</kbd>` is
short, but it is a second HTML parser, and an HTML parser that is not the
standard one is where sanitizers fail. This option is refused.

The editor keeps the source of a note as its document (record 0001), and its
widgets are a closed set (record 0002). It can still draw an inline element:
the Lezer tree gives each tag as an `HTMLTag` node, so the preview pairs an
opening tag with its closing tag, styles the text between them, and hides the
two tags with the reveal rule of an inline construct. A block element such as
`<details>`, and a `<br>`, have no decoration that keeps the text editable,
so they stay quiet source. Both surfaces read the list of the inline elements
from `packages/markdown`.

## Diagrams

**Draw the diagram on the server.** Mermaid measures text in a live
document, so a server needs a browser engine to run it. That is a headless
Chromium beside the server, a second process to run and to update, seconds of
work per diagram, and a browser that runs the text of a stranger on a public
installation. The page would keep no script, which is its strength.

**Draw the diagram with another library on the server.** A library that
needs no document draws a different picture from the editor, so the two
surfaces disagree again, and it is a second renderer of one construct.

**Store the picture that the editor drew.** The device of the owner draws the
diagram already. It could send the picture with the note. The picture would
be stale after every edit on another device, the contract would carry a new
body, and the server would have to sanitize an SVG of the author.

**Draw the diagram in the browser of the reader, in the frame of the
editor.** The page loads one script file from the build when the note holds a
diagram. The script puts the sandboxed frame of `apps/web/src/diagram/` in
place of each placeholder, with the palette that the page shows, so the
reader sees the picture that the editor draws. The frame has no origin of its
own, no network and no storage. The content policy of the page names the one
script file and the one frame document by their exact address, so no other
script can run, no inline script is permitted, and nothing of a third party
loads. A reader with no script, or a frame that cannot draw, reads the source
in the code block. The cost is a page that is no longer free of script, a
frame document of a few megabytes for a note that holds a diagram, and two
more files on the published origin of record 0118.

The last option is the standard one, and it is the one that keeps one
renderer of a diagram.

## Code

**A second highlighter on the server.** Prism, highlight.js and Shiki each
bring their own grammars and their own token names. A fence would get other
colours on the page than in the editor, and a new language would have to be
added twice.

**Highlight in the browser of the reader.** The page would need a script for
every note that holds code, and a reader with no script would see plain text.

**Highlight in the renderer with the parsers of the editor.** The Lezer
parsers run in Node and in the browser and touch no document. One list in
`packages/markdown` names each language, its aliases and its parser, and one
map names the token of each Lezer tag. `renderMarkdown` writes a span with
one class for each token, the editor builds its fence languages and its
highlight style from the same list and map, and the theme registry gives
both surfaces the same colour for each token. A new language is one entry,
and it reaches both surfaces. The cost is a set of Lezer packages in
`packages/markdown`, and the editor builds a fence language from a bare
parser, so a fence keeps the indentation of the line above and loses the
completion and the folding of the CodeMirror language packages.

The last option keeps one grammar for code, which is the rule of record 0001
applied to the languages inside a fence.

## The style of the page

The page writes its presentation as descendant variants in
`apps/server/src/routes/published-document.ts`, and the editor writes it in
`packages/editor/src/editor-theme.ts`. Both read the same named steps of
`apps/web/src/tailwind.css`. The code block takes the chrome fill, the subtle
edge and the card radius of the editor. A task item loses its bullet and
draws the task box of record 0033 with its check mark. A table sizes to its
text and its header follows the alignment of its column, as record 0147
states. The headings take the note ramp, and the heading of the page stays
the name of the note.

## Decisions

- [0157](../decisions/0157-a-note-keeps-a-safe-set-of-html-elements.md): a
  note keeps a safe set of HTML elements.
- [0158](../decisions/0158-a-published-diagram-draws-in-the-frame-of-the-editor.md):
  a published diagram draws in the frame of the editor.
- [0159](../decisions/0159-one-highlighter-colours-code-on-both-surfaces.md):
  one highlighter colours code on both surfaces.
- [0160](../decisions/0160-an-unclosed-tag-never-takes-the-rest-of-a-note.md):
  an unclosed tag never takes the rest of a note.
