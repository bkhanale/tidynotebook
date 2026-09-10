import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chipIsProblem,
  chipLabel,
  resolveChipState,
  resolveSaveState,
  type ChipInput,
  type NoteSaveFacts,
  type SaveState,
  type SaveStateInput,
} from './save-state.ts';

const accepted: SaveStateInput = {
  draftWritePending: false,
  queueState: null,
  storageError: null,
  hasUncheckpointedDraft: false,
  acceptedHeadRevisionId: 'revision-a',
  localHeadRevisionId: 'revision-a',
};

await test('save state follows only the current file durable lifecycle', () => {
  assert.equal(resolveSaveState(accepted), 'saved-server');
  assert.equal(
    resolveSaveState({ ...accepted, hasUncheckpointedDraft: true }),
    'saved-local',
  );
  assert.equal(
    resolveSaveState({
      ...accepted,
      acceptedHeadRevisionId: null,
      localHeadRevisionId: null,
    }),
    'saved-local',
  );
  assert.equal(
    resolveSaveState({ ...accepted, queueState: 'pending' }),
    'saved-local',
  );
  assert.equal(
    resolveSaveState({ ...accepted, queueState: 'sending' }),
    'syncing',
  );
  assert.equal(
    resolveSaveState({ ...accepted, queueState: 'conflict' }),
    'save-failed',
  );
  assert.equal(
    resolveSaveState({ ...accepted, draftWritePending: true }),
    'saving-local',
  );
  assert.equal(
    resolveSaveState({ ...accepted, storageError: 'quota' }),
    'storage-full',
  );
});

const online: ChipInput = {
  note: null,
  sync: { kind: 'in-step' },
  attentionCount: 0,
  online: true,
};

const openNote = (
  state: SaveState,
  hasUnsavedEdits = false,
): NoteSaveFacts => ({ state, hasUnsavedEdits });

await test('a parked save wins over every other chip state', () => {
  assert.deepEqual(resolveChipState({ ...online, attentionCount: 2 }), {
    kind: 'attention',
    count: 2,
  });
  assert.deepEqual(
    resolveChipState({ ...online, note: openNote('save-failed') }),
    { kind: 'attention', count: 1 },
  );
  assert.deepEqual(
    resolveChipState({ ...online, note: openNote('storage-full') }),
    { kind: 'attention', count: 1 },
  );
});

await test('a stopped or ended session asks for attention', () => {
  assert.equal(
    resolveChipState({ ...online, sync: { kind: 'signed-out' } }).kind,
    'attention',
  );
  assert.equal(
    resolveChipState({ ...online, sync: { kind: 'stopped' } }).kind,
    'attention',
  );
});

await test('the open note decides the state while everything works', () => {
  assert.deepEqual(
    resolveChipState({ ...online, note: openNote('saving-local', true) }),
    { kind: 'saving' },
  );
  assert.deepEqual(
    resolveChipState({ ...online, note: openNote('saved-local', true) }),
    { kind: 'unsaved' },
  );
  assert.deepEqual(resolveChipState({ ...online, note: openNote('syncing') }), {
    kind: 'saving',
  });
  assert.deepEqual(
    resolveChipState({ ...online, note: openNote('saved-local') }),
    { kind: 'saved-local' },
  );
  assert.deepEqual(
    resolveChipState({ ...online, note: openNote('saved-server') }),
    { kind: 'saved' },
  );
});

await test('no connection reads as offline or as saved on this device', () => {
  assert.deepEqual(resolveChipState({ ...online, online: false }), {
    kind: 'offline',
  });
  assert.deepEqual(resolveChipState({ ...online, sync: { kind: 'waiting' } }), {
    kind: 'offline',
  });
  assert.deepEqual(
    resolveChipState({
      ...online,
      online: false,
      note: openNote('saved-server'),
    }),
    { kind: 'saved-local' },
  );
});

await test('a screen without an open note reports the area', () => {
  assert.deepEqual(resolveChipState(online), { kind: 'saved' });
});

await test('every chip state has one short label', () => {
  const labels = [
    chipLabel({ kind: 'unsaved' }),
    chipLabel({ kind: 'saving' }),
    chipLabel({ kind: 'saved-local' }),
    chipLabel({ kind: 'saved' }),
    chipLabel({ kind: 'offline' }),
    chipLabel({ kind: 'attention', count: 3 }),
    chipLabel({ kind: 'attention', count: 0 }),
  ];
  assert.deepEqual(labels, [
    'Unsaved changes',
    'Saving',
    'Saved on this device',
    'Saved',
    'Offline',
    'Needs attention (3)',
    'Needs attention',
  ]);
  assert.equal(chipIsProblem({ kind: 'attention', count: 0 }), true);
  assert.equal(chipIsProblem({ kind: 'saved' }), false);
});
