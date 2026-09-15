import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { watchBodyIdle, type IdleTimers } from './body-idle-timeout.ts';

/** A clock that a test moves by hand, so no test waits for real time. */
type ManualTimers = IdleTimers & {
  /** Runs the armed timer, if one is armed. */
  readonly fire: () => void;
  /** How many timers were armed since the start. */
  readonly armed: () => number;
  /** Whether one timer is armed now. */
  readonly pending: () => boolean;
};

function manualTimers(): ManualTimers {
  let run: (() => void) | null = null;
  let count = 0;
  return {
    start: (_milliseconds, action) => {
      count += 1;
      run = action;
      return (): void => {
        run = null;
      };
    },
    fire: (): void => {
      const action = run;
      run = null;
      action?.();
    },
    armed: (): number => count,
    pending: (): boolean => run !== null,
  };
}

/** Lets the stream deliver the events that a write or an end produced. */
function settled(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

await test('a gap with no chunk reports the idle bound one time', async () => {
  const timers = manualTimers();
  const body = new PassThrough();
  let reported = 0;
  watchBodyIdle({
    body,
    idleMs: 1000,
    onIdle: () => {
      reported += 1;
    },
    timers,
  });
  assert.equal(timers.pending(), true);
  timers.fire();
  assert.equal(reported, 1);
  // Nothing rearms after the report, so one slow body reports one time.
  assert.equal(timers.pending(), false);
  body.write('late');
  await settled();
  assert.equal(timers.pending(), false);
  assert.equal(reported, 1);
});

await test('every chunk rearms the bound', async () => {
  const timers = manualTimers();
  const body = new PassThrough();
  let reported = 0;
  watchBodyIdle({
    body,
    idleMs: 1000,
    onIdle: () => {
      reported += 1;
    },
    timers,
  });
  body.write('one');
  await settled();
  body.write('two');
  await settled();
  body.write('three');
  await settled();
  assert.equal(timers.armed(), 4);
  assert.equal(reported, 0);
  timers.fire();
  assert.equal(reported, 1);
});

await test('a body that ends reports nothing', async () => {
  const timers = manualTimers();
  const body = new PassThrough();
  let reported = 0;
  watchBodyIdle({
    body,
    idleMs: 1000,
    onIdle: () => {
      reported += 1;
    },
    timers,
  });
  body.end('all of it');
  await settled();
  assert.equal(timers.pending(), false);
  assert.equal(reported, 0);
});

await test('a body that fails reports nothing', async () => {
  const timers = manualTimers();
  const body = new PassThrough();
  body.on('error', () => {});
  let reported = 0;
  watchBodyIdle({
    body,
    idleMs: 1000,
    onIdle: () => {
      reported += 1;
    },
    timers,
  });
  body.destroy(new Error('the connection dropped'));
  await settled();
  assert.equal(timers.pending(), false);
  assert.equal(reported, 0);
});

await test('stop disarms the bound and leaves no listener behind', () => {
  const timers = manualTimers();
  const body = new PassThrough();
  let reported = 0;
  const watch = watchBodyIdle({
    body,
    idleMs: 1000,
    onIdle: () => {
      reported += 1;
    },
    timers,
  });
  watch.stop();
  watch.stop();
  assert.equal(timers.pending(), false);
  assert.equal(body.listenerCount('data'), 0);
  assert.equal(body.listenerCount('end'), 0);
  assert.equal(body.listenerCount('close'), 0);
  assert.equal(reported, 0);
});

await test('the clock of the process reports a body that stopped', async () => {
  const body = new PassThrough();
  const reported = await new Promise<boolean>((resolve) => {
    // The watch timer holds nothing open, so this referenced guard keeps the
    // loop alive. It also answers false when the watch never reports, rather
    // than leaving the test to hang.
    const guard = setTimeout(() => {
      resolve(false);
    }, 5000);
    watchBodyIdle({
      body,
      idleMs: 1,
      onIdle: () => {
        clearTimeout(guard);
        resolve(true);
      },
    });
  });
  assert.equal(reported, true);
});
