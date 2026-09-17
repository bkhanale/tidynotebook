# 0056. The default theme has no opinion

- Status: Accepted
- Date: 2026-09-17

## Context

The registry in `packages/ui/src/themes` holds ten families, and each one is a
taste: a warm graphite, a blue night, a pastel, a low contrast reading surface.
`defaultThemeFamilyId` in `packages/ui/src/themes/index.ts` started a new
account on Ink, the signature palette of this application. A person with no
colour preference therefore met a preference on the first screen.

The default family is stated in three places that cannot import each other,
because the server holds the family as an opaque slug and never a colour
(record 0016). They are the registry above, `defaultThemeFamily` in
`packages/storage-server/src/identity-store.ts`, and the `theme_family` column
default in `packages/storage-server/src/schema.ts`.

## Decision

The default family is Default, in `packages/ui/src/themes/default.ts`. It is
neutral: a white page with near black text, and a dark neutral page with light
text. One restrained blue carries the link, the focus ring, the caret, the text
selection and the primary button, because a link that is told apart by its
underline alone is harder to read.

Default is first in `themeFamilies`, so it is first in the theme picker. Ink
stays the signature family and keeps its place in the registry with the nine
borrowed families. Nothing else about a theme changes: Default is one data file
and one registry entry, as record 0016 requires.

The three statements of the default move together, and the column default moves
with one migration.

## Consequences

- A first run shows a neutral surface, and a taste is a choice a person makes.
- The three statements of the default family stay a known split. A change to
  one without the others is a defect, and `tests/integration/row-access.test.ts`
  reads the stored default of a new account.
- Ink is no longer the family a stored value falls back to. A row that holds
  `ink` still renders Ink, because `themeFor` reads the registry and Ink is
  registered.
- `packages/ui/src/theme.test.ts` holds Default to the same contrast rules as
  every other family, so the default cannot ship with a token that fails.
