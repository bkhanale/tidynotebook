# 0138. A page names the page above it, and Accounts belong to Settings

- Status: Accepted
- Date: 2026-09-30

## Context

Trash, Published links, Needs attention, History, Review and Page not found
each drew a back control of their own among the actions of the page header,
with a word and in a place of its own. Settings had none, after record 0091.
A list row carries its own inset, so the group labels, the row text and the
row buttons of a list stood to the inside of the page title and of the page
actions. The account page of an administrator had a row of its own in the
sidebar, beside Trash, and Settings linked to it as well. The owner asked for
one back control on every page, for one alignment, and for Accounts inside
Settings, on 2026-09-30.

## Decision

- `pageParents` in `apps/web/src/lib/breadcrumb.ts` names the page above
  each page of the frame. All notes has none. `backTarget` turns it into the
  address and the name of the one back control. `BackLink` in
  `apps/web/src/shell/back-link.tsx` draws it: a ghost caret with a name and
  a title, pulled onto the edge of the column. The frame gives it to every
  `PageHeader` through `PageBackProvider`, and the header puts it before the
  title, so no page draws a back control of its own or leaves it out.
- The breadcrumb names the page above a page when that page is not the note
  list or the note, so Accounts reads Settings, then Accounts.
- The sidebar has no Accounts row. Settings opens Accounts, and the command
  palette keeps its action. The address stays, so no link breaks.
- A list takes back the inset of its rows with `pageListClassName` in
  `packages/ui/src/layout-classes.ts`, and a group label has no inset. The
  text of a row, its buttons and its label line up with the page title and
  the page actions, and the hover fill reaches into the gutter.

## Consequences

- One back control, in one place, on every page but All notes and the note.
  This replaces the bullet of record 0091 that removed the back control of
  Settings.
- `breadcrumb.test.ts` holds the page above each page and the back target.
  `layout-classes.test.ts` holds the list and its label.
- This refines records 0064, 0091 and 0137.
