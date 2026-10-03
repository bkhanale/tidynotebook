# 0168. A note read carries the document only for an editor

- Status: Accepted
- Date: 2026-10-02

## Context

`getFile` answers the Markdown of the head and the whole document of the note
(records 0081, 0084), so a read sends more bytes than the text of the note
([issue 264](https://github.com/bkhanale/notesapp/issues/264), measured in the
[performance audit](../audits/2026-10-02/performance.md#server)). Three readers
in `apps/web` call it. The note loader in
`apps/web/src/features/editor/note-loader.tsx` keeps both, because an editor
must start from the document of the server and never from Markdown (record
0084), and the store keeps the text beside it (record 0133). History in
`apps/web/src/features/history/history.tsx` and the template read in
`apps/web/src/shell/note-text.ts` show the text only. The web application
ships with the server, but an installed application can run a bundle of an
earlier release against a newer server until it updates.

## Decision

- `getFile` takes the query parameter `content`. `text` answers the Markdown
  and a `null` document. `full` answers both, and it is the default, so a
  caller that names no value reads what it read before.
- A reader that shows the text asks for `text`: History and the template
  read. The note loader asks for `full` by name.
- The default stays `full` for as long as an earlier bundle can call the
  server. An earlier bundle that reads no document opens a note as one that
  has none, which record 0084 forbids.

This excludes a read of the document without the text. The text derives from
the document, but only `packages/note-document` reads a document, and the
loader and a store that failed to open would both need a new path to it for
a read that runs only before the feed reaches the note.

## Consequences

- A text read sends the text and the metadata of the head, and no document.
- `tests/integration/revisions.test.ts` proves both values, the default and
  the refusal of another value.
