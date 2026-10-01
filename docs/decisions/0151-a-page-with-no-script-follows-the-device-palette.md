# 0151. A page with no script follows the device palette

- Status: Accepted
- Date: 2026-10-01

## Context

[Issue 210](https://github.com/bkhanale/notesapp/issues/210): a published page
always draws in the dark palette. `publishedDocument` in
`apps/server/src/routes/published-document.ts` and the legal page of
`apps/server/src/routes/legal-document.ts` write `data-theme="dark"`, and the
colours come from the dark fallbacks of `apps/web/src/tailwind.css`. The page
holds no script (record 0031), so it cannot paint the palette as the script of
`apps/web/index.html` does. No record chose a dark page on purpose.

## Decision

- A page that the server writes states no `data-theme`, and it follows the
  light or dark preference of the device of the reader.
- The build writes the palette of such a page into the one stylesheet, from
  the theme registry: `devicePaletteCss` in `apps/web/src/lib/first-paint.ts`
  gives every property of the Default dark palette, and of the Default light
  palette under `prefers-color-scheme: light`, with the colour scheme of each.
  `apps/web/vite.config.ts` appends it to the stylesheet at the build.
- The rule selects only a root with no `data-theme`. The shell document
  states one before its script runs, so the theme of an account always wins.
- The page takes the Default family. It reads no account, so it cannot take
  the theme of the owner or of the reader.
- No colour value is written outside `packages/ui/src/themes`, no second
  stylesheet is loaded, and the page holds no script.

## Consequences

- A reader with a light device gets a light page, and a dark device a dark
  page.
- `apps/web/src/lib/first-paint.test.ts` proves the rule from the registry,
  `tests/integration/published-styles.test.ts` that the built stylesheet holds
  it, and `apps/server/src/routes/published-document.test.ts` that the page
  states no appearance.
