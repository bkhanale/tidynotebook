# Page layouts

These family rules are documented only. They add no checklist, gate, design
lint or enforcement test. Keep the current type steps and theme tokens.

## Note app pages

- Private workspace routes use `Page`: left navigation, a `40 rem` note
  column, and a `14 rem` right region from `xl`. Keep account themes.
- Use `pageGutter` from `packages/ui/src/layout.tsx` for edge space.

## Public pages

- The guide, installation Terms and Privacy, and published notes use
  `publicLayout` from `packages/ui/src/public-layout.ts`. Its `container` is
  centred `max-w-5xl` (`64 rem`). Put its `gutter` outside the cap: `16 px`,
  or `24 px` from `sm`. Long text uses `reading`, `max-w-note` (`40 rem`).
- Keep public headers, footers and type steps. The guide keeps its `17 rem`
  contents navigation and phone menu. Put its outline in the reading column,
  with no right reserve.
- Published notes have no app frame. Password and unavailable pages keep
  their narrow centred form. Legal pages use the same server width helper.
- The landing home keeps its feature icons and real product screenshots
  from [record 0217](../decisions/0217-the-landing-home-page-may-use-a-wide-column.md).

## Account pages

Use `AuthFrame` from `apps/web/src/features/accounts/accounts.tsx` for
sign-in, account forms, standalone OAuth consent and status, and application
errors. It centres a `24 rem` card. Workspace page errors keep `Page`.
