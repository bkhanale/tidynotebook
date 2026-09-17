# 0053. The divider is derived from the palette

- Status: Accepted
- Date: 2026-09-17

## Context

`packages/ui/src/theme.ts` states two edge tokens. The component edge meets the
non text contrast minimum on all five surfaces, which `theme.test.ts` proves.
The decorative edge has no minimum, so each palette puts it close to its own
page fill. Every divider in the product used the decorative edge, so on most
palettes a person could not see the structure of a list, a card or a header.
The component edge is the only other choice and it is far too loud for a
divider. See [design 011](../design/011-depth-and-hierarchy.md).

## Decision

The divider is not palette data. `themeProperties` in
`packages/ui/src/theme.ts` derives it from two values the palette already
carries, as a fixed blend of the component edge into the page background, and
writes it with every other custom property. `derivedPropertyNames` names it,
so the inline pre paint script in `apps/web/vite.config.ts` and the typed
editor adapter receive it with the rest of the palette.

A divider that a person must see reads the derived value. The decorative edge
stays for a hairline inside a group that already differs in fill.

## Consequences

- A new theme file gains no new value, and a new theme cannot forget the
  divider or place it wrong.
- `theme.test.ts` states the invariant for every theme in the registry: the
  divider is louder than the decorative edge and quieter than the component
  edge, against the page background.
- The count of custom properties grows by one. `apps/web/src/theme-wiring.test.ts`
  and `packages/ui/src/theme.test.ts` count the derived names as well.
- A palette that moves its component edge moves its divider with it, which is
  the intent.
