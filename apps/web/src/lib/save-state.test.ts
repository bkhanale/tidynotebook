import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveSaveState,
  resolveSaveStatus,
  statusLabel,
  type SaveState,
  type SaveStateInput,
  type SaveStatus,
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

/** The save status of one open note. */
const status = (state: SaveState, hasUnsavedEdits = false): SaveStatus =>
  resolveSaveStatus({ state, hasUnsavedEdits });

await test('typed text that no version holds reads as saving', () => {
  assert.equal(status('saved-local', true), 'saving');
  assert.equal(status('saving-local', true), 'saving');
  assert.equal(status('saved-server', true), 'saving');
});

await test('a save that has not settled reads as saving', () => {
  assert.equal(status('saving-local'), 'saving');
  assert.equal(status('syncing'), 'saving');
  assert.equal(status('save-failed'), 'saving');
  assert.equal(status('storage-full'), 'saving');
});

await test('a note that holds every edit as a version reads as saved', () => {
  assert.equal(status('saved-server'), 'saved');
  assert.equal(status('saved-local'), 'saved');
});

await test('each save status has one label', () => {
  const statuses: readonly SaveStatus[] = ['saving', 'saved'];
  assert.deepEqual(
    statuses.map((one) => statusLabel(one)),
    ['Saving', 'Saved'],
  );
});
