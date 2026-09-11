# apps/web

Read the root [AGENTS.md](../../AGENTS.md) first. This file adds the rules of
this directory. The recipe for a whole feature is in
[docs/development/feature-workflow.md](../../docs/development/feature-workflow.md).

## Purpose

The React web application: the router, the screens, the service worker, and
the sandboxed diagram frame. It composes the packages. It holds no domain
rule and no storage rule of its own.

## What lives here and what does not

- `src/features/` holds one screen or one feature area per file. A `.tsx`
  file renders and wires. Logic that needs a unit test lives in a `.ts` file
  next to it.
- `src/app.tsx`, `src/router.tsx`, and `src/main.tsx` compose the
  application. `src/pwa/` holds the service worker and install notices, and
  `src/diagram/` holds the sandboxed Mermaid frame.
- `src/tailwind.css` is the only application CSS source. It holds Tailwind
  imports, source registration, and the central theme variables only.
- A domain rule lives in `packages/core`, a Markdown rule in
  `packages/markdown`, and a reusable control in `packages/ui`.

## Allowed imports

`@notesapp/api-client`, `@notesapp/core`, `@notesapp/storage-browser`,
`@notesapp/sync`, `@notesapp/markdown`, `@notesapp/editor`, `@notesapp/ui`.

This package is browser code. It cannot import a Node built in module, a Node
only package, or a server only package. `vite.config.ts` is the one exception
that the boundary checker allows, because it runs in Node during the build.

## How to add a common thing here

- **A screen.** Add `src/features/<name>.tsx`. Compose `Page`, `PageHeader`,
  `Card`, `EmptyState`, and `ListRow` from `@notesapp/ui`. Add the route in
  `src/router.tsx`. Read and write through a generated operation.
- **Testable logic for a screen.** Add `src/features/<name>.ts` with pure
  functions and `src/features/<name>.test.ts` next to it. `save-state.ts`,
  `note-name.ts`, and `palette-items.ts` are the pattern.
- **A command palette action.** Add the entry in
  `src/features/palette-items.ts` and cover it there.

## Testing conventions here

`node --test` through `pnpm test:unit`. A test file is `*.test.ts` next to
the module it tests. There is no DOM unit framework, so a test covers a pure
module only, and it must prove the rule and its refusal path. Screen
behaviour is proved by a Playwright journey in `tests/e2e`.

## Forbidden here

`tools/check-boundaries.mjs` and `tools/check-design-rules.mjs` fail
`pnpm lint` on each rule below.

- No `fetch`, no `XMLHttpRequest`, no request URL. Call a generated operation
  from `@notesapp/api-client`.
- No handwritten CSS, no CSS module, no component style sheet, no `style=`
  JSX attribute.
- No colour value. Colour comes from the theme registry in
  `packages/ui/src/themes` through the theme tokens.
- No `text-xs`, no `text-white`, no `bg-black`, and no arbitrary Tailwind
  value such as `w-[32rem]`. Use the named scales.
- No `innerHTML` and no `dangerouslySetInnerHTML`, except the sanitized
  renderer host in `src/features/note-editor.tsx` and the sandboxed frame in
  `src/diagram/frame-main.ts`, both listed in
  `tools/design-rules-allow.json`.
- No identifier, raw timestamp, error code, or engine notice in text that a
  person reads. A note path keeps its `.md` suffix in storage and never shows
  it in the name field.

## Key files

| File                           | Purpose                              |
| ------------------------------ | ------------------------------------ |
| `src/app.tsx`                  | Application shell, theme, and stores |
| `src/router.tsx`               | Routes and screen selection          |
| `src/tailwind.css`             | The only application CSS source      |
| `src/features/note-editor.tsx` | The editor host and Read mode        |
| `vite.config.ts`               | Build, theme assets, service worker  |
