# 0094. The note has one row of formatting tools

- Status: Accepted
- Date: 2026-09-24

## Context

The editor formats Markdown through source text and keys only.
`packages/editor/src/keymaps.ts` holds the commands, but no control on the
screen names them, so a person who does not know Markdown cannot make a list,
a heading or a table. A table is hard to write by hand even for a person who
knows the syntax. Record 0069 gives the note surface no row above the text.
Issue 153 asks for a toolbar.

## Decision

The note surface holds one row of formatting tools above the note text, on the
note measure (record 0055). This refines record 0069: the row is the one band
above the text, and it holds no name and no note action.

- The tools are Heading, Bold, Italic, Strike through, Inline code, Link,
  Bullet list, Ordered list, Task list, Block quote and Table, in four groups
  that space separates. Heading is a menu of three levels.
- `formatActions` in `packages/editor/src/keymaps.ts` is the one table of the
  formatting commands. The formatting keymap is built from it, and the row
  reads it, so a tool and its key run one command.
- Table inserts a small GFM table as text (record 0002). No table widget and
  no table editor exist.
- A tool is a compact ghost control with a `label` and a title that names its
  key. The row is one `toolbar`: one tab stop, and the arrow keys move inside
  it. A tool returns the focus to the editor.
- A tool does nothing while the editor composes, so an IME composition keeps
  its characters (record 0082).
- Below the small width the row shows the tools a person uses most, and one
  More formatting menu holds the rest. `apps/web/src/lib/format-toolbar.ts`
  holds the order, the groups and that split.

## Consequences

- A person formats a note without Markdown, with a pointer or a keyboard.
- The text starts one row lower than record 0069 states.
- `keymaps.test.ts` proves each command with an empty and a filled selection,
  that each key runs the command of its tool, and the shape and the caret of a
  table. `format-toolbar.test.ts` holds the row.
- This answers [issue 153](https://github.com/bkhanale/notesapp/issues/153).
