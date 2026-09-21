# Plan 013: Conflict-free sync of note text

Status: active

> The live items are [GitHub issues 154 to 162](https://github.com/bkhanale/notesapp/issues?q=is%3Aissue+%22Sync+013%22) on the [project board](https://github.com/users/bkhanale/projects/2), item 1 to item 9 in order, each a sub-issue of issue 152 with its blocking items linked. Issue 152 stays open until item 9 lands.

This plan turns [design 013](../design/013-conflict-free-sync-of-note-text.md)
and decision records 0076 to 0080 into ordered work. Items 1, 7 and 9 each land
alone. Items 2 to 6 are one landing on one branch, one commit for each item,
because the contract, the server and the client change format together and
`main` never holds one half. `pnpm verify` passes before each landing.

## Decisions

- [0076. The text of a note is a CRDT document inside its revisions](../decisions/0076-the-text-of-a-note-is-a-crdt-document.md)
- [0077. Yjs behind one package](../decisions/0077-yjs-behind-one-package.md)
- [0078. One rule for each conflict that is not text](../decisions/0078-one-rule-for-each-conflict-that-is-not-text.md)
- [0079. Review is the one surface of a merge](../decisions/0079-review-is-the-one-surface-of-a-merge.md)
- [0080. A document starts once and an epoch carries work across a new start](../decisions/0080-a-document-starts-once.md)

## Items

1. The package. Add `packages/note-document` with its `AGENTS.md`, Yjs as its
   one dependency, the pure functions and the bounds of record 0077, and the
   boundary rule in `tools/check-boundaries.mjs`. Add the property test of
   convergence and the replay tests of record 0080, including two insertions at
   one place, a deletion against an edit, and line endings (0077, 0080).
2. The contract. Change the note revision of the changeset, the accepted answer,
   the feed item and the snapshot item in `packages/api-contract/` to carry the
   update, the state vector, the epoch and the merged mark of record 0076. Add
   the refusal codes for an old form and an old epoch. Run `pnpm generate`
   (0076, 0080).
3. The domain rule. Add the document port to
   `packages/core/src/files/ports.ts`. Change `commitChangeset` and
   `rebaseHeads` in `packages/core/src/files/commit.ts`: apply the update,
   check the text, never rebase text, keep the path and deletion rules of
   record 0078, and turn a restore in `src/history/service.ts` into an edit.
   Unit tests with an in-memory port prove each rule and each refusal
   (0076, 0078).
4. The server storage. Add the document table and the update of each revision
   in `packages/storage-server/src/schema.ts` with a migration and a raised
   `requiredSchemaVersion`. Implement the port, the compaction and the epoch.
   Write the data migration that starts the document of every existing note,
   beside `portable-markdown-migration.ts` (0076, 0080).
5. The server handlers. Wire `packages/note-document` into the port in
   `apps/server/src/app.ts`, and update the changeset, feed, snapshot, import
   and restore handlers under `apps/server/src/routes/`. Extend
   `tests/integration/contract.test.ts` (0076).
6. The browser store and the engine. Add the document rows to
   `packages/sync/src/local-port.ts`, then to
   `packages/storage-browser/src/database.ts` with a schema version, the record
   upgrade that turns drafts and queued versions into unsent work, and the
   area module in `src/local-store/`. Change `packages/sync/src/queue.ts` and
   `snapshot.ts` for the update, the epoch, the replay, the digest check and
   the notices of record 0078. Prove it in
   `tests/integration/browser-storage.test.ts` and in
   `tests/integration/sync.test.ts` with two devices, for every case of the
   design. This item closes the landing of items 2 to 6 (0076, 0078, 0080).
7. The editor binding. Join the document to the one CodeMirror view in
   `packages/editor/src/create-editor.ts` with the Yjs binding and undo
   manager, keep `src/keymaps.ts`, and hold remote updates during a
   composition. Headless tests prove the selection and the local undo (0077).
8. The note screen. Rework `apps/web/src/features/editor/note-editor.tsx` and
   `note-loader.tsx` onto the document, remove `head-replaced.ts` and the stale
   draft paths that record 0076 makes dead, and add the Review line and its
   comparison with the rule in `apps/web/src/lib/`. Screenshots in light and in
   dark (0079).
9. The documents and the rules. Update `docs/development/local-storage.md`,
   `files-and-revisions.md` and `accepting-a-changeset.md`, the `AGENTS.md` of
   every package that changed, and the rules in `rules/` about drafts and
   versions, then run `rules/link.sh`. Set this plan and design 013 to
   complete, and close issue 152 (0076 to 0080).
