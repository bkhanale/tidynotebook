# 0075. A link opens on a plain click

- Status: Accepted
- Date: 2026-09-21

## Context

The live preview is the one note surface (record 0025), so the same text is
what a person reads and what a person writes. A link opened only on
`Ctrl + click`, `Cmd + click`, or `Alt + Enter`, from the `mousedown` handler
in `packages/editor/src/create-editor.ts`. A plain click placed the caret, and
nothing on the screen said that a modifier was needed, so a reader who had
found a link had no way to follow it. The handler also read a
`data-notesapp-touch-link` attribute for a touch screen, and no module in this
repository ever wrote that attribute, so a tap opened nothing at all.

`linkTargetAt` found the link with a regular expression over the document
text. It knew `[label](destination)` alone, so `<https://example.com>` and a
bare address read as a link and opened nothing.

## Decision

A plain click on a link opens it, and the cursor over a link is a pointer, so
the screen states the action before the click. A link that the selection
touches shows its source under the reveal rule: that link is being edited, so
a click inside it places the caret and the cursor is a text cursor again. The
caret reaches a link with an arrow key or with a click beside it. The main
button only, and never with Shift, so a middle click and an extended selection
keep their meaning.

`linkSpanAt` in `packages/editor/src/commands.ts` replaces `linkTargetAt`. It
reads the syntax tree, so the click and the reveal rule read the same nodes
and cannot disagree about where a link starts and ends. It names three shapes:
an inline link with a destination, a pointy autolink, and a bare address. A
footnote, a reference link, a bare bracket pair and the target of an image
name no address, so a click on each of them still places the caret. The dead
touch attribute is gone, because a tap is a click.

This replaces the rule of design 001, which asked for a modifier click so that
a plain click could place the caret. That design is superseded.

## Consequences

- A person follows a link with one click on every device, and the pointer says
  so first. `Alt + Enter` keeps its place in the shortcut list.
- A drag that starts inside a link no longer selects text. The drag starts
  beside the link instead, which is where the caret already goes.
- A bare `www.` address stays styled as a link and opens nothing, because
  `classifyUrl` in `packages/markdown/src/policy.ts` refuses an address with
  no scheme while the reference renderer adds one. This is the state before
  this record as well, and it belongs to the classifier and not to the editor.
- `commands.test.ts` holds the three link shapes and the four shapes that name
  no address. `live-preview.test.ts` holds the open class against the reveal
  rule, and `editor-theme.test.ts` holds the two cursors.
