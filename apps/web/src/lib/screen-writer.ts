/**
 * Writers of one screen that stop when the screen goes (record 0175).
 *
 * The note screen states its save facts and its reload guard from answers of
 * the store, and an answer can arrive after the screen closed. Such an answer
 * stated the facts of a note that nobody sees, and a reload guard that it set
 * stayed on the window with no screen to lift it, so every later reload asked
 * the person to confirm. A writer here does nothing while its screen is
 * closed. `open` runs again when React mounts the screen again.
 */

/** The window members that a reload guard uses. */
export type GuardTarget = {
  readonly addEventListener: (
    type: 'beforeunload',
    listener: (event: BeforeUnloadEvent) => void,
  ) => void;
  readonly removeEventListener: (
    type: 'beforeunload',
    listener: (event: BeforeUnloadEvent) => void,
  ) => void;
};

/** The reload guard of one screen. */
export type ReloadGuard = {
  /** Blocks or allows a reload, while the screen is open. */
  readonly set: (blocked: boolean) => void;
  readonly open: () => void;
  /** Allows a reload and ignores every later `set` until `open`. */
  readonly close: () => void;
};

/** Builds the reload guard of one screen on `target`. */
export function createReloadGuard(target: GuardTarget): ReloadGuard {
  let open = false;
  let listening = false;
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
  };
  const listen = (blocked: boolean): void => {
    if (blocked === listening) return;
    listening = blocked;
    if (blocked) target.addEventListener('beforeunload', onBeforeUnload);
    else target.removeEventListener('beforeunload', onBeforeUnload);
  };
  return {
    set: (blocked) => {
      if (open) listen(blocked);
    },
    open: () => {
      open = true;
    },
    close: () => {
      listen(false);
      open = false;
    },
  };
}

/** A writer of one screen that writes only while the screen is open. */
export type ScreenWriter<T> = {
  readonly write: (value: T) => void;
  readonly open: () => void;
  /** Writes `closed` and ignores every later `write` until `open`. */
  readonly close: () => void;
};

/** Builds a writer that passes each value to `write` while it is open. */
export function createScreenWriter<T>(
  write: (value: T) => void,
  closed: T,
): ScreenWriter<T> {
  let open = false;
  return {
    write: (value) => {
      if (open) write(value);
    },
    open: () => {
      open = true;
    },
    close: () => {
      open = false;
      write(closed);
    },
  };
}
