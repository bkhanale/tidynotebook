import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSaveState, type SaveStateInput } from './save-state.ts';

const accepted: SaveStateInput = {
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
    resolveSaveState({ ...accepted, storageError: 'quota' }),
    'storage-full',
  );
});

await test('a key changes no durable fact, so the state stays', () => {
  // Record 0175. The state read a write that runs, which a key started, so
  // the root of the note changed at the first key of each burst.
  const typing = { ...accepted, hasUncheckpointedDraft: true };
  assert.equal(resolveSaveState(typing), resolveSaveState({ ...typing }));
  assert.ok(!('draftWritePending' in typing));
});
