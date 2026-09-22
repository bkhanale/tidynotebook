# Plan 013: Conflict-free sync of note text

Status: active

The [project board](https://github.com/users/bkhanale/projects/2) holds the live
work under [issue 152](https://github.com/bkhanale/notesapp/issues/152).
[Design 013](../design/013-conflict-free-sync-of-note-text.md) states the problem
and choices. This plan uses records 0081 to 0087; records 0076 to 0080 are
superseded. Issue 162 is the prerequisite, not the final task. The existing
issue numbers and their original item names remain stable.

## Decisions

- [0081. Accepted text and observed state belong to one document](../decisions/0081-accepted-text-and-observed-state-belong-to-one-document.md)
- [0082. Yjs has a byte API and a private editor bridge](../decisions/0082-yjs-has-a-byte-api-and-a-private-editor-bridge.md)
- [0083. Metadata conflicts preserve unseen text work](../decisions/0083-metadata-conflicts-preserve-unseen-text-work.md)
- [0084. Compaction keeps identities and recovery keeps original work](../decisions/0084-compaction-keeps-identities-and-recovery-keeps-original-work.md)
- [0085. Local document writes merge and receipts do not advance reads](../decisions/0085-local-document-writes-merge-and-receipts-do-not-advance-reads.md)
- [0086. Protocol upgrades precede the breaking sync format](../decisions/0086-protocol-upgrades-precede-the-breaking-sync-format.md)
- [0087. Review keeps the checkpoint that caused it](../decisions/0087-review-keeps-the-checkpoint-that-caused-it.md)

## Landing boundaries

1. Issue 162 records the revised decisions, then implements, releases, and
   proves compatibility support. This document completes only its decision
   work. Keep the issue open until the release and deployment evidence exist.
2. Issue 154 adds the document package. It can land alone while unused by the
   application. Its private editor bridge is part of the package contract.
3. Issues 155 through 161 share one feature branch and one landing. Keep one
   commit per coherent change. The format, storage, binding, and screen change
   together. No landing removes a store API while its old screen still uses it.
4. Each changed boundary updates its directory guide in the same commit. Update
   the sources in `rules/` and run `rules/link.sh` when a shipped rule changes.
   Current development and public guides describe the product that exists.
5. Run `pnpm verify` before each landing. Rebase onto `main`, fast-forward merge,
   and delete the branch. A release follows `releasing-a-version` separately.
   The parent issue owns final documentation review and design completion.

## Work

| Issue                                                  | Depends on    | Scope and owning paths                                                                                                                                                                                               | Records                |
| ------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| [162](https://github.com/bkhanale/notesapp/issues/162) | None          | Revised records, design, and plan; capability contract in `packages/api-contract/`; safe client upgrade in `packages/sync/` and `apps/web/src/pwa/`; server legacy response handling; release and rollback evidence. | 0081 to 0087           |
| [154](https://github.com/bkhanale/notesapp/issues/154) | 162           | `packages/note-document`: byte operations, complete observed state, validation, bounded recovery, live session and private editor bridge. Boundary checks in `tools/check-boundaries.mjs`.                           | 0081, 0082, 0084       |
| [155](https://github.com/bkhanale/notesapp/issues/155) | 154           | Save, receipt lookup, feed, snapshot, and History contracts in `packages/api-contract/`. Run `pnpm generate`; commit generated output.                                                                               | 0081, 0083 to 0086     |
| [156](https://github.com/bkhanale/notesapp/issues/156) | 154, 155      | Document port and commit rules in `packages/core/src/files/`; restore in `packages/core/src/history/`; move rewrites through `packages/storage-server/src/workspace-store/portable-links.ts`.                        | 0081, 0083, 0084       |
| [157](https://github.com/bkhanale/notesapp/issues/157) | 156           | Schema and migration in `packages/storage-server/`; document and revision writes in one accept savepoint; initialization, identity-preserving compaction, full snapshot and feed reads.                              | 0081, 0083, 0084       |
| [158](https://github.com/bkhanale/notesapp/issues/158) | 155, 156, 157 | Composition in `apps/server/src/app.ts`; every note writer and reader in `apps/server/src/routes/`; legacy detection before schema rejection and authorized receipt reconciliation.                                  | 0081, 0084, 0086       |
| [159](https://github.com/bkhanale/notesapp/issues/159) | 154 to 158    | `packages/sync/src/local-port.ts` first, then `packages/storage-browser/`; queue, receipt, feed, migration, and purge recovery. Keep obsolete APIs until their callers move.                                         | 0083 to 0086           |
| [160](https://github.com/bkhanale/notesapp/issues/160) | 154           | Binding and lifecycle in `packages/editor/src/create-editor.ts`; local undo and keys; composition buffer before the bound document; plain editors remain valid.                                                      | 0082                   |
| [161](https://github.com/bkhanale/notesapp/issues/161) | 159, 160      | `apps/web/src/features/editor/` and History use the document; pure Review rule in `apps/web/src/lib/`; remove obsolete callers; complete the shared landing.                                                         | 0081, 0082, 0085, 0087 |

Issue 160 can develop alongside the server work after issue 154. It still lands
with the complete application change. Work inside the feature branch follows the
contract, domain, storage, handler, client, and verification order.

## Required evidence

The issues hold the detailed acceptance cases and measured results. This plan
names the proof that cannot be omitted.

- Package properties use seeded concurrent edits on several replicas. Include
  deletion-only changes, duplicate delivery, reordering, Unicode, line endings,
  complete observed-state coverage, and offline updates after compaction.
- Validation tests prove that missing insertion or deletion dependencies,
  malformed bytes, unsupported roots or embeds, and resource bounds refuse the
  update without changing accepted state. Test the wrapper, not only Yjs.
- Core and real-server tests prove edit against Trash in both orders, no-op
  retries after Trash, path collisions, restore, and move rewrites with offline
  work. A failed member leaves a whole changeset unchanged.
- Browser storage tests drive separate connections before either tab reads the
  other's invalidation. Include suspended tabs, frozen checkpoints, batch
  retries, and failures before or after each durable write.
- Migration and receipt tests cover legacy drafts, queued checkpoint chains,
  pending new notes, an accepted request with a lost reply, ambiguous placement,
  interruption, and retry. No source text normalization or duplicate recovery.
- Feed and snapshot tests cover duplicate records, expired cursors, pending
  local work, a real epoch boundary, and purge while only a draft exists.
  Document bytes, metadata, and cursor always describe one committed state.
- Compatibility tests use a client from before the compatibility release, the
  compatibility client, and the new protocol. Include old reads and writes,
  no connection, waiting workers, multiple tabs, and blocked schema upgrades.
- Pure editor and Review tests cover origin, selection, local undo, checkpoint
  selection, dismissal, and a later merge. Under record 0066, drive the served
  browser for actual composition, reload, worker activation, and tab lifecycle.
  Record steps and results. Take changed-screen screenshots in light and dark.
- Measure document growth, decoded apply cost, feed and snapshot size, browser
  persistence, and time under the workspace lock. Record limits and evidence in
  the issues. Keep text out of diagnostics. Rehearse migration and rollback.

## Completion

Keep [issue 152](https://github.com/bkhanale/notesapp/issues/152) open until every
child and its acceptance evidence are complete. Check
`docs/development/local-storage.md`, `files-and-revisions.md`, and
`accepting-a-changeset.md`, the directory guides, root rules, and public sync
copy against the shipped code. Then set this plan and design 013 to complete.
A documentation-only commit neither ships the sync engine nor completes the
compatibility release.
