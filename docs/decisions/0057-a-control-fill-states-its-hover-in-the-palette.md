# 0057. A control fill states its hover in the palette

- Status: Accepted
- Date: 2026-09-17

## Context

The primary button and the danger button in `packages/ui/src/controls.tsx` made
their hover state with `hover:brightness-110`. A filter is not palette data, so
`packages/ui/src/theme.test.ts` never saw the colour it produced.

A filter that multiplies every channel always makes a fill lighter. On a light
palette that moves the control toward its page, so a hovered button read as less
important than a resting one, on all nine light variants. It also cost the
label its minimum: on nine of the eighteen variants the label of a hovered
button fell below 4.5 to 1, down to 3.81 on one-dark.

The same shape of fault sat in `Badge`, which made its fill from its own text
colour with an opacity modifier, so the label and the fill moved together and
twelve variants fell below the minimum.

## Decision

A control fill states its hover state in the palette. `themeProperties` in
`packages/ui/src/theme.ts` derives `accentFillHover` and `dangerFillHover` from
the fill and the page background, as it derives the divider (record 0053). The
rule moves the fill away from the page background by `fillHoverShift`: a light
page darkens the fill and a dark page lightens it. The direction is therefore
correct on every palette by construction, and no palette states a new value.

A fill that a label sits on comes from the palette. A screen does not make one
with a filter or with an opacity modifier. `Badge` reads `surfaceHover`, which
is one of the five surfaces that `theme.test.ts` already holds every tone
colour to. An opacity modifier stays allowed for an edge, a ring and a scrim,
which carry no text.

`tools/check-design-rules.mjs` refuses a colour filter utility in
`apps/web/src` and `packages/ui/src`.

## Consequences

- `theme.test.ts` states two invariants of the hover fill for every theme in
  the registry: it stands further from the page background than the fill, and
  the label of the fill still meets 4.5 to 1 on it.
- A new theme gains no new value and cannot place the hover state wrong.
- Solarized Dark states a danger fill that no label could meet on both the fill
  and its hover, so its danger fill and its danger label move. The licence file
  records it.
- The count of custom properties grows by two. `theme.test.ts` and
  `apps/web/src/theme-wiring.test.ts` count the derived names, so the inline
  script of the first paint carries them with no change.
- `tools/check-design-rules.mjs` gains the `colour-filter` rule and fails
  `pnpm lint` on `brightness`, `saturate`, `contrast`, `grayscale`, `invert`,
  `sepia` and `hue-rotate`.
