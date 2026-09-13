# 0029. The selected folder is the create parent

- Status: Accepted
- Date: 2026-09-13

## Context

The domain and the tree accept nested paths. The main create actions always use
the root, because the shell has no selected folder. A folder row also uses one
button for expansion, so it cannot show a clear create parent.

## Decision

`apps/web/src/shell/shell.tsx` owns one temporary selected folder path. The
empty path is the root. A folder name selects its full relative path, and a
separate chevron controls expansion. The main New note, New folder, and command
palette create actions use the selected path. A selected path that leaves the
tree resets to the root.

Folder selection does not add a domain entity, an API operation, or stored
state. The existing relative path remains the identity of a folder.

## Consequences

- One visible selection gives all create actions the same parent.
- A person can select and expand a folder with a keyboard.
- A child folder name cannot contain a slash.
- A move, a rename, or a sync can reset the selection to the root.
- Unit tests hold path construction and fallback. A browser journey checks the
  selected parent and the saved server path.

This record follows
[design 007](../design/007-nested-folder-creation.md).
