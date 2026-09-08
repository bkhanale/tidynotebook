import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSaveState, type SaveStateInput } from './save-state.ts';

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
