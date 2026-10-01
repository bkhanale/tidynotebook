/**
 * Stores a typed setting when the person leaves its fields (records 0101 and
 * 0149).
 *
 * A setting that a person types, such as a folder or a name format, applies
 * when the person leaves the fields, presses Enter, or leaves the page, and
 * not at every keystroke: a half typed folder would move the notes that the
 * setting names at every key. The provider of the setting outlives the page,
 * so a change that the person makes on the way out still goes.
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';

/** The handlers that a group of fields spreads on its container. */
export type StoreOnLeave = {
  readonly onBlur: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

/**
 * Runs `store` when the person leaves the fields, presses Enter in one of
 * them, or leaves the page. `store` decides itself whether there is anything
 * to store, so a second run with nothing new stores nothing.
 */
export function useStoreOnLeave(store: () => void): StoreOnLeave {
  const latest = useRef(store);
  latest.current = store;
  useEffect(
    () => () => {
      latest.current();
    },
    [],
  );
  return {
    onBlur: () => {
      latest.current();
    },
    onKeyDown: (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      latest.current();
    },
  };
}
