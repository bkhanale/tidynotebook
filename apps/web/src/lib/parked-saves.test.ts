import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecoveryRecord } from '@notesapp/sync';
import {
  parkedSaveReason,
  parkedSaveTime,
  parkedSaves,
  recoveredNoteName,
} from './parked-saves.ts';

/** One stored recovery record with the fields a test varies. */
function recordOf(extra: Partial<RecoveryRecord> = {}): RecoveryRecord {
  return {
    serverOrigin: 'https://notes.example.test',
    accountId: 'account-1',
    workspaceId: 'workspace-1',
    recoveryId: 'recovery-1',
    fileId: 'file-1',
    path: 'projects/roadmap.md',
    text: 'kept text',
    reason: 'save_refused',
    code: 'path_conflict',
    mutationId: 'mutation-1',
    createdAt: '2026-09-10T10:00:00.000Z',
    ...extra,
  };
}

await test('a known refusal code reads as one sentence', () => {
  assert.equal(
    parkedSaveReason('save_refused', 'path_conflict'),
    'Another note already uses that name.',
  );
  assert.equal(
    parkedSaveReason('save_refused', 'stale_head'),
    'The note changed on the server after this save was made.',
  );
  assert.equal(
    parkedSaveReason('save_refused', 'deleted_remotely'),
    'The note was deleted on the server.',
  );
  // Work of release 0.4 that the upgrade could not place (record 0088).
  assert.equal(
    parkedSaveReason('save_refused', 'unplaced_work'),
    'An earlier version of the app kept this text. The note changed after that, so the text does not fit it.',
  );
});

await test('an unknown refusal code still reads as a sentence', () => {
  assert.equal(
    parkedSaveReason('save_refused', 'a_code_from_a_newer_server'),
    'The server refused this save.',
  );
  assert.equal(
    parkedSaveReason('save_refused', null),
    'The server refused this save.',
  );
});

await test('every other recovery reason has its own sentence', () => {
  assert.equal(
    parkedSaveReason('sign_out', null),
    'You signed out while this save waited.',
  );
  // A code never changes the sentence of a reason that is not a refusal.
  assert.equal(
    parkedSaveReason('purged', 'path_conflict'),
    'The note was permanently deleted.',
  );
});

await test('a list row names the note without a suffix or an identifier', () => {
  const rows = parkedSaves([recordOf()]);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row !== undefined);
  assert.equal(row.name, 'projects/roadmap');
  assert.equal(row.reason, 'Another note already uses that name.');
  assert.equal(row.text, 'kept text');
  assert.equal(row.mutationId, 'mutation-1');
  assert.ok(!row.name.includes('.md'));
});

await test('the list shows the newest parked save first', () => {
  const rows = parkedSaves([
    recordOf({ recoveryId: 'older', createdAt: '2026-09-10T09:00:00.000Z' }),
    recordOf({ recoveryId: 'newer', createdAt: '2026-09-10T11:00:00.000Z' }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.recoveryId),
    ['newer', 'older'],
  );
});

await test('a parked save time reads in words', () => {
  const now = new Date('2026-09-10T12:00:00.000Z');
  assert.equal(
    parkedSaveTime('2026-09-10T11:59:30.000Z', now),
    'less than a minute ago',
  );
  assert.equal(parkedSaveTime('2026-09-10T11:59:00.000Z', now), '1 minute ago');
  assert.equal(
    parkedSaveTime('2026-09-10T11:30:00.000Z', now),
    '30 minutes ago',
  );
  assert.equal(parkedSaveTime('2026-09-10T09:00:00.000Z', now), '3 hours ago');
  assert.equal(parkedSaveTime('2026-09-08T12:00:00.000Z', now), '2 days ago');
  assert.equal(
    parkedSaveTime('2026-01-08T12:00:00.000Z', now),
    'more than a month ago',
  );
  assert.equal(parkedSaveTime('not a time', now), 'at an unknown time');
});

await test('a recovered copy never writes over an earlier one', () => {
  assert.equal(recoveredNoteName('roadmap', []), 'roadmap (recovered)');
  assert.equal(
    recoveredNoteName('roadmap', ['roadmap (recovered).md']),
    'roadmap (recovered) 2',
  );
  assert.equal(
    recoveredNoteName('roadmap', [
      'Roadmap (recovered).md',
      'roadmap (recovered) 2.md',
    ]),
    'roadmap (recovered) 3',
  );
});

await test('an over the limit rename names its own cause', () => {
  // The defect this covers: a move that rewrote more files than one
  // changeset holds was refused with the invalid graph code, whose sentence
  // names the history of the note. After a rename the cause is the number of
  // notes, so the person read the wrong cause and no action that helps.
  const sentence = parkedSaveReason('save_refused', 'too_many_files');
  assert.match(sentence, /too many notes/);
  assert.notEqual(sentence, parkedSaveReason('save_refused', 'invalid_graph'));
});

await test('a save of a note over a limit of the grammar names the cause and the action', () => {
  // Record 0186. A note over a limit of the grammar is refused with its own
  // problem code, and the list read the general sentence, so the person did
  // not learn what to change.
  const sentence = parkedSaveReason('save_refused', 'unrenderable_note');
  assert.notEqual(sentence, parkedSaveReason('save_refused', null));
  assert.match(sentence, /Divide a long paragraph or table/);
});
