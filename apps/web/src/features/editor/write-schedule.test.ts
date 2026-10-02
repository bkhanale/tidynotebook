import assert from 'node:assert/strict';
import test from 'node:test';
import { createWriteSchedule } from './write-schedule.ts';

/** A schedule on a clock that the test moves. */
function scheduleOnClock(pauseMs = 120, maxWaitMs = 1000) {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const writes: number[] = [];
  const schedule = createWriteSchedule<number>({
    pauseMs,
    maxWaitMs,
    now: () => now,
    defer: (run, delayMs) => {
      next += 1;
      timers.set(next, { at: now + delayMs, run });
      return next;
    },
    cancel: (token) => {
      timers.delete(token);
    },
    write: () => {
      writes.push(now);
    },
  });
  /** Moves the clock and runs every timer that is due, in order. */
  const advance = (ms: number): void => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (due === undefined) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].run();
    }
    now = end;
  };
  return { schedule, advance, writes, pending: () => timers.size };
}

await test('a key writes nothing, and a pause writes the burst once', () => {
  const clock = scheduleOnClock();
  for (let key = 0; key < 10; key += 1) {
    clock.schedule.touch();
    clock.advance(40);
  }
  assert.deepEqual(clock.writes, []);
  assert.ok(clock.schedule.waiting());
  clock.advance(120);
  assert.deepEqual(clock.writes, [480]);
  assert.equal(clock.schedule.waiting(), false);
});

await test('a long burst still writes once each longest wait', () => {
  const clock = scheduleOnClock(120, 1000);
  for (let key = 0; key < 75; key += 1) {
    clock.schedule.touch();
    clock.advance(40);
  }
  // Keys from 0 ms to 2960 ms: the first held key waits at most 1000 ms,
  // so the burst writes at 1000, 2000 and 3000 ms, the last with its end.
  assert.deepEqual(clock.writes, [1000, 2000, 3000]);
  clock.advance(1000);
  assert.deepEqual(clock.writes, [1000, 2000, 3000]);
});

await test('a save runs the waiting write at once and only once', () => {
  const clock = scheduleOnClock();
  clock.schedule.touch();
  assert.equal(clock.schedule.flush(), true);
  assert.deepEqual(clock.writes, [0]);
  assert.equal(clock.schedule.flush(), false);
  assert.equal(clock.pending(), 0);
});

await test('a cancelled write never runs', () => {
  const clock = scheduleOnClock();
  clock.schedule.touch();
  clock.schedule.cancel();
  clock.advance(5000);
  assert.deepEqual(clock.writes, []);
  assert.equal(clock.schedule.waiting(), false);
});
