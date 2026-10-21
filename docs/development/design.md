# Interface design

This page states the design rules of every screen and points at their code. The
reasons are in [design 012](../design/012-a-finished-interface.md) and its
records. `tools/check-design-rules.mjs` checks code conventions in `pnpm lint`.

Type, space and fill show order before an edge does. Use few values, and make
each one a decision you can name. When two treatments work, use the quieter one.

Use Geist for text and Geist Mono for code and keys. Fonts live in
`apps/web/public/fonts`. Only
`apps/web/src/tailwind.css` declares a face. The diagram frame includes that
stylesheet and its fonts (0061).

## The type steps

The named steps live in `apps/web/src/tailwind.css`. Use no other size.
`text-kbd` is for keys. `text-control` is for controls, rows, labels, hints,
captions and menus. `text-ui` is body text, a row title or dialog title.
`text-base` is a card or section title. `text-xl` is a page title.
`text-3xl` is a published note name or landing headline (0217).
The `text-note` steps are for note text and headings.

Two weights in the chrome: `font-medium` for a control label and a selected
row, `font-semibold` for a title. No capitals, no wide tracking, no bold.
Large type takes `tracking-heading` or `tracking-display`.

## The planes and the edges

Three planes (record 0052): `bg-surface` is chrome, `bg-app` is the page,
`bg-card` is raised. `bg-hover` and `bg-active` are the states of a row or chip.

Three edges (records 0053 and 0063): `edge-line` is the resting edge of a
control and the one divider. `edge-subtle` is the edge of a raised surface and
a hairline inside a group that already differs in fill. `edge` is only a task
box, a checkbox, a radio, a switch track and a drop target. Draw a divider only
where a person must see the boundary of a region they scroll or a list they
count. Separate everything else with space or fill.

## Elevation, radius and space

Elevation uses `shadow-raised`, `shadow-overlay` and `shadow-modal` (0052).
A raised surface uses `bg-card`, `edge-subtle` and one elevation step.
Use `rounded-sm` for keys, task boxes and meters; `rounded-md` for controls
and rows; `rounded-lg` for cards, menus, toasts and code; `rounded-xl` for
dialogs; and `rounded-full` only for avatars.

Space comes from the named steps `gutter`, `gutter-wide`, `cluster` and
`group`, plus the numeric scale inside one control.

## Note app pages

Private workspace routes use `Page` and the note column. Keep the left
navigation, the `40 rem` main column and the `14 rem` right region from `xl`
(record 0137). Keep account themes. `pageGutter` sets the edge space.

## Public pages

The guide, installation Terms and Privacy, and published notes use
`publicLayout` from `packages/ui/src/public-layout.ts`. Put its `gutter`
outside its `container`: `16 px`, or `24 px` from `sm`, outside the centred
`max-w-5xl` (`64 rem`) cap. Long text uses its `reading` class, `max-w-note`
(`40 rem`), inside the cap. Keep the current public headers, footers and type
steps. Published notes have no application frame. Password and unavailable
pages keep their narrow centred form.

The guide keeps its `17 rem` contents navigation and small-screen menu. Its
article uses the reading class. Put the page outline inside that column;
reserve no right region. The landing home page keeps its feature icons and
real product screenshots from record 0217.

## Account pages

Use `AuthFrame` from `apps/web/src/features/accounts/accounts.tsx` for sign-in,
account forms, standalone OAuth consent and status, and application errors.
It centres a `24 rem` card. Page errors inside the workspace keep `Page`.

These three layout families are documented only. They add no page checklist,
check or enforcement test.

## Controls

Every control reads `packages/ui/src/control-classes.ts` (record 0065).

- `buttonClassName`: `primary` is the one main action, with ink fill.
  `secondary` uses `bg-card`, `edge-line` and `shadow-raised`. `ghost` is for
  icon actions and Cancel. Destructive actions use the recipe's danger tone.
  Sizes are `md` (`32 px`), `sm` (`28 px`) and `compact`, which keeps its touch
  target. Disabled controls use `text-muted` and `bg-hover`, with no fading.
- `rowClassName`: every clickable row, `28 px` on desktop, `rounded-md`,
  `hover:bg-hover`. Selection uses `bg-active text-strong font-medium`, with
  no ring. Destructive rows use the recipe's danger tone.
- `fieldClassName`: text, select and read only fields, `32 px`. Use `edge-line`,
  `border-focus` when active and `border-danger` on error. `touchFieldText`
  prevents phone zoom. Put a `text-control font-medium` label above.
  `inlineFieldClassName` is for a tree row.
- `tabClassName`: tabs and chips use `bg-active` when selected.
- `kbdClassName`: each key uses `text-kbd font-mono` and `edge-line`.
  `KeyHint` in `apps/web/src/shell/key-hint.tsx` gives device keys and a name.
- `meterClassNames`: `Meter` uses `bg-hover`, `bg-accent-fill` and
  `h-1.5 rounded-sm`. `meterWidthClassName` gives twelfths and keeps positive
  use visible. Only full use fills it. At `90%`, `meterAlmostFull` uses
  `bg-danger-fill` and Almost full. State the minimum, maximum and value.

Focus uses `focus-visible:` with one outline, outward on a control and inward on
a row in a scroller, two pixels in the focus colour. A primary button appears
once, inside the route, never in the sidebar. A hover changes only the fill
(record 0057). Nothing scales on press.

## Icons

`packages/ui/src/icons.tsx` is the one set: a 24 grid at a stroke of 1.5. An
icon is 16 px in a control, a row and a label, and 20 px in an empty state. A
menu gives every row an icon or no row an icon. An action carries one icon
everywhere. An icon only action carries a `label`. Delete an unused icon.

## The frame

The `44 px` header holds the route context, sidebar toggle, breadcrumb,
`HeaderSlot` actions, `HeaderLeafSlot`, Search and avatar (0064).
The note puts its name in the breadcrumb, with History and Publish in one
menu (0069). Header icon controls are compact. An end control uses
`edgeControlClassName`. The sidebar holds the switcher, tree or calendar, and
footer (0105). The wordmark belongs to sign-in and setup.
The note keeps one formatting row above its text at every width (0094).
`apps/web/src/lib/format-toolbar.ts` defines the actions for the row, command
palette and slash menu. An overlay opens above the phone keyboard.

## Surfaces a person waits on or reads

- An empty state has a `20 px` icon, a `text-ui font-semibold` title, one
  `text-control text-muted` sentence and one action. No box.
- A notice uses one tone surface, its tone mark and `text-strong`. No edge.
  Use one notice per cause. Use `LoadingState` for loading.
- `Toast` sits at the bottom with one sentence and one action.
- Menus and dialogs use raised surfaces. The image viewer uses the scrim
  (0145). A dialog has a `text-ui` title, `ghost` Cancel and `primary` or
  `danger` confirmation. Its body scrolls inside the screen.

Use sentence case and action names: Save, Trash, Move to Trash, Restore,
Delete, History, Publish. Delete removes a note for good, in Trash only
(0164). A row shows one name and one fact.

## Before a screen lands

- One primary button, every icon 16 or 20, every label in sentence case.
- Light and dark both read: take a screenshot of each.
- The keyboard reaches every action, and the focus is visible.
- `pnpm lint` passes with no new entry in `tools/design-rules-allow.json`.
