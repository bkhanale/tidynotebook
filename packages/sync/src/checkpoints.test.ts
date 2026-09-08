/** Explicit version creation rules. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldCheckpoint } from './checkpoints.ts';

const unchanged = { digest: 'a1', path: 'notes/one.md', deleted: false };

await test('an explicit named save always creates a version', () => {
  assert.equal(shouldCheckpoint(unchanged, unchanged, 'Manual save'), true);
});

await test('an unnamed unchanged operation creates no version', () => {
  assert.equal(shouldCheckpoint(unchanged, unchanged, null), false);
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
