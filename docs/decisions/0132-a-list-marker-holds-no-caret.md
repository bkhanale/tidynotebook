# 0132. A list marker holds no caret

- Status: Accepted
- Date: 2026-09-30

## Context

Record 0033 keeps a task box at every selection and never draws its source.
The hidden `- [ ] ` stays a caret place, so a tap beside the box on a phone
put the caret to the left of the box, and a selection over the box still
showed the box. A plain bullet follows the reveal rule of record 0025, so a
caret on its line shows `-`. Notion and Obsidian draw both markers at every
caret, keep the caret out of them, and show the source of a selected marker.
The box toggled on `touchstart`, so a scroll that started on a box ticked it.

## Decision

- A bullet (`-`, `+`, `*`) and a task box are drawn at every caret. A bullet
  is drawn once a space follows it, so a lone `-` stays the character typed.
  Their source comes back while a range selection covers a character of the
  marker.
  This replaces the "never drawn again" rule of record 0033 and the reveal of
  a bullet under record 0025. An ordered marker keeps record 0092.
- The marker prefix of such a line runs from the start of the line to the
  first character of the item text. A caret that a person moves there rests at
  the first character of the text instead. A move backward from that character
  goes to the end of the line above, as Notion does, so no key is stuck. Home
  there stays. A range may end in the prefix, so a person can still select and
  edit the marker as text.
- `packages/editor/src/list-marker.ts` finds the marker and its prefix from
  the syntax tree. The preview and the caret filter both read it.
- Backspace at the first character of the text runs `deleteMarkupBackward` of
  `@codemirror/lang-markdown`, which removes the marker.
- A tap whose place is in the prefix is taken from the browser before it draws
  its own caret there: the editor cancels the tap and puts the caret on the
  text. A touch that the browser cancels, a scroll or a long press, stays the
  browser's.
- The page margin beside the editor is outside it, so the note page passes
  that element to `takeMarginTaps` of `@notesapp/editor`. A tap on the margin
  beside a drawn marker counts as a tap at the start of that line. The layout
  of the page does not change.
- The box owns its events. It toggles on `click`, which the platform fires for
  a tap, a pointer click and Space, and never for a scroll. A press on the box
  moves neither the caret nor the focus. Its hit area is 24 px.

## Consequences

- A tap on or beside a box never puts the caret to the left of the box.
- A copy is the source, as it was, and a selection now shows that source.
- `live-preview.test.ts` holds the draw and reveal rules. `list-marker.test.ts`
  holds every caret move.
