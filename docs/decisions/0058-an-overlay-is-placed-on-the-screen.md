# 0056. An overlay is placed on the screen

- Status: Accepted
- Date: 2026-09-17

## Context

`Menu` in `packages/ui/src/menu.tsx` laid its list out beside its trigger with
`absolute`. The folder tree in `apps/web/src/shell/shell.tsx` scrolls, and a box
that scrolls on one axis clips on both, so every list opened from a tree row was
cut by that box. Measured on a 1024 by 768 screen with the narrow sidebar: the
menu of a row near the foot of the tree showed one of its five actions, and the
menu of a deep row started nine pixels left of the screen.

A place on the screen is two numbers that only the browser can measure, so it
cannot be a utility class. The root `AGENTS.md` refuses handwritten CSS and an
inline `style` attribute, and `tools/check-design-rules.mjs` holds that.
`packages/ui/src/theme.ts` already writes measured and computed values to the
document through TypeScript, so the shape is not new.

## Decision

An overlay is put at the end of the document with `createPortal` and placed in
the coordinates of the screen. `packages/ui/src/overlay-position.ts` is the one
module that decides the place, as a pure function of the anchor, the overlay,
and the screen. `packages/ui/src/menu.tsx` is the one module that writes it, as
`top`, `left`, `maxHeight` and, for a trigger-wide menu, `width`.

Nothing else about an overlay is written in TypeScript. Its colour, its edge,
its radius, its padding, its depth and its motion stay in the named scales and
the theme registry.

An overlay opens below its anchor, moves above when it does not fit below and
there is more room above, and never leaves either side of the screen. It is
never taller than `overlayMaxHeight`, so a long list scrolls instead of filling
the screen.

`packages/ui` therefore imports `react-dom` as well as `react`.

## Consequences

- A menu opened from any row of any scrolling list shows every row it holds.
- The pointer, the keyboard, and the outside press read the trigger and the
  list as two places in the document, so `menu.tsx` checks both.
- A second overlay kind, such as a tooltip or a combo box list, reads the same
  module rather than inventing a second placement.
- `packages/ui/src/overlay-position.test.ts` holds every rule without a
  browser, and a browser journey opens the menu of the last row of a long tree
  and reads that every action is on the screen.
