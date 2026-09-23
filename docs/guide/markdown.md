# Markdown

This page is for the person who writes the notes. It states which Markdown the
editor understands and how a note shows it.

## One note surface

A note has one surface, and the Markdown source is always the document.
Markers are hidden and the text is styled in place, and the source comes back
where your cursor is. A block construct shows its markers while you are on the
line that carries them. A fenced block shows its fences while you are anywhere
inside it. An inline construct shows its markers while your selection touches
the whole construct, so a cursor inside a bold word brings both `**` runs back.

A published link shows the same note through the same grammar, so the two
never disagree about what a note means.

## Paragraphs and line breaks

Two lines of one paragraph read as one paragraph, which is what Markdown
means. The source lines come back while your cursor is in that paragraph.

Press Shift and Enter to break a line and stay in the same paragraph. Press
Enter twice to start a new paragraph. A broken line keeps its backslash in the
source, and you see it again while your cursor is in that paragraph.

## What the editor understands

CommonMark, plus the GitHub set: tables, task list items, strikethrough,
autolinks, and footnotes. Headings, lists at any depth, ordered lists, block
quotes, inline code, fenced code with a language, indented code, links,
reference links, images, thematic breaks, hard breaks, escapes, and entities
all work as CommonMark describes.

A task box is a real checkbox. Select it to tick the line. A table stays
editable text, so you can change it in place. A table wider than the column
keeps its shape, and the note scrolls sideways to reach the last column.

## Ordered lists

An ordered list shows numbers, a list inside it shows the letters A, B, C,
and the next list inside shows the numerals i, ii, iii. Below that level the
three styles start again. The note keeps plain numbers in the source, so the
file reads the same in any other Markdown tool. You see the number of the
source while your cursor is on its line.

The editor keeps each list in sequence as you write. Enter, a paste, a
deletion, Tab, and Shift and Tab all put the numbers of the list back in
order, and one undo removes the change and the new numbers together. A list
keeps the number it starts at. Tab puts an item inside the item above it, and
a list that starts this way counts from one.

## Alerts

A block quote whose first line is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`,
`[!WARNING]` or `[!CAUTION]` is an alert. The marker leaves the text and the
quote shows the word and a colour instead.

## Math

- A single dollar sign is money, never math. `It costs $5 today` stays text.
- Inline math is `$$x^2$$` or `\(x^2\)`, on one line.
- Display math is a `$$` line of its own, the formula, then a closing `$$`
  line.

A formula the renderer cannot draw stays as readable source rather than
failing.

## Diagrams and images

A code fence marked `mermaid` is drawn as a diagram.

An image from this note shows the picture. An image from another site shows the
picture as well, and the address must start with `https`. Opening the note
asks that site for the picture, so the site learns that somebody opened it. The
request names no note and no address of yours.

To add an image, paste it, drag the file onto the editor, or use **Attach
image** in the note menu. The editor uploads it and writes the Markdown for
you. Only images are accepted, and an upload needs a connection.

## HTML is not rendered

Raw HTML is shown as text in the note and removed from a published link.
Nothing you write as HTML has any effect. A link to anything other than a web address, a
mail address, another note, or an attachment loses its destination and is shown
as plain text.

## Limits

A very large note, or one nested very deeply, is shown as source with one
sentence that says why. Nothing is truncated and no text is lost.
