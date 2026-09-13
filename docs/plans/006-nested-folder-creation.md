# Plan 006: Nested folder creation

Status: complete

> The live prioritized list is the [GitHub project board](https://github.com/users/bkhanale/projects/2).

This plan turns [design 007](../design/007-nested-folder-creation.md) and
[decision 0029](../decisions/0029-selected-folder-is-the-create-parent.md)
into ordered work.

## Decisions

- [0029. The selected folder is the create parent](../decisions/0029-selected-folder-is-the-create-parent.md)
- Kept: [0005. Workspace is an implicit container](../decisions/0005-workspace-is-an-implicit-container.md)
- Kept: [0019. Contract validation and shared types](../decisions/0019-contract-validation-and-shared-types.md)

## Items

1. Add pure rules for a child folder path and for selection fallback in
   `apps/web/src/lib/folder-selection.ts`.
2. Give the root and each folder name a selected state in
   `apps/web/src/shell/shell.tsx`. Keep expansion on a separate control.
3. Pass the selected parent to the main and command-palette New note actions.
4. Pass the selected parent to `NewFolderDialog`. Make one direct child and
   refuse a slash in its name.
5. Add unit tests for the pure path rules. Add a PostgreSQL integration test
   for a saved note with a nested path. Add a browser journey that selects a
   folder, makes a child folder, saves a note in it, and checks the server.

## Verification

Run the unit and integration suites with the Docker test database. Run
`pnpm verify`, then run the full browser matrix.
