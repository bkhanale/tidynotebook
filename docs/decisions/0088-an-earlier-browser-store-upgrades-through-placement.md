# 0088. An earlier browser store upgrades through placement

- Status: Accepted
- Date: 2026-09-23

## Context

Release 0.5.0 added browser schema version 5 and no record step from version
4, so every browser that ran 0.4 refused its store. A queued save of 0.4 holds
text, and a save of 0.5 holds work on the document of the note (0081). Text
becomes work only against the document that the server holds, and the device
does not hold that document until a snapshot arrives. Record 0084 states the
rules: no device starts an existing note from Markdown, uncertain work is
resolved by receipt first, and work that cannot be placed is kept.

## Decision

- Schema version 6 adds the tables `legacySaves`, `legacyBases` and
  `legacyDrafts` in `packages/storage-browser/src/database.ts`. The step from
  4 to 5 removes every cursor and staged snapshot, so the next pull is a full
  snapshot that carries every document. The step from 5 to 6 moves each queued
  save that holds text out of the queue, keeps the text of each server revision
  that such a save or a draft starts from, and marks every draft of the store.
- Before the engine sends anything in a workspace, it resolves each moved save
  that 0.4 already sent through `getMutationReceipt`. An accepted save settles
  without a second send. An absent save becomes unsent work.
- The store places the moved work of a note when it holds the document of the
  note: `recoverLegacyText` joins the base text, the moved text and the
  accepted text, and the result becomes work on the document under the same
  mutation identity. A moved draft becomes the joined text. Nothing in the
  workspace is sent while moved work waits, so the order of saves holds.
- Work that `recoverLegacyText` cannot place, and work for a note whose
  document the snapshot does not carry, goes to the recovery area with one
  record for each note. Needs attention offers to keep it as a new note. This
  refines the recovery note of 0084: the record is written in the same
  transaction that removes the moved save, so a retry makes no copy.
- The store refuses a save, a move and a Trash of an existing note while it
  does not hold the document of that note. The note loader then opens the note
  from the server read, which stores the document.

## Consequences

- An upgraded browser opens its store and loses no save and no draft.
- A second release that changes the save shape needs its own placement rule.
- `tests/integration/browser-storage.test.ts` opens a real version 4 store.
  `tests/integration/sync.test.ts` proves placement, receipts and recovery
  against a real server. `packages/storage-browser/src/migrations.test.ts`
  refuses a schema version that has no step to the next one.
