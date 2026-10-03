import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChangesetInput, RevisionInput } from '@notesapp/core';
import type { QueueEntry } from './local-port.ts';
import { supersededSaves, type ObservedCovers } from './parked.ts';

const workspaceId = 'w0000000-0000-4000-8000-000000000001';

/**
 * A stand-in for the coverage of the document package: a state is a list of
 * items, and a later state covers an earlier one that names no other item.
 */
const covers: ObservedCovers = (later, earlier) =>
  later.epoch === earlier.epoch &&
  [...earlier.state].every((item) => later.state.includes(item));

/** One revision of one note with the observed items it names. */
function revision(
  fileId: string,
  items: readonly number[],
  options: {
    readonly epoch?: number;
    readonly deleted?: boolean;
    readonly work?: 'update' | 'none';
  } = {},
): RevisionInput {
  return {
    id: `r-${fileId}-${items.join('')}`,
    fileId,
    parents: [],
    path: `${fileId}.md`,
    deleted: options.deleted ?? false,
    content: {
      kind: 'markdown',
      document: {
        work:
          (options.work ?? 'update') === 'update'
            ? { kind: 'update', update: new Uint8Array([1]) }
            : { kind: 'none' },
        epoch: options.epoch ?? 1,
        observed: new Uint8Array(items),
      },
    },
    clientTime: '2026-10-03T10:00:00.000Z',
    message: null,
    restoredFrom: null,
  };
}

/** One changeset of the named revisions. */
function changeset(
  mutationId: string,
  revisions: readonly RevisionInput[],
): ChangesetInput {
  return {
    workspaceId,
    mutationId,
    deviceId: 'device-parked',
    expectedHeads: {},
    revisions,
  };
}

/** One queue entry in one state. */
function entry(
  input: ChangesetInput,
  state: QueueEntry['state'] = 'conflict',
): QueueEntry {
  return {
    accountId: 'a0000000-0000-4000-8000-000000000001',
    input,
    state,
    digest: null,
    errorCode: state === 'conflict' ? 'unrenderable_note' : null,
  };
}

await test('a later save of a note supersedes a parked save that it covers', () => {
  const parked = entry(changeset('parked', [revision('note', [1, 2])]));
  const later = changeset('later', [revision('note', [1, 2, 3])]);
  assert.deepEqual(supersededSaves(later, [parked], covers), ['parked']);
});

await test('a parked save keeps work that the later save did not see', () => {
  // The later save lacks item 2, for example because the document of the
  // note changed under it, so the parked text stays for review.
  const parked = entry(changeset('parked', [revision('note', [1, 2])]));
  const later = changeset('later', [revision('note', [1, 3])]);
  assert.deepEqual(supersededSaves(later, [parked], covers), []);
});

await test('another generation, another note and a waiting save stay', () => {
  const otherGeneration = entry(
    changeset('generation', [revision('note', [1], { epoch: 2 })]),
  );
  const otherNote = entry(changeset('other', [revision('other', [1])]));
  const waiting = entry(
    changeset('waiting', [revision('note', [1])]),
    'pending',
  );
  const later = changeset('later', [revision('note', [1, 2])]);
  assert.deepEqual(
    supersededSaves(later, [otherGeneration, otherNote, waiting], covers),
    [],
  );
});

await test('a deletion is never superseded and never supersedes', () => {
  const deletion = entry(
    changeset('deletion', [
      revision('note', [1], { deleted: true, work: 'none' }),
    ]),
  );
  const later = changeset('later', [revision('note', [1, 2])]);
  assert.deepEqual(supersededSaves(later, [deletion], covers), []);
  const parked = entry(changeset('parked', [revision('note', [1])]));
  const laterDeletion = changeset('later-deletion', [
    revision('note', [1, 2], { deleted: true, work: 'none' }),
  ]);
  assert.deepEqual(supersededSaves(laterDeletion, [parked], covers), []);
});

await test('a parked save of two notes needs both covered', () => {
  const parked = entry(
    changeset('moved', [revision('one', [1]), revision('two', [5])]),
  );
  const onlyOne = changeset('later', [revision('one', [1, 2])]);
  assert.deepEqual(supersededSaves(onlyOne, [parked], covers), []);
  const both = changeset('later', [
    revision('one', [1, 2]),
    revision('two', [5, 6]),
  ]);
  assert.deepEqual(supersededSaves(both, [parked], covers), ['moved']);
});

await test('the last revision of a note in the later save decides', () => {
  const parked = entry(changeset('parked', [revision('note', [1, 2])]));
  const later = changeset('later', [
    revision('note', [1]),
    revision('note', [1, 2, 3]),
  ]);
  assert.deepEqual(supersededSaves(later, [parked], covers), ['parked']);
});
