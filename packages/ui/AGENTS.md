# packages/ui

Read the root [AGENTS.md](../../AGENTS.md) first, then
[the feature workflow](../../docs/development/feature-workflow.md). This package
holds the theme registry, the layout primitives, the accessible controls and
the icons. `src/themes/` is the one place here that holds a colour value.

## What lives here and what does not

- `src/themes/` holds one file per theme family and `src/themes/index.ts` is
  the registry. `default.ts` is the family a new account starts with (0056).
  `src/theme.ts` declares `ThemeTokens` and `SyntaxTokens`, `applyTheme`, the
  contrast helpers, and `derivedPropertyNames`, the values a palette does not
  state: the divider (0053) and the hover of a control fill (0057).
- `src/layout.tsx` holds `Page`, `PageHeader`, `Card`, `EmptyState`, `ListRow`,
  `Toolbar`, and `pageGutter`, the one distance from the edge of the screen to
  the content. `src/controls.tsx`, `src/menu.tsx`, `src/dialog.tsx` and
  `src/notice.tsx` hold the controls, `src/control-classes.ts` their class and
  name rules as pure functions, `src/overlay-position.ts` the place an overlay
  takes on the screen (0058), and `src/loading.tsx` the one placeholder of a
  wait. `src/motion.ts` holds the named transitions and may name a duration, an
  easing or a transition, which no other module here may (0054).
- No screen, no route, no data fetching, and no storage lives here. A control
  takes its data and its callbacks as props.

## Allowed imports

Nothing from the workspace, only `react` and `react-dom`. `react-dom` is here
for `createPortal` alone (0058). This package is browser code and imports no
Node built in module, no Node only package, no server only package.

## How to add a common thing here

- **A theme.** Copy a file in `src/themes`, fill in the family, the source and
  the variants, register it in `src/themes/index.ts`, record the licence in
  `THIRD_PARTY_LICENSES.md`, and read [themes.md](../../docs/development/themes.md).
- **A control.** Add it in `src/controls.tsx`, export it from `src/index.ts`,
  and give an icon only action an accessible name and a title. One that moves
  reads a name from `src/motion.ts`, one that stands off its plane reads an
  elevation step, and a fill behind a label reads a palette name (0057).
- **A menu.** `label` names the trigger even when it shows text, and it reaches
  the control whether or not the control also shows text. A menu of
  alternatives sets `selected`, which makes each row a `menuitemradio`, and an
  unbounded list puts its create action in `pinned`.
- **An overlay.** It opens at the end of the document, so no box that scrolls
  can cut it. `src/overlay-position.ts` decides the place and `src/menu.tsx`
  writes it. Those two are the only modules here that hold a position, and they
  hold nothing else (0058).
- **A layout primitive.** Add it in `src/layout.tsx` and use it everywhere. A
  frame that cannot use `Page` reads `pageGutter` and never its own padding.

## Testing conventions here

`node --test` through `pnpm test:unit`. `src/theme.test.ts` walks the registry
and fails with the exact token, surface and theme that misses a contrast rule,
so a new theme needs no new test. Node loads no `.tsx` file, so a rule a test
must read lives in a `.ts` module: `src/control-classes.ts` for a control and
`src/overlay-position.ts` for an overlay.
`tests/integration/theme-variables.test.ts` proves the built page and the
editor read one palette.

## Forbidden here

`tools/check-design-rules.mjs` fails `pnpm lint` on each of these.

- No colour value outside `src/themes/`: no hex value, no `rgb(`, and no named
  colour utility such as `text-white` or `bg-black`.
- No arbitrary value such as `w-[32rem]`, and no `style=` attribute. No
  `text-xs`: `text-control` is the smallest. No `dangerouslySetInnerHTML`.
- No built in shadow utility: depth is `shadow-raised`, `shadow-overlay` and
  `shadow-modal` (0052). No duration, easing or transition outside
  `src/motion.ts` (0054). No colour filter such as `brightness-110` (0057).
- No network call, storage, router, or workspace dependency, and no theme that
  misses a contrast rule. Move a failing token along its own lightness until
  `theme.test.ts` passes, and note it in the licence file.

## Key files

| File                      | Purpose                                     |
| ------------------------- | ------------------------------------------- |
| `src/index.ts`            | The one public entry point                  |
| `src/themes/index.ts`     | The theme registry                          |
| `src/theme.ts`            | Token names, `applyTheme`, contrast checks  |
| `src/control-classes.ts`  | The class and name rules of a control       |
| `src/overlay-position.ts` | Where an overlay sits on the screen         |
| `src/motion.ts`           | The named transitions of the application    |
| `src/layout.tsx`          | Page, PageHeader, Card, EmptyState, ListRow |
| `src/controls.tsx`        | Buttons, inputs and their wrappers          |
| `THIRD_PARTY_LICENSES.md` | The source and licence of every palette     |
