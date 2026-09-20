/**
 * When an open note reads itself again.
 *
 * The rule may answer yes only when nothing of this device is at stake, so
 * each test below takes one fact away and proves that the answer turns to no.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FileSaveSnapshot } from '@notesapp/sync';
import { noteHeadWasReplaced, type OpenNote } from './head-replaced.ts';

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

/** An editor that opened `rev-1` and took no keystroke since. */
function openOf(extra: Partial<OpenNote> = {}): OpenNote {
  return {
    snapshot: snapshotOf(),
    openedBase: 'rev-1',
    openedSequence: 3,
    currentSequence: 3,
    ...extra,
  };
}

await test('an idle editor whose note was replaced reads it again', () => {
  assert.equal(noteHeadWasReplaced(openOf()), true);
});

await test('the note on the screen is the note of the store', () => {
  assert.equal(
    noteHeadWasReplaced(openOf({ openedBase: 'rev-2' })),
    false,
    'the accepted head is the revision this editor opened',
  );
});

await test('a keystroke of this session keeps the buffer', () => {
  assert.equal(noteHeadWasReplaced(openOf({ currentSequence: 4 })), false);
});

await test('a stored working copy keeps the buffer', () => {
  assert.equal(
    noteHeadWasReplaced(
      openOf({ snapshot: snapshotOf({ latestDraftSequence: 7 }) }),
    ),
    false,
  );
});

await test('a save that waits to be sent keeps the buffer', () => {
  assert.equal(
    noteHeadWasReplaced(
      openOf({
        snapshot: snapshotOf({
          queueState: 'pending',
          latestMutationId: 'mutation-1',
        }),
      }),
    ),
    false,
  );
});

await test('a local head ahead of the accepted head keeps the buffer', () => {
  assert.equal(
    noteHeadWasReplaced(
      openOf({ snapshot: snapshotOf({ localHeadRevisionId: 'rev-3' }) }),
    ),
    false,
  );
});

await test('a note the server never accepted keeps the buffer', () => {
  assert.equal(
    noteHeadWasReplaced(
      openOf({
        openedBase: null,
        snapshot: snapshotOf({
          acceptedHeadRevisionId: null,
          localHeadRevisionId: null,
        }),
      }),
    ),
    false,
  );
});

await test('a note in Trash is answered by the deleted state alone', () => {
  assert.equal(
    noteHeadWasReplaced(openOf({ snapshot: snapshotOf({ deleted: true }) })),
    false,
  );
});
