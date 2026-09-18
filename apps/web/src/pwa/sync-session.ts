/**
 * The sync runs that belong to one browser tab.
 *
 * Every foreground and background engine of a tab shares one lease owner.
 * An application update stops those engines and waits for their lease cleanup
 * before it closes the local store.
 */

/** One running sync engine, with its stop signal and completion. */
export type ManagedSyncRun = {
  readonly stop: () => void;
  readonly finished: Promise<void>;
};

/** The shared sync identity and running engines of one browser tab. */
export type SyncSession = {
  readonly ownerId: string;
  /** Adds one engine until it finishes or its owner removes it. */
  readonly register: (run: ManagedSyncRun) => () => void;
  /** Stops every registered engine and waits for its lease cleanup. */
  readonly stop: () => Promise<void>;
};

/** Creates the one sync session that the application provider owns. */
export function createSyncSession(ownerId: string): SyncSession {
  const runs = new Set<ManagedSyncRun>();

  const register = (run: ManagedSyncRun): (() => void) => {
    runs.add(run);
    const remove = (): void => {
      runs.delete(run);
    };
    void run.finished.then(remove, remove);
    return remove;
  };

  const stop = async (): Promise<void> => {
    const active = [...runs];
    for (const run of active) run.stop();
    await Promise.all(active.map((run) => run.finished.catch(() => undefined)));
  };

  return { ownerId, register, stop };
}
