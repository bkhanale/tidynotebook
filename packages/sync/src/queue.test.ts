import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueueEntry } from './local-port.ts';
import { recoveredNotePath, takeBatchable } from './queue.ts';

const workspaceId = 'w0000000-0000-4000-8000-000000000001';

/** One pending save of one revision of one file. */
function save(
  revisionId: string,
  fileId: string,
  parent: string | null,
): QueueEntry {
  return {
    accountId: 'a0000000-0000-4000-8000-000000000001',
    input: {
      workspaceId,
      mutationId: `m-${revisionId}`,
      deviceId: 'device-queue',
      expectedHeads: { [fileId]: null },
      revisions: [
        {
          id: revisionId,
          fileId,
          parents: parent === null ? [] : [parent],
          path: `notes/${fileId}.md`,
          deleted: false,
          content: {
            kind: 'markdown',
            document: {
              work: { kind: 'none' },
              epoch: 1,
              observed: new Uint8Array(),
            },
          },
          clientTime: '2026-09-30T10:00:00.000Z',
          message: null,
          restoredFrom: null,
        },
      ],
    },
    state: 'pending',
    digest: null,
    errorCode: null,
  };
}

/** The revisions of one run, in order. */
function revisionsOf(batch: readonly QueueEntry[]): readonly string[] {
  return batch.flatMap((entry) =>
    entry.input.revisions.map((revision) => revision.id),
  );
}

await test('one chain of one file goes in one run', () => {
  const batch = takeBatchable([
    save('r1', 'note', 'head'),
    save('r2', 'note', 'r1'),
    save('r3', 'other', 'head-other'),
    save('r4', 'note', 'r2'),
  ]);
  assert.deepEqual(revisionsOf(batch), ['r1', 'r2', 'r3', 'r4']);
});

await test('a second chain of one file ends the run', () => {
  // Two open tabs of one note are two working copies, and each names its own
  // parent. The graph rule allows one chain per file in one changeset, so the
  // second chain waits for the next run.
  const batch = takeBatchable([
    save('a1', 'note', 'head'),
    save('b1', 'note', 'head'),
    save('a2', 'note', 'a1'),
  ]);
  assert.deepEqual(revisionsOf(batch), ['a1']);
  assert.deepEqual(revisionsOf(takeBatchable([save('b1', 'note', 'head')])), [
    'b1',
  ]);
});

await test('a save that was sent once is not combined', () => {
  const sent = { ...save('r1', 'note', 'head'), state: 'sending' as const };
  assert.deepEqual(takeBatchable([sent, save('r2', 'note', 'r1')]), []);
});

await test('a recovered note avoids every held path in any case', () => {
  // The held paths name the accepted path of a note as well as its path on
  // this device, and the workspace reads two cases of one name as one name
  // on every other surface (record 0184).
  assert.equal(
    recoveredNotePath('notes/plan.md', [
      'notes/Plan (recovered).md',
      'notes/plan (recovered 2).md',
    ]),
    'notes/plan (recovered 3).md',
  );
  assert.equal(
    recoveredNotePath('notes/plan.md', ['notes/plan.md']),
    'notes/plan (recovered).md',
  );
});
