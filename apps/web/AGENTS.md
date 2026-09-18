# apps/web

Read the root [AGENTS.md](../../AGENTS.md), then the
[feature workflow](../../docs/development/feature-workflow.md) and the
[design guide](../../docs/development/design.md). This is the router, the
screens, the worker and the diagram frame. It composes and holds no rule.

## What lives here and what does not

- `src/shell/` is the app frame: the layout, the sidebar with its switcher,
  tree, width and drawer, the command palette, and the frame notices.
  `workspaces.tsx` owns the switcher (0049) and `lib/workspace-choice.ts`
  decides which workspace opens. `src/features/<feature>/` holds one feature
  each, `src/lib/` is pure, `src/app.tsx`, `src/router.tsx` and `src/main.tsx`
  compose the application, `src/pwa/` holds the worker, `src/diagram/` the
  frame.
- `src/tailwind.css` is the only application CSS source: Tailwind imports,
  source registration, the one `@font-face` block (0061), and the central
  scales of type, spacing, radius, elevation, easing, tracking and colour. A
  domain rule lives in `packages/core`, a Markdown rule in
  `packages/markdown`, a control in `packages/ui`.
- Three planes (0052): `bg-surface` is chrome, `bg-app` a route, `bg-card`
  with an elevation step is raised. `border-edge-line` is the resting edge of
  a control and the one divider, `border-edge-subtle` a hairline inside a
  group (0053, 0063). A hovered fill reads `bg-accent-fill-hover`, never a
  filter or a fade (0057). The name, the text and the word count of a note are
  one centred column (0055). The header is the context of the route through
  `shell/header-slot.tsx` (0064).

## Allowed imports

`@notesapp/api-client`, `@notesapp/core`, `@notesapp/storage-browser`,
`@notesapp/sync`, `@notesapp/markdown`, `@notesapp/editor`, `@notesapp/ui`. This
package is browser code and imports no Node only or server only package.
`vite.config.ts` and `src/pwa/precache.ts` run in Node, and the checker allows
those two alone.

## How to add a common thing here

- **A screen.** Add `src/features/<feature>/<name>.tsx` from the `@notesapp/ui`
  primitives, add the route in `src/router.tsx`, and read and write through a
  generated operation. A palette action goes in `lib/palette-items.ts`.
- **Testable logic.** Add a pure `src/lib/<name>.ts` and its `.test.ts`. A file
  that imports React is not `lib`; it stays with its feature.
- **A move or a deletion.** Call `applyMoves` in `features/folders/` or
  `deleteNotes` in `features/editor/`. No screen holds either value (0032).

## Testing conventions here

`node --test` through `pnpm test:unit`. A test file is `*.test.ts` next to its
module. There is no DOM unit framework, so a test covers a pure module only and
proves the rule and its refusal. A Playwright journey in `tests/e2e` proves
anything a person sees, and it is the only place that proves it.

## Forbidden here

`tools/check-boundaries.mjs` and `tools/check-design-rules.mjs` fail `pnpm lint`
on each rule below.

- No `fetch`, no `XMLHttpRequest`, no request URL. Call a generated operation;
  `lib/reader-path.ts` alone names the reader path, which the owner surface and
  the installed worker both read (0031).
- No handwritten CSS, CSS module, style sheet or `style=` attribute, no
  colour value outside the theme tokens, no off-scale utility such as
  `text-xs`, `text-sm` or `w-[32rem]`, no built in shadow utility (0052), no
  motion utility (0054), and no filter that makes a colour (0057).
- No class that writes a control: read `buttonClassName`, `rowClassName`,
  `fieldClassName`, `kbdClassName` and `focusOutline` from `@notesapp/ui`
  (0065). No `uppercase`, no `tracking-wide` or wider, no `font-bold` or
  heavier, no `border-dashed`, no off-scale radius, no bare `rounded`, and
  nothing scales on press. No colour class that names no `--color-*` token of
  `src/tailwind.css`: a class such as `bg-surface-hover` renders nothing.
- No icon `size` other than 16 or 20 (0065). No `border-edge` or `ring-edge`
  outside the drop target of `lib/tree-row.ts` (0063). No `focus:` except the
  edge and the ring of a field; `focus-visible:` is the treatment. No family
  name and no `font-family`: `src/tailwind.css` declares the face (0061).
- No `innerHTML` and no `dangerouslySetInnerHTML`, except the sandboxed
  `src/diagram/frame-main.ts` in the allowlist. No identifier, raw timestamp,
  error code or engine notice in text a person reads, and no `.md` suffix.

## Key files

| File                                  | Purpose                         |
| ------------------------------------- | ------------------------------- |
| `src/app.tsx`                         | Application shell and stores    |
| `src/tailwind.css`                    | CSS source and the named scales |
| `src/shell/shell.tsx`                 | Frame, tree, sidebar size       |
| `src/shell/workspaces.tsx`            | The workspace switcher          |
| `src/features/editor/note-editor.tsx` | The editor host and editor view |
| `vite.config.ts`                      | Build, theme assets, worker     |
| `src/logging.ts`                      | Browser sink for log events     |
