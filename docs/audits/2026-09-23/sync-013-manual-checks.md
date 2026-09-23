# Manual checks of Review and the complete sync flow

- Date: 2026-09-23
- Commit read: a5a8ae7

This audit records the manual checks that record 0066 leaves to a person, for
issue 169 and the acceptance list of issue 152. Each check drove the served
application of the local Compose deployment in a headless Chromium on the same
machine. Two browser contexts stood for two devices, and a second page of one
context stood for a second tab. The checks wrote only into a workspace of their
own. A finding names the code by path and line. A finding is not a fix: each
defect becomes an issue on the
[GitHub project board](https://github.com/users/bkhanale/projects/2).

## How the checks ran

The deployment ran the image that `docker compose build app` made from the
commit above. Chromium treated the origin of the deployment as a secure origin
through its command line switch, because the deployment serves plain HTTP on a
LAN address. Without the switch the browser gives the page no service worker.
Offline work came from the offline mode of the browser context, not from a
stopped server. An IME composition came from the composition commands of the
Chromium DevTools protocol, which send the real composition events through the
input path of the browser. No operating system input method was in use.

The drive scripts stay outside the repository, as record 0066 decides.

## Results

1. The caret keeps its place when work of another device arrives. Device B
   typed at the end of one line, and device A added a line above it. The caret
   of B stayed at the same place in the same line.
2. Undo takes back only local work. On B, Ctrl + Z removed the words that B
   typed and kept the line of A. Ctrl + Y and Ctrl + Shift + Z redo, from the
   keymap of `y-codemirror.next` that
   `packages/editor/src/document-binding.ts` installs.
3. A composition keeps its characters. B composed a word while A saved a line.
   The line of A did not reach the view of B until the composition ended. After
   the commit, the composed word stayed in its place, the line of A joined, and
   both devices read the same text after a reload.
4. A restore reaches an idle open note. A restored an older version from
   History while B held the note open with no work of its own. The open note
   on B changed to the restored text without a reload, and it offered no
   Review.
5. A restore and concurrent offline work join. B wrote a line offline while A
   restored an older version. After B reconnected, both devices read the
   restored text with the line of B. B offered Review, and History marked the
   save of B as a version with changes from another device.
6. A rename and a folder move keep link rewrites and offline work. B edited a
   linking note offline while A renamed the target, and again while A moved it
   to a new folder. After each reconnect, both devices read the rewritten link
   and every offline line of B, and B offered Review. The old address of the
   moved note still opened it.
7. Review works across tabs. Both tabs of one device showed the notice after a
   merge, and Dismiss in one tab closed it in the other.
8. An update keeps unsent work. B loaded an earlier release, wrote a saved line
   and unsaved words offline, and then the deployment moved to the commit
   above. B offered the new version, and after Update now the browser store
   upgraded, both lines and the unsaved words stayed, and A received them. The
   earlier client had already sent the merged save, so this path offered no
   Review.
9. A failed local write keeps the text and a waiting Review. A second page
   opened the browser database at a newer version, so every write of B failed.
   The editor kept the typed text, the Review notice stayed, and Dismiss stated
   that the notice did not close.

## Findings

### A failed local write is invisible on the note

When every local write fails, the note shows no message, and the sidebar still
reads "Everything is saved to the server." `note-editor.tsx` keeps the failure
in `storageError` and derives `save-failed` from it
(`apps/web/src/features/editor/note-editor.tsx:273` and `:914`), but no element
renders it. The one place that stated it was the Save button, which record 0022
removed. The port asks the caller to show that the save failed
(`packages/sync/src/local-port.ts`, `LocalStorageError`). The same run also
threw an unhandled rejection from a read of the local files. The person can
leave the tab and lose the typed text, and nothing tells them.

### No workspace that holds a note can be deleted

`notesapp_delete_workspace` in
`packages/storage-server/migrations/0005_last_workspace.sql:51` deletes the
rows of `files` while the rows of `note_documents`, which migration 0007 added,
still reference them. PostgreSQL refuses the delete with
`note_documents_file_fk`, and the screen reads "The server had a problem." The
test in `tests/integration/workspaces.test.ts:85` deletes only a workspace with
no file, so the gate passes. The workspace of these checks stays until a fix
lands.

### The released image of release 0.4 serves a blank page

The web bundle of the release image of the `v0.4.0` tag holds two versions of
React, and React stops the first render with its error 527. The images of the
later releases and of the commit above hold one version. A browser that still
runs that release cannot open the application, so it cannot reach the update
that the later releases offer.

### A plain HTTP deployment has no service worker

The local deployment serves plain HTTP on a LAN address, which a browser does
not treat as a secure origin. It gives the page no service worker, so offline
opening, the update notice, and persistent offline work do not exist there.
`docs/guide/self-hosting.md` asks for an HTTPS reverse proxy, which removes
this limit.

### The name of a new note did not stay on the earlier release

While the deployment served the earlier release, the name typed into a new note
did not stay, and a second device once listed the note twice, once as a local
note. The same steps on the commit above kept every name. No finding stands for
the commit above.

## What these checks do not cover

- The upgrade of a real release 0.4 browser store. The owner took it out of this
  run, and the blank page above blocks it on that release.
- An input method of an operating system, a phone width, and a touch screen.
- The measurements of document growth, snapshot and feed size, apply time,
  browser persistence cost, and time under the workspace lock that issue 152
  asks for.
