# 0064. The frame header is the context of the route

- Status: Accepted
- Date: 2026-09-18

## Context

Record 0015 gave the interface a 48 px header and a quiet sidebar. The header
in `apps/web/src/shell/shell.tsx` holds a wordmark, a centred search field that
is a button, and a kebab that opens the account menu. It never states where the
person is or what they can do on this route. The note screen carries its
actions in a sidebar row menu and in the command palette, and its name row
carries the name alone. The sidebar shows a bordered select for the workspace,
a filled button beside an icon button, a label in capitals and guide lines down
every branch. See [design 012](../design/012-a-finished-interface.md).

## Decision

The frame header is 44 px and it is the context of the route.

- The left holds the sidebar toggle and a breadcrumb: the workspace name, the
  folder path when the route is inside one, and the name of the note or the
  page. Each part but the last is a link.
- The middle holds the actions of the route. A route fills them through
  `HeaderSlot` in `apps/web/src/shell/header-slot.tsx`, a React context that
  the shell renders and a screen writes. The note route places History,
  Publish and a menu of the rest there. A screen with no action leaves it
  empty.
- The right holds the search action, an icon with the word Search and its key
  hint from the medium width up, and the account avatar, a monochrome circle of
  the initial that opens the account menu.
- The wordmark leaves the frame. The sign in and setup screens keep it.

The sidebar is a column of rows on the chrome plane.

- The first row is the workspace switcher: the workspace initial in a small
  square, the name and a chevron, as a ghost control that opens the menu.
- Then a Search row and a New note row, each with an icon and a key hint.
- Then the Folders label, in sentence case, with a New folder action at its
  right that appears on hover and on focus.
- Then the tree. A row is 28 px on a desktop and 44 px under touch. A level
  indents by one fixed step and draws no guide line. The open note takes the
  active surface and the strong text. The selected folder takes the hover
  surface. Nothing takes a ring.
- Then the footer rows: the sync state as a dot and a sentence, Trash and
  Published links. A row whose route is open reads `aria-current` and takes
  the same mark as the open note.

Under the medium width the header keeps the drawer toggle, the breadcrumb and
the account, and the sidebar becomes the drawer of record 0035.

## Consequences

- A person reads where they are and what they can do from one bar.
- The primary action of a screen lives in the screen, so the sidebar shows no
  filled button, and record 0062 holds.
- The header search, the account menu, the new note action and every tree row
  keep an accessible name. The pure modules of `apps/web/src/lib/` decide the
  breadcrumb rows and the tree rows, and their unit tests hold the new names,
  so the change is in the names and not in the mechanism.
- `HeaderSlot` is a context in `apps/web/src/shell/`. It moves no boundary and
  it adds no package.
- This refines record 0015, whose header is now 44 px and whose one primary
  action is the one of the route.
