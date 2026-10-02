# 0161. A render failure stops at the nearest route boundary

- Status: Accepted
- Date: 2026-10-02

## Context

No route of `apps/web/src/router.tsx` sets an error boundary, and no module of
`apps/web/src` or `packages/ui/src` defines one. An exception during a render,
or a deferred module that does not load, shows the default page of React
Router: an engine notice and, in a development build, a stack. One failure
inside a note takes the sidebar and the header with it. Finding 7 of the
[product audit of 2026-10-02](../audits/2026-10-02/product-audit.md) and
issue 244.

## Decision

- `apps/web/src/router.tsx` holds two boundaries, both as `errorElement`:
  - The application boundary is one pathless route above every route. It
    holds a failure of a public page, of the session guard and of the frame
    itself, and it draws a page with no frame.
  - The page boundary is one pathless route that holds every child page of
    the workspace frame. It draws in the outlet of the frame, so the sidebar,
    the header and the tree stay, and a person can open another page. A
    failure inside the note route stops there.
- A new route goes under one of the two, so no route is without a boundary.
- `apps/web/src/lib/route-error.ts` is the one pure decision: from the error,
  the scope and the address it gives the title, the sentence, the actions
  and the log fields. A module that did not load reads as a load failure,
  and every other error as a stop. Reload is the one primary action. A link
  to the notes of the workspace follows it when it goes to another page.
- `apps/web/src/shell/route-error.tsx` draws that decision from `Page`,
  `PageHeader` and `Button` of `packages/ui`.
- The screen never shows an error message, a stack, a status or a code. The
  boundary writes `web.render_failed` through `webLogger` (record 0020) with
  the scope and the error name only, because the message of an error can
  hold the text of a note.

## Consequences

- A failure in one page leaves the frame and every other page usable, and a
  navigation clears it.
- `apps/web/src/lib/route-error.test.ts` holds the copy, the actions and the
  log fields, and `packages/logging/src/index.test.ts` holds the event to the
  field rules of record 0020.
- An exception in an event handler is not a render failure and reaches no
  boundary. Each handler still states its own failure.
