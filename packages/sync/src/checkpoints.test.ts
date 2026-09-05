/**
 * Checkpoint timing rules.
 *
 * Every check uses a fake clock and a fake timer queue, so the design's 750 ms
 * and 30 s rules are verified without waiting.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCheckpointScheduler,
  defaultIdleMs,
  defaultMaxIntervalMs,
  shouldCheckpoint,
  type CheckpointDecision,
  type CheckpointScheduler,
  type TimerHandle,
} from './checkpoints.ts';

/** A clock and a timer queue that only a test advances. */
type FakeClock = {
  /** Moves time forward and runs every timer due in that span. */
  advance: (ms: number) => void;
  /** Moves time forward without running any timer, as a throttled tab does. */
  drift: (ms: number) => void;
  readonly options: {
    now: () => number;
    setTimer: (callback: () => void, delayMs: number) => TimerHandle;
    clearTimer: (handle: TimerHandle) => void;
  };
};

function createFakeClock(): FakeClock {
  let current = 1_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const runDue = (): void => {
    for (;;) {
      let due: { id: number; at: number; callback: () => void } | null = null;
      for (const [id, timer] of timers) {
        if (timer.at > current) continue;
        if (
          due === null ||
          timer.at < due.at ||
          (timer.at === due.at && id < due.id)
        )
          due = { id, at: timer.at, callback: timer.callback };
      }
      if (due === null) return;
      timers.delete(due.id);
      due.callback();
    }
  };
  return {
    advance: (ms) => {
      current += ms;
      runDue();
    },
    drift: (ms) => {
      current += ms;
    },
    options: {
      now: () => current,
      setTimer: (callback, delayMs) => {
        const id = nextId++;
        timers.set(id, { at: current + delayMs, callback });
        return id;
      },
      clearTimer: (handle) => {
        if (typeof handle === 'number') timers.delete(handle);
      },
    },
  };
}

/** A scheduler with the design's values and a recorded decision list. */
function createHarness(): {
  clock: FakeClock;
  reasons: string[];
  scheduler: CheckpointScheduler;
} {
  const clock = createFakeClock();
  const reasons: string[] = [];
  const scheduler = createCheckpointScheduler({
    ...clock.options,
    idleMs: defaultIdleMs,
    maxIntervalMs: defaultMaxIntervalMs,
    onCheckpoint: (decision: CheckpointDecision) =>
      reasons.push(decision.reason),
  });
  return { clock, reasons, scheduler };
}

await test('the design values are 750 ms and 30 s', () => {
  assert.equal(defaultIdleMs, 750);
  assert.equal(defaultMaxIntervalMs, 30_000);
});

await test('one checkpoint follows 750 ms without input', () => {
  const { clock, reasons, scheduler } = createHarness();
  scheduler.onInput();
  clock.advance(749);
  assert.deepEqual(reasons, []);
  clock.advance(1);
  assert.deepEqual(reasons, ['idle']);
});

await test('input restarts the idle delay', () => {
  const { clock, reasons, scheduler } = createHarness();
  scheduler.onInput();
  clock.advance(700);
  scheduler.onInput();
  clock.advance(700);
  assert.deepEqual(reasons, []);
  clock.advance(50);
  assert.deepEqual(reasons, ['idle']);
});

await test('continuous typing forces a checkpoint every 30 s', () => {
  const { clock, reasons, scheduler } = createHarness();
  // One keystroke every 100 ms for 90 s never reaches the idle delay.
  for (let elapsed = 0; elapsed < 90_000; elapsed += 100) {
    scheduler.onInput();
    clock.advance(100);
  }
  assert.deepEqual(reasons, ['interval', 'interval', 'interval']);
  // The run continues, so the idle checkpoint still follows the last input.
  clock.advance(750);
  assert.deepEqual(reasons, ['interval', 'interval', 'interval', 'idle']);
});

await test('a throttled timer does not postpone the 30 s rule', () => {
  const { clock, reasons, scheduler } = createHarness();
  scheduler.onInput();
  // The tab is in the background: the clock moves but no timer fires.
  clock.drift(30_000);
  scheduler.onInput();
  assert.deepEqual(reasons, ['interval']);
});

await test('an idle checkpoint ends the run and the next run starts fresh', () => {
  const { clock, reasons, scheduler } = createHarness();
  scheduler.onInput();
  clock.advance(750);
  assert.deepEqual(reasons, ['idle']);
  // 30 s after the first input, but the run ended, so nothing is forced.
  clock.advance(29_250);
  assert.deepEqual(reasons, ['idle']);
  scheduler.onInput();
  clock.advance(29_999);
  assert.deepEqual(reasons, ['idle', 'idle']);
});

await test('save and leave decide at once and cancel pending timers', () => {
  const save = createHarness();
  save.scheduler.onInput();
  save.scheduler.onSave();
  assert.deepEqual(save.reasons, ['save']);
  save.clock.advance(60_000);
  assert.deepEqual(save.reasons, ['save']);

  const leave = createHarness();
  leave.scheduler.onInput();
  leave.scheduler.onLeave();
  assert.deepEqual(leave.reasons, ['leave']);
  leave.clock.advance(60_000);
  assert.deepEqual(leave.reasons, ['leave']);
});

await test('save and leave decide without any input', () => {
  const { reasons, scheduler } = createHarness();
  scheduler.onSave();
  scheduler.onLeave();
  assert.deepEqual(reasons, ['save', 'leave']);
});

await test('stop cancels every timer without a decision', () => {
  const { clock, reasons, scheduler } = createHarness();
  scheduler.onInput();
  scheduler.stop();
  clock.advance(60_000);
  assert.deepEqual(reasons, []);
});

const unchanged = { digest: 'a1', path: 'notes/one.md', deleted: false };

await test('an unchanged working copy is suppressed', () => {
  assert.equal(shouldCheckpoint(unchanged, { ...unchanged }, null), false);
});

await test('a named checkpoint of unchanged content is allowed', () => {
  assert.equal(
    shouldCheckpoint(unchanged, { ...unchanged }, 'before the rewrite'),
    true,
  );
});

await test('an empty message is not a named checkpoint', () => {
  assert.equal(shouldCheckpoint(unchanged, { ...unchanged }, ''), false);
});

await test('changed content, path, or deletion is not suppressed', () => {
  assert.equal(
    shouldCheckpoint(unchanged, { ...unchanged, digest: 'b2' }, null),
    true,
  );
  assert.equal(
    shouldCheckpoint(unchanged, { ...unchanged, path: 'notes/two.md' }, null),
    true,
  );
  assert.equal(
    shouldCheckpoint(unchanged, { ...unchanged, deleted: true }, null),
    true,
  );
});

await test('a working copy with no previous state is never suppressed', () => {
  assert.equal(shouldCheckpoint(null, unchanged, null), true);
});
