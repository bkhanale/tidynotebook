# 0071. The page states its appearance to the browser

- Status: Accepted
- Date: 2026-09-20

## Context

A browser paints parts of a page that no stylesheet of ours reaches: the
scrollbar of every region that scrolls, a native select, a date field, and the
fill it puts into a remembered field. It paints each one from the colour scheme
of the document, and it assumes a light page until the document states one.

`applyTheme` in `packages/ui/src/theme.ts` wrote the palette and the
`data-theme` attribute, and the first paint script of `apps/web/index.html`
wrote the same palette before it. Neither stated a colour scheme, so every dark
palette of the registry carried the light scrollbar of the browser. On the note
surface that bar is the widest light shape on a dark page.

## Decision

The appearance of the active theme is the colour scheme of the document.
`applyTheme` writes it beside the palette, and the first paint script writes it
beside the background, so the first frame and every theme change agree. The
`Appearance` type already holds the two keywords that CSS names, so no new
value and no new token exists.

The palette stays the source of every colour that we paint. This record covers
only what the browser paints for itself.

## Consequences

- A scrollbar, a native control and a remembered field follow the theme on
  every palette of the registry, with no rule for each one.
- `packages/ui/src/theme.test.ts` walks the registry and holds every theme to
  its own appearance, so a new theme needs no new test.
- `tests/integration/theme-variables.test.ts` holds the first paint script to
  the same statement, including the branch that runs when the script fails.
- A surface that wants a scrollbar of its own still has none. That is a
  separate choice and it needs its own record.
