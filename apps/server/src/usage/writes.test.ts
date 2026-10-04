import assert from 'node:assert/strict';
import test from 'node:test';
import { closeWithLastWrite } from './writes.ts';

await test('the last write runs after the close and before the store closes', async () => {
  const steps: string[] = [];
  await closeWithLastWrite(
    () => {
      steps.push('close');
      return Promise.resolve();
    },
    {
      stop: () => {
        steps.push('write');
        return Promise.resolve();
      },
    },
    () => {
      steps.push('after');
      return Promise.resolve();
    },
  );
  assert.deepEqual(steps, ['close', 'write', 'after']);
});

await test('a close step that fails still writes the last sums', async () => {
  // Review of PR 290. A failed close step skipped the last write, so the
  // counts of the last interval of the process were lost.
  const steps: string[] = [];
  await assert.rejects(
    closeWithLastWrite(
      () => Promise.reject(new Error('the pool did not end')),
      {
        stop: () => {
          steps.push('write');
          return Promise.resolve();
        },
      },
      () => {
        steps.push('after');
        return Promise.resolve();
      },
    ),
    /the pool did not end/,
  );
  assert.deepEqual(steps, ['write', 'after']);
});
