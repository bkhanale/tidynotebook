# 0184. A free name avoids every path the server may hold

- Status: Accepted
- Date: 2026-10-03

## Context

- The file row of the browser store holds one path, the newest local one. A
  checkpoint writes the path of its draft, and a snapshot or a feed page keeps
  that path while local work waits
  (`packages/storage-browser/src/local-store/snapshot.ts`). The server still
  holds the accepted path in `live_paths` until a save that moves the note is
  accepted.
- New note, Duplicate, the name of a heading (record 0163), a rename, a move,
  Save as new note and the "(recovered)" note chose or checked a name against
  the local paths only. A note whose save of a new name is unsent or parked
  frees its old name on the device and not on the server, so the next new
  note took that name and the server refused it with `path_conflict`.

## Decision

- The file row carries `acceptedPath`: the live path of the accepted head, or
  `null` when there is no accepted head or it is a tombstone. A snapshot, a
  feed page and an acknowledgment write it. Local work never changes it.
  Schema version 10 gives an earlier row the path of its accepted head when
  the device knows it, and otherwise removes the cursor of the workspace, so
  the next pull is a snapshot that states it.
- `listHeldPaths` of the `LocalStore` port answers each path that the server
  holds or may hold, with its file: the local path and the accepted path of
  each note, the path of each queued save in any state, and the path of each
  kept text of Needs attention.
- New note, Save as new note and the "(recovered)" note read
  `listHeldPaths`. Duplicate, the name of a heading, a rename and a move read
  `namesInUse` of the files frame, which joins the listed notes with the held
  paths (`apps/web/src/lib/note-list.ts`). A note never counts its own paths.
- An import chooses against the live paths of the server, so it is unchanged.

This excludes a name check against the local path of a note alone.

## Consequences

- A new note never takes a name that a parked or unsent rename left on the
  server.
- A name that a parked save names stays taken until Needs attention resolves
  it, so a new note may skip a name that is free on the server.
- `apps/web/src/lib/note-list.test.ts` holds the join,
  `tests/integration/browser-storage.test.ts` the held paths and the upgrade,
  and `tests/integration/sync.test.ts` a new note after a parked rename.
