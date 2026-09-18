# 0065. One recipe for a control and one grid for an icon

- Status: Accepted
- Date: 2026-09-18

## Context

Twenty three clickable things in `apps/web/src` and `packages/ui/src` set their
own classes instead of reading `buttonClassName` in
`packages/ui/src/control-classes.ts`. They use four focus treatments and eight
of them have none. `TextField` exists three times with three heights. Icons
render at six sizes with one stroke width, so the same icon is a hairline in a
row and heavy in an empty state. Six radius values are in use and the one on
every raised surface is off the named scale. Six labels are set in capitals.
`tools/check-design-rules.mjs` refuses none of this, because it is a safety
gate and not a design gate. See
[design 012](../design/012-a-finished-interface.md).

## Decision

`packages/ui/src/control-classes.ts` is the one module that writes the classes
of a control, and every control of the product reads it.

- `buttonClassName` gives a button its variant and its size. The variants are
  `primary`, `secondary`, `ghost` and `danger`. `subtle` is removed.
- `rowClassName` gives a clickable row its classes: a tree row, a list row, a
  menu row, a palette row and a footer row. It carries the hover, the selected
  mark, the current mark and the focus treatment.
- `fieldClassName` gives a text field, a select and a read only field their
  classes. The three copies of `TextField` become one.
- `kbdClassName` gives a keyboard hint its classes.

A control is 32 px on a desktop and 44 px under touch. A small control and a
row are 28 px on a desktop. A control corner is `rounded-md`. A card, a menu, a
toast and a code block are `rounded-lg`. A dialog is `rounded-xl`, which joins
the named radius scale. A keyboard hint and a task box are `rounded-sm`.

The focus treatment is one: an outline of two pixels in the focus colour. A
control with room around it offsets the outline outward. A row inside a list
that scrolls offsets it inward, so a box that clips its children cannot hide
it. A field adds a ring in the focus colour at a quarter of its strength.

Every icon in `packages/ui/src/icons.tsx` is drawn on a 24 grid at a stroke of
1.5. An icon renders at 16 px in a control, a row and a label, and at 20 px in
an empty state. No other size exists. An icon that no screen uses is removed.
A menu gives every row an icon or no row an icon. Every action of the command
palette carries the icon of the same action in the sidebar.

Type has two weights in the chrome, `font-medium` and `font-semibold`. No label
is set in capitals or with wide tracking. The keyboard hint has its own named
step, `text-kbd`.

## Consequences

- A new screen composes controls and writes no class of its own for one.
- `tools/check-design-rules.mjs` gains rules and fails `pnpm lint` on: an icon
  `size` other than 16 or 20, `uppercase`, `tracking-wide` and its wider
  steps, `border-dashed`, `font-bold`, a text size outside the named steps
  (`text-control`, `text-ui`, `text-kbd`, `text-base`, `text-xl`, `text-3xl`
  and the note steps), a radius outside the named scale, a colour class that
  begins with a palette word and names no token, and `focus:` where
  `focus-visible:` is meant on a button or a row. The check now also scans
  `packages/editor/src` and `apps/server/src/routes/published-document.ts`.
- `control-classes.test.ts` proves each recipe: the variants, the sizes, the
  one focus treatment and the absence of `edge` (record 0063).
- A unit test of `icons.tsx` in a `.ts` module proves every icon states the
  stroke of 1.5 and the 24 grid.
- This refines record 0015, which named the primitives, and record 0057,
  whose hover rule every recipe keeps.
