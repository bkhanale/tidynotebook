import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueueEntry } from './local-port.ts';
import {
  isRetryableStatus,
  recoveredNotePath,
  sendWithRetry,
  takeBatchable,
  type SyncContext,
} from './queue.ts';

const workspaceId = 'w0000000-0000-4000-8000-000000000001';

/** One pending save of one revision of one file. */
function save(
  revisionId: string,
  fileId: string,
  parent: string | null,
): QueueEntry {
  return {
    accountId: 'a0000000-0000-4000-8000-000000000001',
    input: {
      workspaceId,
      mutationId: `m-${revisionId}`,
      deviceId: 'device-queue',
      expectedHeads: { [fileId]: null },
      revisions: [
        {
          id: revisionId,
          fileId,
          parents: parent === null ? [] : [parent],
          path: `notes/${fileId}.md`,
          deleted: false,
          content: {
            kind: 'markdown',
            document: {
              work: { kind: 'none' },
              epoch: 1,
              observed: new Uint8Array(),
            },
          },
          clientTime: '2026-09-30T10:00:00.000Z',
          message: null,
          restoredFrom: null,
        },
      ],
    },
    state: 'pending',
    digest: null,
    errorCode: null,
  };
}

/** The revisions of one run, in order. */
function revisionsOf(batch: readonly QueueEntry[]): readonly string[] {
  return batch.flatMap((entry) =>
    entry.input.revisions.map((revision) => revision.id),
  );
}

await test('one chain of one file goes in one run', () => {
  const batch = takeBatchable([
    save('r1', 'note', 'head'),
    save('r2', 'note', 'r1'),
    save('r3', 'other', 'head-other'),
    save('r4', 'note', 'r2'),
  ]);
  assert.deepEqual(revisionsOf(batch), ['r1', 'r2', 'r3', 'r4']);
});

await test('a second chain of one file ends the run', () => {
  // Two open tabs of one note are two working copies, and each names its own
  // parent. The graph rule allows one chain per file in one changeset, so the
  // second chain waits for the next run.
  const batch = takeBatchable([
    save('a1', 'note', 'head'),
    save('b1', 'note', 'head'),
    save('a2', 'note', 'a1'),
  ]);
  assert.deepEqual(revisionsOf(batch), ['a1']);
  assert.deepEqual(revisionsOf(takeBatchable([save('b1', 'note', 'head')])), [
    'b1',
  ]);
});

await test('a save that was sent once is not combined', () => {
  const sent = { ...save('r1', 'note', 'head'), state: 'sending' as const };
  assert.deepEqual(takeBatchable([sent, save('r2', 'note', 'r1')]), []);
});

await test('a recovered note avoids every held path in any case', () => {
  // The held paths name the accepted path of a note as well as its path on
  // this device, and the workspace reads two cases of one name as one name
  // on every other surface (record 0184).
  assert.equal(
    recoveredNotePath('notes/plan.md', [
      'notes/Plan (recovered).md',
      'notes/plan (recovered 2).md',
    ]),
    'notes/plan (recovered 3).md',
  );
  assert.equal(
    recoveredNotePath('notes/plan.md', ['notes/plan.md']),
    'notes/plan (recovered).md',
  );
});

/** One retry run with immediate backoff and a real cancellation signal. */
function retryContext(signal: AbortSignal, delays: number[] = []): SyncContext {
  return {
    signal,
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
    random: () => 0,
    id: () => 'retry-test',
    announce: () => {},
  };
}

await test('only a transport failure and a temporary server answer retry', () => {
  for (const status of [0, 408, 429, 500, 503, 599])
    assert.equal(isRetryableStatus(status), true);
  for (const status of [400, 401, 403, 404, 409, 410, 412, 413, 423, 600])
    assert.equal(isRetryableStatus(status), false);
});

await test('a stalled sync request times out and the next attempt recovers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const signals: AbortSignal[] = [];
  const delays: number[] = [];
  const result = sendWithRetry(
    retryContext(controller.signal, delays),
    (signal) => {
      signals.push(signal);
      return signals.length === 1
        ? new Promise(() => {})
        : Promise.resolve({ ok: true as const, value: 'saved' });
    },
  );
  try {
    assert.equal(signals.length, 1);
    t.mock.timers.tick(119_999);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(signals.length, 1, 'a slow request gets the whole bound');
    t.mock.timers.tick(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(signals.length, 2, 'a stalled adapter cannot hold the queue');
    assert.equal(signals[0]?.aborted, true);
    assert.equal(controller.signal.aborted, false);
    assert.deepEqual(await result, { ok: true, value: 'saved' });
    assert.deepEqual(delays, [500]);
  } finally {
    controller.abort();
  }
});

await test('a slow answer inside the bound succeeds and clears its timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let answer: (() => void) | undefined;
  let attemptSignal: AbortSignal | undefined;
  const result = sendWithRetry<string>(
    retryContext(controller.signal),
    (signal) => {
      attemptSignal = signal;
      return new Promise((resolve) => {
        answer = () => resolve({ ok: true, value: 'saved' });
      });
    },
  );
  t.mock.timers.tick(119_999);
  assert.equal(attemptSignal?.aborted, false);
  assert.ok(answer !== undefined);
  answer();
  assert.deepEqual(await result, { ok: true, value: 'saved' });
  t.mock.timers.tick(120_000);
  assert.equal(
    attemptSignal?.aborted,
    false,
    'the completed attempt has no timer',
  );
});

await test('a valid slow sync answer past thirty seconds completes the same attempt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const signals: AbortSignal[] = [];
  let answer: (() => void) | undefined;
  const result = sendWithRetry<string>(
    retryContext(controller.signal),
    (signal) => {
      signals.push(signal);
      return new Promise((resolve) => {
        answer = () => resolve({ ok: true, value: 'saved' });
      });
    },
  );
  try {
    // The server's default receive window allows this whole slow request.
    t.mock.timers.tick(59_999);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(signals.length, 1, 'the slow transfer is not restarted');
    assert.equal(signals[0]?.aborted, false);
    assert.ok(answer !== undefined);
    answer();
    assert.deepEqual(await result, { ok: true, value: 'saved' });
  } finally {
    controller.abort();
    await result.catch(() => {});
  }
});

await test('stopping a stalled adapter ends the run without another attempt', async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = sendWithRetry(retryContext(controller.signal), () => {
    calls += 1;
    return new Promise(() => {});
  });
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(calls, 1);
});

await test('an abort error with a live run signal is a retryable request failure', async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await sendWithRetry(retryContext(controller.signal), () => {
    calls += 1;
    return calls === 1
      ? Promise.reject(new DOMException('The connection ended.', 'AbortError'))
      : Promise.resolve({ ok: true as const, value: 'saved' });
  });
  assert.deepEqual(result, { ok: true, value: 'saved' });
  assert.equal(calls, 2);
});
