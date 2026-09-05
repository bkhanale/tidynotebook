/**
 * When to create a checkpoint.
 *
 * The design fixes four moments: after 750 ms without input, at least every
 * 30 seconds during continuous editing, when the user invokes Save, and when
 * the user leaves the file. Draft writes are coalesced; a created checkpoint
 * is immutable and is never merged with another one.
 *
 * This module is pure. The clock and the timer are injected, so the rules are
 * tested with a fake clock instead of real waiting, and the same scheduler
 * runs in a browser tab and in a test.
 */

/** Why a checkpoint was requested. */
export type CheckpointReason = 'idle' | 'interval' | 'save' | 'leave';

/** One request to create a checkpoint. */
export type CheckpointDecision = {
  readonly reason: CheckpointReason;
};

/**
 * The handle an injected timer returns.
 *
 * It travels back to `clearTimer` unchanged, so the scheduler never inspects
 * it. This keeps a browser `number` and a Node timer object both acceptable.
 */
export type TimerHandle = unknown;

/** What the scheduler needs from its environment. */
export type CheckpointSchedulerOptions = {
  /** Milliseconds since an arbitrary fixed point, increasing. */
  readonly now: () => number;
  /** Schedules `callback` after `delayMs` and returns a handle. */
  readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  /** Cancels a scheduled callback. */
  readonly clearTimer: (handle: TimerHandle) => void;
  /** Receives every decision. It must not throw. */
  readonly onCheckpoint: (decision: CheckpointDecision) => void;
  /** Idle time before an automatic checkpoint. The design's value is 750. */
  readonly idleMs?: number;
  /** Longest gap during continuous editing. The design's value is 30000. */
  readonly maxIntervalMs?: number;
};

/** The scheduler of one open working copy. */
export type CheckpointScheduler = {
  /** Records one editor change. */
  onInput: () => void;
  /** The user invoked Save. Requests a checkpoint at once. */
  onSave: () => void;
  /** The user left the file. Requests a checkpoint at once. */
  onLeave: () => void;
  /** Cancels every pending timer without requesting a checkpoint. */
  stop: () => void;
};

/** The design's idle delay in milliseconds. */
export const defaultIdleMs = 750;

/** The design's longest gap during continuous editing, in milliseconds. */
export const defaultMaxIntervalMs = 30_000;

/**
 * Creates the checkpoint scheduler of one working copy.
 *
 * A run starts with the first input after the previous decision. The idle
 * timer restarts on every input, so it fires only after the user stops. The
 * interval timer is set once per run and is not restarted by input, so
 * continuous typing still reaches a decision every `maxIntervalMs`. A save and
 * a leave decide at once and end the run.
 *
 * The scheduler decides only when to ask. Whether a checkpoint is actually
 * written is `shouldCheckpoint`, because only the store knows the last stored
 * state.
 */
export function createCheckpointScheduler(
  options: CheckpointSchedulerOptions,
): CheckpointScheduler {
  const idleMs = options.idleMs ?? defaultIdleMs;
  const maxIntervalMs = options.maxIntervalMs ?? defaultMaxIntervalMs;
  // A pending timer is held in a wrapper, so a handle whose value is `0`,
  // `null`, or `undefined` is still recognized as a scheduled timer.
  let idle: { readonly handle: TimerHandle } | null = null;
  let interval: { readonly handle: TimerHandle } | null = null;
  /** When the current run of continuous editing began. */
  let runStartedAt: number | null = null;

  function stopIdle(): void {
    if (idle !== null) options.clearTimer(idle.handle);
    idle = null;
  }
  function stopInterval(): void {
    if (interval !== null) options.clearTimer(interval.handle);
    interval = null;
  }
  function endRun(): void {
    stopIdle();
    stopInterval();
    runStartedAt = null;
  }
  function idleReached(): void {
    endRun();
    options.onCheckpoint({ reason: 'idle' });
  }
  function intervalReached(): void {
    stopInterval();
    // A new interval starts here, so continuous typing reaches the next
    // forced checkpoint one interval later.
    runStartedAt = options.now();
    interval = { handle: options.setTimer(intervalReached, maxIntervalMs) };
    options.onCheckpoint({ reason: 'interval' });
  }

  function onInput(): void {
    const at = options.now();
    stopIdle();
    idle = { handle: options.setTimer(idleReached, idleMs) };
    if (runStartedAt === null) {
      // The interval timer measures from the first input of the run and is not
      // restarted by later input, so continuous typing cannot postpone it.
      runStartedAt = at;
      interval = { handle: options.setTimer(intervalReached, maxIntervalMs) };
      return;
    }
    // A browser throttles timers in a background tab, so a fired timer is not
    // the only evidence. The clock decides as well.
    if (at - runStartedAt >= maxIntervalMs) intervalReached();
  }

  function decide(reason: CheckpointReason): () => void {
    return () => {
      endRun();
      options.onCheckpoint({ reason });
    };
  }

  return {
    onInput,
    onSave: decide('save'),
    onLeave: decide('leave'),
    stop: endRun,
  };
}

/**
 * The state a checkpoint decision compares.
 *
 * A `CheckpointRecord` and a draft with its computed digest both match this
 * shape, so the comparison needs no conversion.
 */
export type CheckpointComparison = {
  readonly digest: string;
  readonly path: string;
  readonly deleted: boolean;
};

/**
 * Whether a checkpoint has to be written.
 *
 * The design skips a checkpoint when the content and the metadata have not
 * changed, unless the user asked for a named checkpoint. A named checkpoint of
 * unchanged content is a valid mark in history, so it is never suppressed.
 *
 * `previous` is the last checkpoint of this working copy, or the accepted head
 * the working copy started from, or `null` when neither exists.
 */
export function shouldCheckpoint(
  previous: CheckpointComparison | null,
  draft: CheckpointComparison,
  message: string | null,
): boolean {
  if (message !== null && message !== '') return true;
  if (previous === null) return true;
  return (
    previous.digest !== draft.digest ||
    previous.path !== draft.path ||
    previous.deleted !== draft.deleted
  );
}
