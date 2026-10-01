# apps/web

Read the root [AGENTS.md](../../AGENTS.md), then the
[feature workflow](../../docs/development/feature-workflow.md) and the
[design guide](../../docs/development/design.md). This is the router, the
screens, the worker and the diagram frame. It composes and holds no rule.

## What lives here and what does not

- `src/shell/` is the app frame: the 44 px header, the sidebar of rows, the
  palette and the frame notices. `header-slot.tsx` holds the two places a
  route writes into the header (0064, 0069), `lib/breadcrumb.ts` states its
  parts (0064) and `action-icons.tsx` draws the one glyph of an action (0065).
  `workspaces.tsx` owns the switcher (0049). `src/features/<feature>/` is a
  feature, `src/lib/` is pure, `app.tsx`, `router.tsx` and `main.tsx` compose
  it, `src/pwa/` the worker and notices (0130), `src/diagram/` the frame.
- `src/tailwind.css` is the only CSS source: imports, sources, `@font-face`
  (0061), the scales, and the built palette of a page with no script (0151).
  A domain rule is in `packages/core`, a Markdown rule in `packages/markdown`.
- Three planes (0052): `bg-surface` is chrome, `bg-app` a route, `bg-card`
  with an elevation step is raised. `border-edge-line` is the resting edge of
  a control and the one divider, `border-edge-subtle` a hairline inside a
  group (0053, 0063). A hovered fill reads `bg-accent-fill-hover`, never a
  filter or a fade (0057). The tools, the text and the word count of a note
  are one centred column (0055, 0094). Its name is in the breadcrumb (0069).

## Allowed imports

`@notesapp/api-client`, `@notesapp/core`, `@notesapp/storage-browser`,
`@notesapp/sync`, `@notesapp/markdown`, `@notesapp/editor`, `@notesapp/ui`. This
package is browser code and imports no Node only or server only package.
`vite.config.ts` and `src/pwa/precache.ts` run in Node, and the checker allows
those two alone.

## How to add a common thing here

- **A screen.** Add `src/features/<feature>/<name>.tsx` from `@notesapp/ui`,
  one primary button, a `Page` for every state with not found (0062) and the
  sections of `lib/page-sections.ts` (0137). Route it with a `framePages`
  handle (0091), call a generated operation, and add `lib/palette-items.ts`.
- **Testable logic.** Add a pure `src/lib/<name>.ts` and its `.test.ts`. A file
  that imports React is not `lib`; it stays with its feature.
- **A move or a deletion.** Call `applyMoves` in `features/folders/` or
  `deleteNotes` in `features/editor/`. No screen holds either value (0032).
- **A formatting tool.** One row of `formatActions` in the editor and one
  tool in `lib/format-toolbar.ts`, which also gives its palette row (0094).

## Testing conventions here

`node --test` through `pnpm test:unit`. A test file is `*.test.ts` next to its
module. There is no DOM unit framework, so a test covers a pure module only and
proves the rule and its refusal. What a person sees is proved by the pure
module that decides it, in `src/lib/`, and by an integration test of the built
result (0066). Drive the screen and read it in light and in dark first.

## Forbidden here

`tools/check-boundaries.mjs` and `tools/check-design-rules.mjs` fail `pnpm lint`
on each rule below.

- No `fetch`, no `XMLHttpRequest`, no request URL. Call a generated operation;
  `lib/reader-path.ts` names the reader path (0031) and `lib/legal-path.ts`
  the legal pages (0140), and the installed worker stands aside for both.
- No handwritten CSS, CSS module, style sheet or `style=` attribute, no
  colour value outside the theme tokens, no off-scale utility such as
  `text-xs`, `text-sm` or `w-[32rem]`, no built in shadow utility (0052), no
  motion utility (0054), and no filter that makes a colour (0057).
- No class that writes a control: read `buttonClassName`, `rowClassName`,
  `fieldClassName`, `kbdClassName` and `focusOutline` from `@notesapp/ui`
  (0065). No `uppercase`, no `tracking-wide` or wider, no `font-bold` or
  heavier, no `border-dashed`, no off-scale radius, no bare `rounded`, and
  nothing scales on press. No colour class that names no `--color-*` token.
- No icon `size` other than 16 or 20 (0065). No `border-edge` or `ring-edge`
  outside the drop target of `lib/tree-row.ts` (0063). No `focus:` except the
  edge and the ring of a field; `focus-visible:` is the treatment. No family
  name and no `font-family`: `src/tailwind.css` declares the face (0061).
- No `innerHTML` and no `dangerouslySetInnerHTML`, except the sandboxed
  `src/diagram/frame-main.ts` in the allowlist. No identifier, raw timestamp,
  error code or engine notice in text a person reads, and no `.md` suffix.

## Key files

| File                                          | Purpose                           |
| --------------------------------------------- | --------------------------------- |
| `src/app.tsx`                                 | Application shell and stores      |
| `src/tailwind.css`                            | CSS source and the named scales   |
| `src/shell/shell.tsx`                         | Frame, tree, sidebar size         |
| `src/shell/header-slot.tsx`                   | Where a route fills the header    |
| `src/lib/note-menu.ts`                        | The rows of the note menu         |
| `src/lib/note-name-field.ts`                  | The name field of the open note   |
| `src/shell/action-icons.tsx`                  | The one glyph of every action     |
| `src/shell/workspaces.tsx`                    | The workspace switcher            |
| `src/shell/sidebar-view-bar.tsx`              | The view bar of the sidebar       |
| `src/lib/workspace-choice.ts`                 | Which workspace opens             |
| `src/lib/breadcrumb.ts`                       | Where a person is, as parts       |
| `src/features/editor/note-editor.tsx`         | The editor host and editor view   |
| `src/features/editor/note-loader.tsx`         | The read that opens one note      |
| `src/features/editor/device-note.ts`          | The open read a navigation awaits |
| `src/features/editor/note-header-actions.tsx` | The actions of the note route     |
| `src/lib/format-toolbar.ts`                   | The formatting tools and rows     |
| `src/features/daily-notes/daily-notes.tsx`    | The one way to open a date (0099) |
| `src/lib/daily-note.ts`                       | The daily note rules of a device  |
| `src/features/templates/templates.tsx`        | The template folder (0149)        |
| `src/lib/templates.ts`                        | The template rules of a device    |
| `src/shell/member-settings.ts`                | The one hook of a member setting  |
| `vite.config.ts`                              | Build, theme, icons, worker       |
| `src/pwa/icons.ts`                            | The one list of the icons         |
| `icons/`                                      | The icon files the build names    |
| `src/logging.ts`                              | Browser sink for log events       |
