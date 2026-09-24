# packages/editor

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds the rules of
this directory. The recipe for a whole feature is in
[the feature workflow](../../docs/development/feature-workflow.md).

## Purpose

The CodeMirror Markdown editor: the extension set, the live preview
decorations, the widgets, the commands and keymaps, the outline, note link
completion, paste conversion, the binding of an open note, and the unified
diff for History.

## What lives here and what does not

- `create-editor.ts` builds one instance; `extensions.ts`, `language.ts`,
  `keymaps.ts`, `commands.ts` and `list-numbering.ts` (0089) build it.
- `document-binding.ts` joins the live document of an open note to one view
  (record 0082). `openBoundNote` is what a screen uses, so no screen opens a
  document of its own. A bound editor takes its undo from Yjs and leaves the
  CodeMirror history out; a plain editor, which History and a diff use, keeps
  that history. Work of another device reaches a bound note through the gate
  of this module only: it holds one merged update while an IME composition
  runs, because an update inside a composition loses the composed characters.
- `live-preview.ts` holds the decorations, `widgets.ts` the block widgets,
  and `outline.ts` reads the same syntax tree.
- `editor-theme.ts` is the typed CodeMirror adapter and the one place here
  that sets presentation in TypeScript. It reads the named steps of
  `apps/web/src/tailwind.css`, which `editorThemeVariables` lists for the
  integration test, and the runtime `--notes-*` palette.
- The rhythm of a note comes from the note: a blank source line is a line at
  the full height, so `.cm-line` adds no block padding and a heading adds the
  one step that groups it with its text. Strong text, a heading and a table
  head read `--font-weight-note-heading`.
- The marker line of a list item is one row: a lead cell for its indentation
  and its marker, and a body cell that wraps, so no rule states an indent.
- The task box is drawn from the theme (record 0033) and is the one thing here
  that reads `--notes-border` (record 0063). Every other edge of a note is
  `--notes-border-line` or `--notes-border-subtle`.
- No Markdown grammar lives here. `packages/markdown` owns the language, and
  navigation leaves through injected callbacks.

## Allowed imports

`@notesapp/core`, `@notesapp/markdown`, `@notesapp/ui`, the note document and
its bridge, the CodeMirror and Lezer packages, `y-codemirror.next`, and `diff`.
This package is browser code: no Node built in module and no server package.

## How to add a common thing here

- **A decoration.** Read the node from the Lezer tree with
  `syntaxTree(state)` in `live-preview.ts`. Never scan the source text.
- **A command and its key.** Add the command, dispatch it through
  `editingTransaction`, and list it in `shortcuts`. A formatting command is
  one row of `formatActions`; its key, tool and palette row read it (0094).
- **A shared Markdown syntax constant.** Add it in `packages/markdown` and
  read it here. Do not repeat a delimiter.

## Testing conventions here

`node --test` through `pnpm test:unit`, with no DOM. A test file is
`*.test.ts` next to its module. A decoration test builds an `EditorState`
with the real extension set and asserts the decorations that the state
produces. `unified-diff.test.ts` is the pattern for a pure module.

## Forbidden here

- No second Markdown grammar and no second scanner: every decoration and the
  outline come from the Lezer tree.
- A task box stays a control (0033). An ordered marker reveals its source only
  when the selection touches it (0092). Other markers follow the reveal rule.
- No widget outside an image, a Mermaid diagram and display math. A table
  stays editable text.
- No single dollar inline math: use `$$...$$` or `\(...\)`.
- No network call, no database access, no token storage, and no import of
  `@notesapp/api-client`. No colour value: the theme adapter reads `--notes-*`
  and `--notes-syntax-*`.
- No replacement of the editor document during a React render, a theme
  change, or a preview update.

## Key files

| File                      | Purpose                                     |
| ------------------------- | ------------------------------------------- |
| `src/index.ts`            | The one public entry point                  |
| `src/create-editor.ts`    | Builds one editor instance                  |
| `src/live-preview.ts`     | Tree driven decorations                     |
| `src/widgets.ts`          | The three allowed block widgets             |
| `src/editor-theme.ts`     | The typed CodeMirror presentation adapter   |
| `src/keymaps.ts`          | Keymaps and the public `shortcuts` list     |
| `src/document-binding.ts` | Binds a live note document to a view (0082) |
