# 0062. The default action is ink and the blue carries meaning

- Status: Accepted
- Date: 2026-09-18

## Context

Record 0056 made Default the family a new account starts with and gave one
blue the link, the focus ring, the caret, the selection and the primary button.
`accentFill` reaches further than the button: the app mark in the frame, the
workspace avatar, the account avatar, the chosen chip in the settings and the
list markers of a note all paint it. The first screen of a new account shows
five or six blue blocks, and the home screen shows two blue New note buttons.
That is a taste, and record 0056 exists to remove the taste. See
[design 012](../design/012-a-finished-interface.md).

## Decision

In `packages/ui/src/themes/default.ts` the accent splits by what the colour
does.

- `accentFill` is ink. On the light page it is near black with a white label.
  On the dark page it is near white with a near black label. The hover still
  comes from record 0057, so the fill moves away from the page on both.
- `accentText` and `focus` keep the blue. A link, the focus ring, the caret and
  the selection of the editor carry a meaning that no shape states, and the
  blue states it.
- The app mark, the workspace avatar and the account avatar paint no fill of
  the accent. They take `surfaceActive` with `textStrong`, so they are
  monochrome on every palette. A chosen chip and a chosen row take the active
  surface and the strong text, never the accent fill.
- A list marker of a note takes `textMuted`.

A primary button appears once on a screen. The one action of a route sits in
the route and not also in the sidebar.

Ink and the nine borrowed families keep their own accent, because a family a
person chose is a taste the person asked for.

## Consequences

- A new account meets a neutral first screen, and the one filled control on it
  is the one action.
- Default gains no token. The derived hover of record 0057 gives the ink fill
  its hover on both variants by construction.
- `packages/ui/src/theme.test.ts` holds the label of the fill on the fill and
  on its hover, and the fill against the page, as it does for every family.
- `tests/integration/theme-variables.test.ts` holds the literal fallbacks in
  `apps/web/src/tailwind.css` to the Default dark palette of the registry, so
  the copy that keeps the first paint correct cannot drift from the registry.
- `packages/ui/src/control-classes.test.ts` holds the ink fill to the one
  primary variant of `buttonClassName`, so one recipe decides the one filled
  control of a screen. A screenshot of the home screen holds the count of one.
