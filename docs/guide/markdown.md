# Markdown

This page is for the person who writes the notes. It states which Markdown the
editor understands and how the two modes show it.

## Write mode and Read mode

The toggle at the top of a note switches between **Write** and **Read**.

In Write mode the Markdown source is always the document. Markers are hidden
and the text is styled in place, and the source comes back where your cursor
is. A block construct shows its markers while you are on the line that carries
them. A fenced block shows its fences while you are anywhere inside it. An
inline construct shows its markers while your selection touches the whole
construct, so a cursor inside a bold word brings both `**` runs back.

Read mode shows the finished document and nothing else. Both modes use the same
grammar, so they never disagree about what a note means.

## What the editor understands

CommonMark, plus the GitHub set: tables, task list items, strikethrough,
autolinks, and footnotes. Headings, lists at any depth, ordered lists, block
quotes, inline code, fenced code with a language, indented code, links,
reference links, images, thematic breaks, hard breaks, escapes, and entities
all work as CommonMark describes.

A task box is a real checkbox in Write mode. Select it to tick the line. A
table stays editable text, so you can change it in place.

## Math

- A single dollar sign is money, never math. `It costs $5 today` stays text.
- Inline math is `$$x^2$$` or `\(x^2\)`, on one line.
- Display math is a `$$` line of its own, the formula, then a closing `$$`
  line.

A formula the renderer cannot draw stays as readable source rather than
failing.

## Diagrams and images

A code fence marked `mermaid` is drawn as a diagram.

An image from this note shows the picture. An image from another site is never
fetched by itself: it shows a small placeholder with a **Load** button, so
opening a note cannot tell another site that you read it.

To add an image, paste it, drag the file onto the editor, or use **Attach
image** in the note menu. The editor uploads it and writes the Markdown for
you. Only images are accepted, and an upload needs a connection.

## HTML is not rendered

Raw HTML is shown as text in Write mode and removed in Read mode. Nothing you
write as HTML has any effect. A link to anything other than a web address, a
mail address, another note, or an attachment loses its destination and is shown
as plain text.

## Limits

A very large note, or one nested very deeply, is shown as source with one
sentence that says why. Nothing is truncated and no text is lost.
