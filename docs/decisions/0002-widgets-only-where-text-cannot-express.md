# 0002. Widgets only where text cannot express the result

- Status: Accepted
- Date: 2026-09-10

## Context

A live preview can replace any part of the source with a rendered widget.
Every widget that replaces editable text removes the ability to edit that
text in place, and every widget adds cursor and selection rules.

## Decision

Images, Mermaid diagrams, and display math render as block widgets. A block
widget covers whole lines, is selection aware, and is atomic for cursor
movement. The block opens as source when the cursor or the selection touches
it. Tables stay as text with alignment and column decorations, so they remain
editable in place. Inline math renders inline with no chrome. Single dollar
math is disabled; inline math uses `$$...$$` or `\(...\)`. Task boxes are
real checkbox widgets that carry their own position. Code fences get syntax
highlighting and hide the fence lines.

## Consequences

- The set of widget kinds is closed. A new widget kind needs a new decision.
- Table editing stays plain text editing, so no table editor is needed.
- `packages/markdown` and `packages/editor` share the math delimiter rules
  through `math-syntax.ts`, so the two surfaces cannot drift.
