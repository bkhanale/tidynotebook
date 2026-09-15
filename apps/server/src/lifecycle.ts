/**
 * The stop of this process, as a drain.
 *
 * A stop signal does not end the process at once. The server first reports
 * that it is not ready, so a proxy or an orchestrator moves new traffic away.
 * It then closes its listener, completes the requests that are already open,
 * and closes the resources that it owns. A deadline bounds the whole stop, so
 * one request that never completes cannot hold the process.
 *
 * The order is the contract of this module:
 *
 * 1. Report the stop in the readiness answer.
 * 2. Wait the grace period, so the proxy in front reads that answer.
 * 3. Close the listener and complete the open requests.
 * 4. Close the resources that the process owns.
 *
 * Step 3 and step 4 are one call, because `close` of the Fastify instance
 * stops the listener, waits for the open requests, and then runs the close
 * hooks that end the pools, the timers, and the stores.
 *
 * The state machine lives here and not in `main.ts`, because the entry point
 * owns the real signals and the real exit and no test can drive those. Every
 * decision of this module is injected: the wait, the deadline, the close, the
 * report, and the exit.
 */

/** What the service reports about its own lifecycle. */
export type ServiceState = 'running' | 'draining';

/** The lifecycle state that the readiness answer reads. */
export type ServiceLifecycle = {
  /** The state of the service at this moment. */
  readonly state: () => ServiceState;
  /**
   * Moves the service to the draining state.
   *
   * It answers `true` for the first call and `false` for every later call, so
   * a caller can tell a first stop signal from a repeated one.
   */
  readonly beginDrain: () => boolean;
};

/** A lifecycle that starts in the running state. */
export function createServiceLifecycle(): ServiceLifecycle {
  let current: ServiceState = 'running';
  return {
    state: (): ServiceState => current,
    beginDrain: (): boolean => {
      if (current === 'draining') return false;
      current = 'draining';
      return true;
    },
  };
}

/**
 * The lifecycle of a server that owns no signal handler.
 *
 * A test server and an embedded build never receive a stop signal, so their
 * readiness answer reports the probes alone.
 */
export const runningLifecycle: ServiceLifecycle = {
  state: (): ServiceState => 'running',
  beginDrain: (): boolean => false,
};

/** One step of the stop, as the operator reads it. */
export type DrainEvent =
  | { readonly step: 'started'; readonly signal: string }
  | { readonly step: 'repeated'; readonly signal: string }
  | { readonly step: 'stopped' }
  | { readonly step: 'failed' }
  | { readonly step: 'forced' };

/** The two timers of the stop. A test supplies its own clock through them. */
export type DrainTimers = {
  /** Waits the grace period. */
  readonly wait: (milliseconds: number) => Promise<void>;
  /** Arms the forced exit. The timer never holds the event loop open. */
  readonly arm: (milliseconds: number, run: () => void) => void;
};

/** The timers of the running process. */
export const realTimers: DrainTimers = {
  // The grace period holds the event loop, because the stop must reach the
  // close even when the listener has no open connection left.
  wait: (milliseconds) =>
    new Promise((accept) => {
      setTimeout(accept, milliseconds);
    }),
  // The deadline holds nothing. A process that closed everything exits before
  // the deadline instead of waiting for it.
  arm: (milliseconds, run) => {
    setTimeout(run, milliseconds).unref();
  },
};

/** Everything that the stop needs from the process that it stops. */
export type DrainOptions = {
  /** The state that the readiness answer reads. */
  readonly lifecycle: ServiceLifecycle;
  /**
   * Closes the listener, completes the open requests, and closes the
   * resources of the process.
   */
  readonly close: () => Promise<void>;
  /** The wait between the readiness report and the close of the listener. */
  readonly gracePeriodMs: number;
  /** The whole budget from the first stop signal to the forced exit. */
  readonly deadlineMs: number;
  /** Tells the operator what the stop does. */
  readonly report: (event: DrainEvent) => void;
  /** Ends the process at the deadline. It is the one escape hatch. */
  readonly forceExit: (code: number) => void;
  /** The clock of the stop. The process clock is the default. */
  readonly timers?: DrainTimers;
};

/** Starts the stop, or joins the stop that already runs. */
export type Drain = (signal: string) => Promise<void>;

/**
 * Builds the stop of one process.
 *
 * The first signal starts the stop. A later signal joins it and changes
 * nothing, because a stop that ended here would cut the requests that the
 * first signal completes. The deadline is the one bound on the stop, and an
 * operator who cannot wait for it sends `SIGKILL`.
 */
export function createDrain(options: DrainOptions): Drain {
  const timers = options.timers ?? realTimers;
  let running: Promise<void> | null = null;

  const run = async (signal: string): Promise<void> => {
    options.report({ step: 'started', signal });
    // The deadline covers the whole stop and nothing disarms it. It holds no
    // handle open, so a process that closed every resource exits on its own,
    // and a process that one stuck request or one leaked handle holds exits
    // at the deadline instead of never.
    timers.arm(options.deadlineMs, () => {
      options.report({ step: 'forced' });
      options.forceExit(1);
    });
    // This wait is not a synchronisation device. The readiness answer already
    // reports the stop, and the wait gives the proxy in front of the server
    // the time to read that answer and to send the next request elsewhere. A
    // deployment with no proxy sets the grace period to zero.
    if (options.gracePeriodMs > 0) await timers.wait(options.gracePeriodMs);
    try {
      await options.close();
      options.report({ step: 'stopped' });
    } catch {
      // The failure itself is never shown. The operator reads that the stop
      // was not clean, and the exit code of the process states the same.
      options.report({ step: 'failed' });
    }
  };

  return (signal: string): Promise<void> => {
    if (running !== null) {
      options.report({ step: 'repeated', signal });
      return running;
    }
    // The readiness answer changes before anything else, so the window in
    // which the proxy can observe the stop starts at the signal itself.
    options.lifecycle.beginDrain();
    running = run(signal);
    return running;
  };
}
