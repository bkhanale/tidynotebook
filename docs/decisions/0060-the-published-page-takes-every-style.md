# 0060. The published page takes every emitted style

- Status: Accepted
- Date: 2026-09-17

## Context

`apps/web/src/lib/markdown.ts` imports the mathematics style with the module
that renders a formula, so the application loads that style only on a screen
that holds one. The build therefore writes it as a file of its own, which the
shell document does not name.

The published page of decision 0031 reads the stylesheets of the shell
document, so it loaded the theme and nothing else. The page holds no script,
by decision 0047, so it cannot load a style when it finds that it needs one.
Mathematics on a published page had no style at all.

Moving the mathematics style into the first stylesheet would answer it as
well, and it would put about 25 KB on the first paint of every screen of the
application, including the sign-in screen. Decision 0044 keeps the first load
small, and the mathematics style is needed by neither the sign-in screen nor
the note list.

## Decision

The published page names every stylesheet that the build emitted.
`builtStylesheetHrefs` in `apps/server/src/plugins/static-assets.ts` lists
them, and `createApp` puts the shell stylesheet first so the theme of the
application wins the cascade.

The application is untouched. It keeps its split styles and loads the
mathematics style with the module that needs it.

## Consequences

- A published page renders every construct of the Markdown language of this
  product with its own style, and a new style of a new construct reaches the
  page with no further change.
- A reader loads every emitted stylesheet, including one that the page does
  not use. That is bounded by what the build emits, and it costs the reader
  page alone.
- The first load of the application stays as decision 0044 left it.
- `tests/integration/published-styles.test.ts` proves the page names the
  mathematics style and renders a formula with it.
