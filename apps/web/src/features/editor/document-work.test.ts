import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentWorkQueue } from './document-work.ts';

await test('a keystroke schedules document work without running it', () => {
  const callbacks = new Map<number, () => void>();
  const cancelled: number[] = [];
  const runs: string[] = [];
  let nextToken = 0;
  const queue = createDocumentWorkQueue({
    delayMs: 200,
    defer: (run, delayMs) => {
      assert.equal(delayMs, 200);
      nextToken += 1;
      callbacks.set(nextToken, run);
      return nextToken;
    },
    cancel: (token) => {
      cancelled.push(token);
      callbacks.delete(token);
    },
    run: (text) => runs.push(text),
  });

  queue.schedule('first document');
  assert.deepEqual(runs, []);

  queue.schedule('newest document');
  assert.deepEqual(runs, []);
  assert.deepEqual(cancelled, [1]);

  callbacks.get(2)?.();
  assert.deepEqual(runs, ['newest document']);
});

await test('cancel stops document work that has not started', () => {
  let callback = (): void => {};
  const runs: string[] = [];
  const queue = createDocumentWorkQueue({
    delayMs: 1,
    defer: (run) => {
      callback = run;
      return 'pending';
    },
    cancel: () => {
      callback = (): void => {};
    },
    run: (text) => runs.push(text),
  });

  queue.schedule('discarded document');
  queue.cancel();
  callback();
  assert.deepEqual(runs, []);
});
