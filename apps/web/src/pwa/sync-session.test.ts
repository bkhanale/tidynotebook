import assert from 'node:assert/strict';
import test from 'node:test';
import { createSyncSession } from './sync-session.ts';

/** A promise that the test completes after it observes the stop request. */
function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let complete = (): void => {};
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: complete };
}

await test('one tab stops and awaits every registered sync run', async () => {
  const session = createSyncSession('this-tab');
  const first = deferred();
  const second = deferred();
  const stopped: string[] = [];

  session.register({
    stop: () => stopped.push('first'),
    finished: first.promise,
  });
  session.register({
    stop: () => stopped.push('second'),
    finished: second.promise,
  });

  let complete = false;
  const stopping = session.stop().then(() => {
    complete = true;
  });
  assert.deepEqual(stopped, ['first', 'second']);
  assert.equal(complete, false);

  first.resolve();
  await first.promise;
  assert.equal(complete, false);
  second.resolve();
  await stopping;
  assert.equal(complete, true);
  assert.equal(session.ownerId, 'this-tab');
});

await test('a finished run leaves the session', async () => {
  const session = createSyncSession('this-tab');
  const run = deferred();
  let stopped = false;
  session.register({
    stop: () => {
      stopped = true;
    },
    finished: run.promise,
  });
  run.resolve();
  await run.promise;
  await session.stop();
  assert.equal(stopped, false);
});
