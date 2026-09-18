# 0061. The application is set in one vendored family

- Status: Accepted
- Date: 2026-09-18

## Context

`apps/web/src/tailwind.css` names the system font stack and no face of its
own, so the product renders in whatever the device has, and the chrome and the
note look different on every operating system. The product is offline first
and serves itself, so a face loaded from a third party is a request the product
does not control and a first paint it cannot promise. The owner reviewed a
mock with a serif note face and refused it: a note is a note and not a
document, so the note and the chrome share one voice. See
[design 012](../design/012-a-finished-interface.md).

## Decision

The application is set in one family and its monospace sibling, both vendored
in `apps/web/public/fonts` and declared with `@font-face` in
`apps/web/src/tailwind.css`, which is the one place a face is declared.

- Geist is the face of everything a person reads: every control, every row,
  every label, the note name, the text of a note and its headings, and the
  published page. `--font-sans` names it first.
- Geist Mono is the code face: a fenced block, an inline code span, a keyboard
  hint and a copied value. `--font-mono` names it first.

Each face is a variable font in the latin and the latin extended subsets, with
the italic of Geist, under the SIL Open Font License 1.1.
`packages/ui/THIRD_PARTY_LICENSES.md` records the upstream, the licence and the
files. Every declaration uses `font-display: swap`, so text is never invisible
while a file loads. The system stack stays behind each face as the fallback.

The typed editor adapter in `packages/editor/src/editor-theme.ts` reads
`--font-sans` and `--font-mono` through the variables, as it reads every other
value. No module names a family by its name outside the stylesheet.

## Consequences

- The product has one voice on every device.
- The first load grows by the font files, which the build precaches with the
  other static assets.
- A new face is a change to this record. `tools/check-design-rules.mjs` refuses
  a `font-family` and a family name outside `apps/web/src/tailwind.css`, and
  `tests/integration/theme-variables.test.ts` proves that the built page and
  the editor read the same two variables.
- `rules/04-design.md` states that `apps/web/src/tailwind.css` may hold the
  `@font-face` rules of a vendored face and that no other file may.
