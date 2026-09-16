# 0048. Publish is a command and the links are one workspace list

- Status: Accepted
- Date: 2026-09-16

## Context

Records 0030, 0031, 0046 and 0047 state what a published link is and how a
reader opens one. None of them states where the owner publishes one, or where
the owner reads what is open right now.

Record 0015 makes the note surface the design and record 0026 slimmed the save
and delete surfaces, so a new control on the note screen has a high bar.
`apps/web/src/features/editor/note-header.tsx` carries no overflow menu and no
status today, because every action of the open note already lives in the
command palette of records 0010 and 0028. `listPublishedLinks` in
`packages/api-contract/` is scoped to a workspace, and a folder link opens many
notes, so no single note can own the list.

## Decision

Publish is a command, and the links are one list of the workspace.

- The open note offers Publish in the command palette, beside Move, Duplicate,
  Export and Delete. The note surface gains no control and no menu.
- A folder offers Publish in the row menu of the sidebar tree, beside New note,
  New folder, Rename folder and Delete folder. A folder has no screen.
- `/w/:workspaceId/published` is the one list, in
  `apps/web/src/features/publishing/`. The sidebar names it beside Trash at
  every moment, including the moment when the workspace holds no link, because
  "nothing is open" is the answer that an owner most needs to trust.
- The one time token never reaches that list. The create answer is the one
  answer that holds it, so the publish dialog is the one place that shows it,
  and the dialog asks once before it closes without a copy.
- Revoke acts at once and asks nothing, because a person revokes a link to stop
  a disclosure and the step back is one more publish.
- The words are Publish, published link, Revoke and Copy link. One term names
  one thing, as the root `AGENTS.md` requires.

This excludes a per note list of links, a publish control on the note surface,
a second address for the same list, and any reader count.

## Consequences

The web application gains one route, one sidebar row, one folder menu row and
one dialog, and no control on the note surface. The list carries the audit
duty, so a later feature that hides it when it is empty breaks this record.
The rules of both screens sit in
`apps/web/src/features/publishing/publishing.ts` with its unit test, and the
browser journeys of plan 007 prove the screens.
