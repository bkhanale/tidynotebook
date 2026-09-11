# 0015. The note surface is the design

- Status: Accepted
- Date: 2026-09-10

## Context

The interface grew screen by screen. Each screen carried its own header, its
own spacing, and its own empty state, so the note itself competed with the
chrome around it.

## Decision

The typography, the measure, and the vertical rhythm of the note are designed
first. The chrome recedes: a 48 px header, a quiet sidebar, and one primary
action. The palette is exposed to the person as System, Light, and Dark.
Layout primitives (Page, PageHeader, Card, Dialog, EmptyState, ListRow) live
in `packages/ui`, and every screen uses them.

## Consequences

- A new screen composes the primitives in `packages/ui/src/layout.tsx`. It
  does not build its own page frame.
- Body text is 14 px and control text is 13 px, from the named type scale.
- `tools/check-design-rules.mjs` refuses a one off size, an arbitrary
  Tailwind value, an inline style, and a colour outside the theme registry.
