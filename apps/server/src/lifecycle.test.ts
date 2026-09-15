/**
 * The drain, driven with an injected clock.
 *
 * The test owns the wait and the deadline, so it proves the order of the
 * steps, the re-entrancy guard, and the forced exit without waiting for real
 * time.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { DrainEvent, DrainTimers } from './lifecycle.ts';
import {
  createDrain,
  createServiceLifecycle,
  runningLifecycle,
} from './lifecycle.ts';

/** One pending call and the answer that releases it. */
function deferred(): {
  promise: Promise<void>;
  release: () => void;
} {
  let release = (): void => {};
  const promise = new Promise<void>((accept) => {
    release = accept;
  });
  return { promise, release };
}

/** A clock that only this test moves. */
function testTimers(): {
  timers: DrainTimers;
  waits: number[];
  armed: { milliseconds: number; run: () => void }[];
  finishWait: () => void;
} {
  const waits: number[] = [];
  const armed: { milliseconds: number; run: () => void }[] = [];
  const pending = deferred();
  return {
    timers: {
      wait: (milliseconds) => {
        waits.push(milliseconds);
        return pending.promise;
      },
      arm: (milliseconds, run) => {
        armed.push({ milliseconds, run });
      },
    },
    waits,
    armed,
    finishWait: pending.release,
  };
}

await test('a new lifecycle runs and moves to draining once', () => {
  const lifecycle = createServiceLifecycle();
  assert.equal(lifecycle.state(), 'running');
  assert.equal(lifecycle.beginDrain(), true);
  assert.equal(lifecycle.state(), 'draining');
  assert.equal(lifecycle.beginDrain(), false);
  assert.equal(lifecycle.state(), 'draining');
});

await test('a server with no signal handler always reports that it runs', () => {
  assert.equal(runningLifecycle.state(), 'running');
  assert.equal(runningLifecycle.beginDrain(), false);
  assert.equal(runningLifecycle.state(), 'running');
});

await test('the readiness state changes before the listener closes', async () => {
  const lifecycle = createServiceLifecycle();
  const clock = testTimers();
  const closing = deferred();
  const entered = deferred();
  const steps: DrainEvent[] = [];
  let closed = false;
  const drain = createDrain({
    lifecycle,
    close: async () => {
      closed = true;
      entered.release();
      await closing.promise;
    },
    gracePeriodMs: 5000,
    deadlineMs: 20_000,
    report: (event) => steps.push(event),
    forceExit: () => assert.fail('a clean stop never forces the exit'),
    timers: clock.timers,
  });

  const stopped = drain('SIGTERM');
  // The state changes with the signal itself, and the grace period starts
  // while the listener still accepts traffic.
  assert.equal(lifecycle.state(), 'draining');
  assert.deepEqual(clock.waits, [5000]);
  assert.equal(closed, false);

  clock.finishWait();
  await entered.promise;
  assert.equal(closed, true);

  closing.release();
  await stopped;
  assert.deepEqual(
    steps.map((step) => step.step),
    ['started', 'stopped'],
  );
});

await test('a second signal joins the stop and changes nothing', async () => {
  const lifecycle = createServiceLifecycle();
  const clock = testTimers();
  const steps: DrainEvent[] = [];
  let closes = 0;
  const drain = createDrain({
    lifecycle,
    close: () => {
      closes += 1;
      return Promise.resolve();
    },
    gracePeriodMs: 5000,
    deadlineMs: 20_000,
    report: (event) => steps.push(event),
    forceExit: () => assert.fail('a second signal never forces the exit'),
    timers: clock.timers,
  });

  const first = drain('SIGTERM');
  const second = drain('SIGTERM');
  const third = drain('SIGINT');
  assert.equal(second, first, 'a later signal joins the stop that runs');
  assert.equal(third, first);
  // One deadline, one grace period, and no second close.
  assert.equal(clock.armed.length, 1);
  assert.deepEqual(clock.waits, [5000]);

  clock.finishWait();
  await first;
  assert.equal(closes, 1);
  assert.deepEqual(
    steps.map((step) => step.step),
    ['started', 'repeated', 'repeated', 'stopped'],
  );
  assert.deepEqual(
    steps.flatMap((step) =>
      step.step === 'started' || step.step === 'repeated' ? [step.signal] : [],
    ),
    ['SIGTERM', 'SIGTERM', 'SIGINT'],
  );
});

await test('the deadline covers the whole stop and ends a stuck process', async () => {
  const lifecycle = createServiceLifecycle();
  const clock = testTimers();
  const steps: DrainEvent[] = [];
  const codes: number[] = [];
  const drain = createDrain({
    lifecycle,
    // This close never answers, which is the request that never completes.
    close: () => new Promise<void>(() => {}),
    gracePeriodMs: 0,
    deadlineMs: 20_000,
    report: (event) => steps.push(event),
    forceExit: (code) => codes.push(code),
    timers: clock.timers,
  });

  void drain('SIGTERM');
  // A grace period of zero waits for nothing and closes at once.
  assert.deepEqual(clock.waits, []);
  const deadline = clock.armed[0];
  assert.ok(deadline !== undefined, 'the stop arms one deadline');
  assert.equal(deadline.milliseconds, 20_000);

  deadline.run();
  assert.deepEqual(codes, [1], 'a forced end is not a clean stop');
  assert.deepEqual(
    steps.map((step) => step.step),
    ['started', 'forced'],
  );
});

await test('a close that fails is reported and never forces the exit', async () => {
  const clock = testTimers();
  const steps: DrainEvent[] = [];
  const drain = createDrain({
    lifecycle: createServiceLifecycle(),
    close: () => Promise.reject(new Error('the pool did not close')),
    gracePeriodMs: 0,
    deadlineMs: 20_000,
    report: (event) => steps.push(event),
    forceExit: () => assert.fail('a failed close ends through the deadline'),
    timers: clock.timers,
  });

  await drain('SIGTERM');
  assert.deepEqual(
    steps.map((step) => step.step),
    ['started', 'failed'],
  );
});
