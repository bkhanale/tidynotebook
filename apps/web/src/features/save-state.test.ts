import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buttonEnabled,
  buttonLabel,
  resolveSaveButton,
  resolveSaveState,
  type SaveButtonState,
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

/** The button state of one open note. */
const button = (state: SaveState, hasUnsavedEdits = false): SaveButtonState =>
  resolveSaveButton({ state, hasUnsavedEdits });

await test('typed text that no version holds keeps the action offered', () => {
  assert.equal(button('saved-local', true), 'save');
  assert.equal(button('saving-local', true), 'save');
  assert.equal(button('saved-server', true), 'save');
});

await test('a run of the save reports itself', () => {
  assert.equal(button('saving-local'), 'saving');
  assert.equal(button('syncing'), 'saving');
});

await test('the button states the result of the last save', () => {
  assert.equal(button('saved-server'), 'saved');
  assert.equal(button('saved-local'), 'saved-local');
});

await test('a failed save leaves the button ready for another try', () => {
  assert.equal(button('save-failed'), 'save');
  assert.equal(button('storage-full'), 'save');
  assert.equal(button('save-failed', true), 'save');
});

await test('every button state has one label and one enabled rule', () => {
  const states: readonly SaveButtonState[] = [
    'save',
    'saving',
    'saved-local',
    'saved',
  ];
  assert.deepEqual(
    states.map((state) => buttonLabel(state)),
    ['Save', 'Saving', 'Saved on this device', 'Saved'],
  );
  assert.deepEqual(
    states.map((state) => buttonEnabled(state)),
    [true, false, false, false],
  );
});
