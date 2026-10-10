# Product design

- Read `docs/development/design.md` before you change anything a person sees.
  It is the one system, and `tools/check-design-rules.mjs` holds its rules.
- Use Tailwind CSS utilities for application layout and presentation.
- Do not add handwritten CSS selectors, CSS modules, component style sheets,
  or inline `style` properties.
- `apps/web/src/tailwind.css` is the only application CSS source. It can have
  only Tailwind imports, source registration, central theme variables, and the
  `@font-face` rules of a vendored face (0061). No other file declares a face
  or names a family.
- One family, Geist, for everything a person reads, and Geist Mono for code
  and a keyboard hint (0061).
- Keep color, typography, spacing, radius, and shadow decisions in the central
  Tailwind theme and runtime palette. Do not add arbitrary Tailwind values.
- Color comes from the theme registry in `packages/ui/src/themes` only. Do not
  write a color value anywhere else. A new theme is one data file plus one
  registry entry.
- The one filled action on a screen is the primary button, and it appears once.
  The accent text colour marks a link, a focus ring, a caret and a selection
  and nothing else (0062).
- Use the named type steps only: `text-kbd`, `text-control`, `text-ui`,
  `text-base`, `text-xl`, `text-3xl` and the note steps. Two weights,
  `font-medium` and `font-semibold`. No capitals, no wide tracking.
- Every page is the note column (record 0137). Only the home page of the
  landing site may use `max-w-5xl`, a `text-3xl` hero headline, a 20 px feature
  icon, and a real screenshot in `rounded-lg`, `edge-subtle` and
  `shadow-overlay` (record 0217).
- Use the standard Tailwind spacing scale. Do not add one-off pixel or rem
  spacing values.
- `edge-line` is the resting edge of a control and the one divider. `edge` is
  only a task box, a checkbox, a radio, a switch and a drop target (0063).
  Separate with space and fill before a line.
- Every control reads its classes from `packages/ui/src/control-classes.ts`.
  No screen writes the classes of a button, a row, a field or a hint (0065).
- An icon is 16 px in a control and a row, 20 px in an empty state, from the
  one set at a stroke of 1.5. An icon-only action has a `label` (0065).
- Radius: `rounded-md` on a control and a row, `rounded-lg` on a card, a menu
  and a toast, `rounded-xl` on a dialog, `rounded-sm` on a hint and a task box.
- A typed adapter for a third-party rendering system, such as CodeMirror, can
  set presentation in TypeScript only when utility classes cannot reach its
  generated DOM. It must use the central Tailwind and semantic theme variables.
- Use native semantic elements. Every icon-only action must have an accessible
  name and a title when the purpose is not clear from context.
- Keep keyboard focus visible with the one focus treatment. Dialogs must
  support Escape. Important actions must be possible without a pointer.
- Use compact controls by default. Keep controls large enough for reliable
  pointer and touch input.
- Take a screenshot in light and in dark before a screen lands.
