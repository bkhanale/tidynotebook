# 0105. The sidebar shows one view at a time

- Status: Accepted
- Date: 2026-09-25

## Context

Record 0100 put the calendar under the tree, so the month takes about half the
height of the sidebar and the tree fills quickly. The owner asks for a thin
bar at the left edge of the sidebar with icon buttons, where each button
selects what the sidebar shows: the tree of notes, or the calendar.

## Decision

- The sidebar is two columns: the view bar and the panel. The bar is a column
  of icon-only buttons, one for each view, and it is part of the sidebar: it
  hides and opens with it, and it is in the drawer on a phone.
- The views are Notes, the tree and its actions, and Calendar, the month of
  record 0100. The panel shows one view. The workspace switcher above and the
  footer rows below stay in every view.
- A view button states its view with `aria-pressed`, a label and a title.
  `sidebarViewClassName` of `control-classes.ts` draws it. The view is a
  device choice, like the width of the sidebar, and Notes is the default.
- The calendar has its own view, so it always shows its month, and the choice
  to hide the month goes.
- Each width step of the sidebar grows by the width of the bar, so the panel
  keeps the width it had.

This refines record 0100.

## Consequences

- The tree has the full height of the sidebar again.
- A day of the calendar is one press further away when the tree shows, and
  the palette keeps Open today's note.
- A new view is one entry of `lib/sidebar-view.ts`, one button and one panel.
- `sidebar-view.test.ts`, `sidebar-size.test.ts` and `control-classes.test.ts`
  hold the rules.
