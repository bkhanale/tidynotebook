/**
 * What an open note does when the head of its file moved (record 0179).
 *
 * The rule may adopt a new head only when nothing of this device is at stake,
 * so each test below takes one fact away and proves that the answer turns to
 * keeping the base.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FileSaveSnapshot } from '@notesapp/sync';
import {
  headToAdopt,
  openedGeneration,
  remoteChangeWritesDraft,
  storedDocumentStep,
  type OpenNote,
} from './head-replaced.ts';

/** A file whose accepted head moved past the revision the editor opened. */
function snapshotOf(extra: Partial<FileSaveSnapshot> = {}): FileSaveSnapshot {
  return {
    fileId: 'file-1',
    path: 'notes/one.md',
    deleted: false,
    latestDraftSequence: null,
    latestMutationId: null,
    queueState: null,
    acceptedHeadRevisionId: 'rev-2',
    localHeadRevisionId: 'rev-2',
    hasUncheckpointedDraft: false,
    ...extra,
  };
}

/** An editor that opened `rev-1` and took no key since. */
function openOf(extra: Partial<OpenNote> = {}): OpenNote {
  return {
    snapshot: snapshotOf(),
    base: 'rev-1',
    openedSequence: 3,
    currentSequence: 3,
    ...extra,
  };
}

await test('an idle editor takes the new head as its base', () => {
  assert.equal(headToAdopt(openOf()), 'rev-2');
});

await test('a working copy of this device keeps the base', () => {
  assert.equal(
    headToAdopt(openOf({ snapshot: snapshotOf({ latestDraftSequence: 4 }) })),
    null,
  );
});

await test('a queued save keeps the base', () => {
  assert.equal(
    headToAdopt(openOf({ snapshot: snapshotOf({ queueState: 'pending' }) })),
    null,
  );
  assert.equal(
    headToAdopt(
      openOf({ snapshot: snapshotOf({ localHeadRevisionId: 'rev-local' }) }),
    ),
    null,
  );
});

await test('a key of this session keeps the base', () => {
  assert.equal(headToAdopt(openOf({ currentSequence: 4 })), null);
});

await test('a head that is the base already changes nothing', () => {
  assert.equal(headToAdopt(openOf({ base: 'rev-2' })), null);
});

await test('a note in Trash or one the server never held changes nothing', () => {
  assert.equal(
    headToAdopt(openOf({ snapshot: snapshotOf({ deleted: true }) })),
    null,
  );
  assert.equal(
    headToAdopt(
      openOf({
        snapshot: snapshotOf({
          acceptedHeadRevisionId: null,
          localHeadRevisionId: null,
        }),
      }),
    ),
    null,
  );
});

await test('a document of the same generation joins the one editor', () => {
  // Record 0179. A version of another device, a restore from History and a
  // restore from Trash are work of the same generation. The screen mounted
  // a new editor for them and the person lost the caret and the scroll.
  assert.equal(
    storedDocumentStep({ openedEpoch: 1, storedEpoch: 1, typed: false }),
    'join',
  );
});

await test('the editor holds the generation that the loader read', () => {
  // Record 0181. The editor took its generation from its first read of the
  // store, and not from the read that the loader opened it from. A new
  // generation that arrived between the two joined the bytes of one
  // generation into another, and the text showed twice.
  const loaded = { bytes: new Uint8Array([1]), epoch: 1 };
  assert.equal(openedGeneration(loaded), 1);
  assert.equal(
    storedDocumentStep({
      openedEpoch: openedGeneration(loaded),
      storedEpoch: 2,
      typed: false,
    }),
    'reopen',
  );
  assert.equal(openedGeneration({ ...loaded, epoch: 4 }), 4);
  // A note that this device starts is generation 1, as the store writes it.
  assert.equal(openedGeneration(null), 1);
});

await test('a new generation reads the note again, unless keys wait in it', () => {
  assert.equal(
    storedDocumentStep({ openedEpoch: 1, storedEpoch: 2, typed: false }),
    'reopen',
  );
  assert.equal(
    storedDocumentStep({ openedEpoch: 1, storedEpoch: 2, typed: true }),
    'keep',
  );
});

await test('only an editor with a draft writes one for remote work', () => {
  assert.equal(remoteChangeWritesDraft(0), false);
  assert.equal(remoteChangeWritesDraft(2), true);
});
