import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoalescedRead } from './coalesced-read.ts';

/** A read whose runs the test ends one by one. */
function controlledRead(): {
  readonly runs: number;
  readonly finish: () => Promise<void>;
  readonly run: () => Promise<void>;
} {
  const pending: (() => void)[] = [];
  let runs = 0;
  return {
    get runs() {
      return runs;
    },
    run: () => {
      runs += 1;
      return new Promise<void>((resolve) => {
        pending.push(resolve);
      });
    },
    finish: async () => {
      pending.shift()?.();
      // The run settles, then the follow-up starts in a later turn.
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

await test('a burst of asks costs one read and one more after it', async () => {
  const read = controlledRead();
  const coalesced = createCoalescedRead(read.run);
  for (let ask = 0; ask < 1000; ask += 1) coalesced.ask();
  assert.equal(read.runs, 1);
  await read.finish();
  assert.equal(read.runs, 2);
  await read.finish();
  assert.equal(read.runs, 2);
});

await test('an ask after a read ends runs at once', async () => {
  const read = controlledRead();
  const coalesced = createCoalescedRead(read.run);
  coalesced.ask();
  await read.finish();
  coalesced.ask();
  assert.equal(read.runs, 2);
});

await test('a failed read lets the next ask run', async () => {
  let runs = 0;
  const coalesced = createCoalescedRead(() => {
    runs += 1;
    return Promise.reject(new Error('the store refused the read'));
  });
  coalesced.ask();
  await new Promise((resolve) => setImmediate(resolve));
  coalesced.ask();
  assert.equal(runs, 2);
});

await test('a stopped read starts no later run', async () => {
  const read = controlledRead();
  const coalesced = createCoalescedRead(read.run);
  coalesced.ask();
  coalesced.ask();
  coalesced.stop();
  await read.finish();
  coalesced.ask();
  assert.equal(read.runs, 1);
});
