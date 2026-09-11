# Themes

A theme is data. `packages/ui/src/themes` holds one file per theme family,
and `packages/ui/src/themes/index.ts` is the registry that every consumer
reads. No other file in this repository holds a colour value.

## What one theme is

```ts
{
  id: 'nord',            // stable identifier of this variant
  family: 'nord',        // the family the variant belongs to
  name: 'Nord',          // the name a person reads
  appearance: 'dark',    // which device preference this variant answers
  source: { project, url, licence },
  tokens: { background, surface, surfaceCard, ... },
  syntax: { keyword, string, comment, number, tag, attribute, heading, link,
            punctuation },
}
```

A family groups the light and the dark variant of one palette. A family may
publish one variant only; it then answers both appearances with that one.

`ThemeTokens` and `SyntaxTokens` in `packages/ui/src/theme.ts` name every
value a theme must carry, and the module documentation there states what each
token is for and which contrast rule holds it.

## Who reads the registry

- The Tailwind palette, through `applyTheme`, which writes every token as a
  `--notes-*` custom property on the document element.
- The CodeMirror adapter, which reads `--notes-*` and `--notes-syntax-*`. A
  theme change therefore repaints an open note with no reconfiguration.
- The script in `apps/web/index.html` that runs before the first paint. The
  Vite plugin `notesapp-theme-assets` writes the whole registry into it at
  build time, so the page never flashes the wrong palette.
- The installed manifest, whose interface colour the same plugin writes.
- The sandboxed diagram frame, which receives the colours it paints with in
  the render request.

## The stored preference

An account stores `appearance` (`system`, `light`, or `dark`) and
`themeFamily`. The appearance selects the variant; the family selects the
palette. Both are written to this device first and synced to the account in
the background. A family the client does not know falls back to the default
family, so a stored value never leaves the page without colour.

## Adding a theme

1. Copy an existing file in `packages/ui/src/themes`, for example
   `nord.ts`. Name the new file after the family.
2. Fill in the family identifier, the name, the source (project, address,
   licence), and one or two variants with their tokens and syntax colours.
   Take the values from the published palette of the project.
3. Add the family to `themeFamilies` in `packages/ui/src/themes/index.ts`.
4. Record the project, the licence, the address, and every value you had to
   derive in `packages/ui/THIRD_PARTY_LICENSES.md`.
5. Run `pnpm --filter @notesapp/ui test:unit`. `theme.test.ts` walks the
   whole registry and fails with the exact token, surface, and theme that
   misses a contrast rule. Move that token along its own lightness until it
   passes, and note it in the licence file.
6. Run `pnpm verify`.

Nothing else changes. The settings screen, the pre-paint script, the
manifest, the editor, and the diagram frame all read the registry, so a new
family appears in the theme picker with its swatch as soon as it is
registered.
