# Product design

- Use Tailwind CSS utilities for application layout and presentation.
- Do not add handwritten CSS selectors, CSS modules, component style sheets,
  or inline `style` properties.
- `apps/web/src/tailwind.css` is the only application CSS source. It can have
  only Tailwind imports, source registration, and central theme variables.
- Keep color, typography, spacing, radius, and shadow decisions in the central
  Tailwind theme and runtime palette. Do not add arbitrary Tailwind values.
- Color comes from the theme registry in `packages/ui/src/themes` only. Do not
  write a color value anywhere else. A new theme is one data file plus one
  registry entry.
- Use the named type scale. Body text is 14 px. Control text is 13 px. Use the
  standard Tailwind heading scale. Do not add one-off font sizes.
- Use the standard Tailwind spacing scale. Do not add one-off pixel or rem
  spacing values.
- A typed adapter for a third-party rendering system, such as CodeMirror, can
  set presentation in TypeScript only when utility classes cannot reach its
  generated DOM. It must use the central Tailwind and semantic theme variables.
- Use native semantic elements. Every icon-only action must have an accessible
  name and a title when the purpose is not clear from context.
- Keep keyboard focus visible. Dialogs must support Escape. Important actions
  must be possible without a pointer.
- Use compact controls by default. Keep controls large enough for reliable
  pointer and touch input.
