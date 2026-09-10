/** Explicit version creation rules. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { saveCheckpointMessage, shouldCheckpoint } from './checkpoints.ts';

const unchanged = { digest: 'a1', path: 'notes/one.md', deleted: false };

await test('an explicit named save always creates a version', () => {
  assert.equal(shouldCheckpoint(unchanged, unchanged, 'Before the cut'), true);
});

await test('an unnamed unchanged operation creates no version', () => {
  assert.equal(shouldCheckpoint(unchanged, unchanged, null), false);
});

await test('the Save action names no version, so an unchanged Save writes none', () => {
  assert.equal(saveCheckpointMessage, null);
  assert.equal(
    shouldCheckpoint(unchanged, unchanged, saveCheckpointMessage),
    false,
  );
  assert.equal(
    shouldCheckpoint(
      unchanged,
      { ...unchanged, digest: 'b2' },
      saveCheckpointMessage,
    ),
    true,
  );
});

await test('an unnamed changed operation creates a version', () => {
  assert.equal(
    shouldCheckpoint(unchanged, { ...unchanged, digest: 'b2' }, null),
    true,
  );
});

await test('the first operation creates a version', () => {
  assert.equal(shouldCheckpoint(null, unchanged, null), true);
});
