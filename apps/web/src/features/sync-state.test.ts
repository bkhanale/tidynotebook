import assert from 'node:assert/strict';
import test from 'node:test';
import type { SyncNotice } from '@notesapp/sync';
import {
  syncNeedsAttention,
  syncStateFileId,
  syncStateMessage,
  syncStateOfNotice,
  type SyncState,
} from './sync-state.ts';

const notices: readonly SyncNotice[] = [
  { kind: 'pushed', mutationIds: ['m1'], fileIds: ['f1'] },
  {
    kind: 'preserved',
    mutationId: 'm2',
    code: 'path_conflict',
    fileIds: ['f2'],
  },
  { kind: 'superseded', fileId: 'f3', path: 'plans/roadmap.md' },
  { kind: 'delete-refused', fileId: 'f4', path: 'plans/old.md' },
  { kind: 'retry', attempt: 2, delayMs: 7000 },
  { kind: 'snapshot-restart', reason: 'cursor' },
  { kind: 'snapshot-activated', count: 12 },
  { kind: 'changes-applied', count: 3 },
  { kind: 'paused', reason: 'session' },
  { kind: 'access-lost' },
  { kind: 'lease-held' },
  { kind: 'lease-lost' },
  { kind: 'cycle-error', code: 'network' },
];

await test('every engine notice maps to a typed state or to nothing', () => {
  for (const notice of notices) {
    const state = syncStateOfNotice(notice);
    if (notice.kind === 'snapshot-restart') {
      assert.equal(state, null);
      continue;
    }
    assert.notEqual(state, null);
  }
});

await test('a refused save names the file it kept', () => {
  const state = syncStateOfNotice({
    kind: 'preserved',
    mutationId: 'm2',
    code: 'path_conflict',
    fileIds: ['f2'],
  });
  assert.deepEqual(state, { kind: 'attention', fileId: 'f2' });
  assert.equal(syncStateFileId(state ?? { kind: 'starting' }), 'f2');
});

const states: readonly SyncState[] = [
  { kind: 'starting' },
  { kind: 'in-step' },
  { kind: 'sending' },
  { kind: 'waiting' },
  { kind: 'attention', fileId: 'f2' },
  { kind: 'superseded', path: 'plans/roadmap.md' },
  { kind: 'delete-refused', path: 'plans/old.md' },
  { kind: 'signed-out' },
  { kind: 'other-tab' },
  { kind: 'stopped' },
];

await test('every state has one sentence with no code and no identifier', () => {
  for (const state of states) {
    const message = syncStateMessage(state, 'roadmap');
    assert.ok(message.length > 0, state.kind);
    assert.ok(message.endsWith('.'), state.kind);
    assert.ok(!message.includes('_'), state.kind);
    assert.ok(!message.includes('.md'), state.kind);
    assert.ok(!/\bf\d\b/.test(message), state.kind);
  }
});

await test('a state without a known note still reads as a sentence', () => {
  assert.ok(
    syncStateMessage({ kind: 'attention', fileId: undefined }).startsWith(
      'A note',
    ),
  );
});

await test('only the states that need an answer ask for one', () => {
  assert.equal(syncNeedsAttention({ kind: 'in-step' }), false);
  assert.equal(syncNeedsAttention({ kind: 'waiting' }), false);
  assert.equal(syncNeedsAttention({ kind: 'other-tab' }), false);
  assert.equal(syncNeedsAttention({ kind: 'attention', fileId: 'f' }), true);
  assert.equal(syncNeedsAttention({ kind: 'signed-out' }), true);
  assert.equal(syncNeedsAttention({ kind: 'stopped' }), true);
});
