/**
 * One value that a screen writes and other screens read by a selector
 * (record 0175).
 *
 * The open note writes its save facts here and the frame reads them. A
 * context that carried the facts rendered every reader of the context on each
 * write, the whole frame among them. A reader of this store renders only when
 * the part it selects changes, and a write of an equal value tells nobody.
 */

/** A value, its writer, and its readers. */
export type FactStore<T> = {
  readonly get: () => T;
  /** Writes a value. A value equal to the one held changes nothing. */
  readonly set: (next: T) => void;
  /** Hears each change. Answers the function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
};

/** Builds one store, with the equality that decides a change. */
export function createFactStore<T>(
  initial: T,
  equal: (left: T, right: T) => boolean,
): FactStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (equal(value, next)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Whether two records hold equal members, compared one level deep. */
export function sameMembers<T extends Readonly<Record<string, unknown>>>(
  left: T | null,
  right: T | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.is(left[key], right[key]));
}
