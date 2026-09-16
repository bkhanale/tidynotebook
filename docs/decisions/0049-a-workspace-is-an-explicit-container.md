# 0049. A workspace is an explicit container that a person chooses

- Status: Accepted
- Date: 2026-09-16

## Context

[Record 0005](0005-workspace-is-an-implicit-container.md) took the workspace
off the screen, because the product served one person and no second actor
needed a switcher. A person who keeps personal notes and work notes in one
account now has one tree for both. A folder does not separate them, because no
read surface of the product is scoped to a path prefix: the note list, the
command palette, the search answer, the backlink panel, the Trash and the
published link list each read the whole workspace.

The workspace is the container that every one of those reads is already scoped
to. `packages/api-contract/paths/api_workspaces.yaml` declares the four
operations, `packages/core/src/workspaces/service.ts` holds the use cases, and
`notesapp_create_workspace` in
`packages/storage-server/migrations/0000_initial.sql` is the one way a
workspace comes into being and always makes the caller its owner. Every table
of `packages/storage-browser/src/database.ts` is keyed by the workspace as
well. Nothing below the interface has to change for a second workspace.

See [design 010](../design/010-workspaces-as-an-explicit-container.md).

## Decision

A person sees and chooses the workspace. This supersedes record 0005.

`apps/web/src/shell/workspaces.tsx` holds the switcher, a dropdown at the top
of the sidebar above the New note action. Its trigger names the open
workspace. Its list names every workspace of the account, newest last, and a
pinned row at the end of the list creates one. Rename and Delete permanently
are actions of the open workspace. `packages/ui/src/menu.tsx` gains the pinned
row, so the list can scroll while the create action stays in view.

The chosen workspace belongs to the device and is stored beside the sidebar
width. Sign-in opens the last chosen workspace of that account, and the
personal workspace when the device has no choice yet. The workspace stays in
the address, so a note link is still stable.

The first workspace is still named `Personal` and is still created by
`apps/server/src/auth/setup.ts`. The personal flag names a default and not a
protection: that workspace can be renamed and deleted like any other.

Isolation is the whole point, so nothing reaches across a workspace. Search,
the palette note list, the backlinks and the Trash stay inside the open one.
Moving a note between workspaces is not part of this decision.

## Consequences

- A person can separate two kinds of note without a second account.
- Record 0005 is superseded. The role badge, the read only state and the viewer
  notice that it removed stay removed, because this product still has one
  actor.
- Two invariants that record 0005 made unreachable are now reachable. Record
  0050 states what happens to a workspace that a person leaves, and record 0051
  states that an account always keeps one workspace.
- `tests/e2e/workspaces.spec.ts` proves the switch, the create and the
  isolation through the visible interface, and checks the server result. A unit
  test beside `apps/web/src/lib/` holds the stored choice and its fallback.
