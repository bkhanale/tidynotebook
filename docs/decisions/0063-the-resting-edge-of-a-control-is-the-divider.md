# 0063. The resting edge of a control is the divider

- Status: Accepted
- Date: 2026-09-18

## Context

`packages/ui/src/theme.ts` states two edge tokens, and record 0053 derives a
third. `border` is the component edge and `theme.test.ts` holds it to 3 to 1
against every surface. `borderLine` is the derived divider, between the
decorative edge and the component edge on every palette. A secondary button, a
text field, a select, the workspace switcher and every menu and dialog wore
`border`, so each one read as a dark cage on the page, and fifty four edge
utilities plus a rule under every row did all of the separation of the
product. See [design 012](../design/012-a-finished-interface.md).

## Decision

The resting edge of a control is `edge-line`, the derived divider of record
0053. A secondary button, a text field, a select, a read only field, a
switcher trigger, a card, a menu, a dialog and a toast take it. A raised
surface takes `edge-subtle` and an elevation step instead, so a light palette
shows the shadow and a dark palette shows the edge.

`edge` is reserved for a control whose state a person must read with no text:
a task box, a checkbox, a radio, a switch track and a drop target. Nothing else
in the product names it.

A field states its active state with `border-focus` and a focus ring, and its
error state with `border-danger`. Those two remain the only edges of a field
that change.

Separation between two rows, two sections or two groups comes first from space
and from fill. A rule is drawn only where a person must see the boundary of a
region they scroll or a list they count, and it is always `edge-line`.

## Consequences

- The resting edge of a text field stands under the 3 to 1 non text minimum.
  The label above the field, the fill of the field and the focus ring identify
  it, which is the trade every polished product on the market makes. This
  record states the trade, so nobody reports it as a defect.
- `theme.test.ts` keeps `border` at 3 to 1 on every surface, because a task
  box and a checkbox still depend on it.
- `packages/ui/src/control-classes.ts` writes `edge-line` into every control
  recipe and `edge` into none of them, and `control-classes.test.ts` proves it.
- `tools/check-design-rules.mjs` refuses `border-edge` and `ring-edge` outside
  the stateful controls listed above, which `tools/design-rules-allow.json`
  names by file.
