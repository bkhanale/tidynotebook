# 0016. A theme is data in one registry

- Status: Accepted
- Date: 2026-09-10

## Context

Colour values were written in several places: the Tailwind theme, the
CodeMirror adapter, the pre paint script in `index.html`, the installed
manifest, and the sandboxed diagram frame. Each place could drift, and a page
could flash the wrong palette before the first paint.

## Decision

A theme is data. `packages/ui/src/themes` holds one file per theme family,
and `packages/ui/src/themes/index.ts` is the registry that every consumer
reads. No other file in this repository holds a colour value. A family groups
the light and the dark variant of one palette, and a family may publish one
variant that answers both appearances. `ThemeTokens` and `SyntaxTokens` in
`packages/ui/src/theme.ts` name every value a theme must carry.

## Consequences

- A new theme is one data file plus one registry entry, one licence note in
  `packages/ui/THIRD_PARTY_LICENSES.md`, and nothing else.
- `applyTheme` writes every token as a `--notes-*` custom property, so the
  Tailwind palette, the CodeMirror adapter, the pre paint script, the
  manifest, and the diagram frame all read one source.
- `packages/ui/src/theme.test.ts` walks the whole registry and fails with the
  exact token, surface, and theme that misses a contrast rule.
