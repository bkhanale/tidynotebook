# packages/ui

Read the root [AGENTS.md](../../AGENTS.md) first, then
[the feature workflow](../../docs/development/feature-workflow.md). This package
holds the shared interface pieces: the theme registry, layout primitives,
accessible controls, menus, dialogs, notices and lightweight SVG icons.
`src/themes/` is the one place in this repository that holds a colour value.

## What lives here and what does not

- `src/themes/` holds one file per theme family and `src/themes/index.ts` is
  the registry. `src/theme.ts` declares `ThemeTokens` and `SyntaxTokens`,
  `applyTheme`, the contrast helpers, and `derivedPropertyNames`, the values
  computed from a palette rather than stated by it (0053).
- `src/layout.tsx` holds `Page`, `PageHeader`, `Card`, `EmptyState`, `ListRow`,
  `Toolbar`, and `pageGutter`, the one distance from the edge of the screen to
  the content. `src/controls.tsx`, `src/menu.tsx`, `src/dialog.tsx` and
  `src/notice.tsx` hold the controls, `src/loading.tsx` the one placeholder a
  screen shows while it waits, and `src/motion.ts` the named transitions, the
  one module here that may name a duration, an easing or a transition (0054).
- No screen, no route, no data fetching, and no storage lives here. A control
  takes its data and its callbacks as props.

## Allowed imports

Nothing from the workspace, only `react`. This package is browser code and
imports no Node built in module, no Node only package, no server only package.

## How to add a common thing here

- **A theme.** Copy a file in `src/themes`, fill in the family, the name, the
  source and the variants, add it to `themeFamilies` in `src/themes/index.ts`,
  record the project and the licence in `THIRD_PARTY_LICENSES.md`, and read
  [themes.md](../../docs/development/themes.md).
- **A control.** Add it in `src/controls.tsx` and export it from
  `src/index.ts`. Build its classes with the named scale, and give an icon only
  action an accessible name and a title. One that moves reads a name from
  `src/motion.ts`, and one that stands off its plane reads an elevation step.
- **A menu.** `label` names the trigger even when the trigger shows text: the
  text says what the menu is about and the name says what the control does. A
  menu of alternatives sets `selected`, which makes each row a `menuitemradio`,
  and an unbounded list puts its create action in `pinned`.
- **A layout primitive.** Add it in `src/layout.tsx` and use it everywhere, so
  spacing and the heading ramp stay decided once. A frame that cannot use
  `Page` reads `pageGutter` and never its own padding.

## Testing conventions here

`node --test` through `pnpm test:unit`. `src/theme.test.ts` walks the whole
registry and fails with the exact token, surface and theme that misses a
contrast rule, so a new theme needs no new test. `buttonClassName` is tested as
the pure function it is, and `tests/integration/theme-variables.test.ts` proves
the built page and the editor read one palette.

## Forbidden here

- No colour value outside `src/themes/`: no hex value, no `rgb(`, and no named
  colour utility such as `text-white` or `bg-black`.
- No arbitrary Tailwind value such as `w-[32rem]`, and no `style=` attribute.
- No `text-xs`: `text-control` is the smallest. No `dangerouslySetInnerHTML`.
- No built in shadow utility: depth is `shadow-raised`, `shadow-overlay` and
  `shadow-modal` (0052). No duration, easing or transition utility outside
  `src/motion.ts` (0054).
- No network call, storage, router, or workspace dependency.
- No theme that misses a contrast rule. Move the token along its own lightness
  until `theme.test.ts` passes, and note it in the licence file.

`tools/check-design-rules.mjs` fails `pnpm lint` on each of these.

## Key files

| File                      | Purpose                                     |
| ------------------------- | ------------------------------------------- |
| `src/index.ts`            | The one public entry point                  |
| `src/themes/index.ts`     | The theme registry                          |
| `src/theme.ts`            | Token names, `applyTheme`, contrast checks  |
| `src/motion.ts`           | The named transitions of the application    |
| `src/layout.tsx`          | Page, PageHeader, Card, EmptyState, ListRow |
| `src/controls.tsx`        | Buttons, inputs, and their class rules      |
| `THIRD_PARTY_LICENSES.md` | The source and licence of every palette     |
