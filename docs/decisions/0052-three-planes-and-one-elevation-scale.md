# 0052. Three planes and one elevation scale

- Status: Accepted
- Date: 2026-09-17

## Context

Every palette in `packages/ui/src/themes` carries five fills, and in every
family they order the same way: the sidebar surface is the quietest, the page
background is next, and the card surface is the brightest. Nothing stated that
order, so the frame header in `apps/web/src/shell/shell.tsx` took the card
fill and put the chrome above the page. The application also had three shadow
utilities in total and nothing between flat and modal, so a card, a popover
and a dialog read as one kind of thing.
See [design 011](../design/011-depth-and-hierarchy.md).

## Decision

The interface has three planes. The chrome plane holds the frame header and
the sidebar and takes the sidebar surface. The page plane holds the content of
a route and takes the page background. The raised plane holds a card, a menu,
a dialog and a toast and takes the card surface.

Elevation is a named scale in the central theme of `apps/web/src/tailwind.css`,
beside the type, spacing and radius scales. It has three steps, and each step
is built from the scrim of the active palette, which `theme.test.ts` already
proves is darker than every surface. No shadow carries a colour of its own.

`tools/check-design-rules.mjs` refuses a built in shadow utility in
`apps/web/src` and `packages/ui/src`.

## Consequences

- A screen states depth with a plane and a named elevation step, not with a
  one off shadow.
- A new theme needs no elevation data, because the steps read the scrim.
- A raised thing that sits on the raised plane needs a fourth value to stand
  apart. It uses an elevation step instead of a fifth fill.
- `tools/check-design-rules.mjs` gains the `banned-class` entries and fails
  `pnpm lint` on a raw shadow utility.
