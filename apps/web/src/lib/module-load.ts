/**
 * A module that a screen loads when a person asks for it (record 0177).
 *
 * A lazy component that does not arrive, for example offline or after a new
 * release, throws to the error boundary of its route, and the whole screen
 * gave way to the error page for a dialog that did not open. A load here
 * answers the failure instead, so the screen states it in place and keeps
 * everything else. A module that arrived is kept, and a failed load tries
 * again on the next request.
 */

/** The answer of one load. */
export type ModuleLoad<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false };

/** Builds the loader of one module. */
export function createModuleLoad<T>(
  load: () => Promise<T>,
): () => Promise<ModuleLoad<T>> {
  let loaded: Promise<ModuleLoad<T>> | null = null;
  return () => {
    loaded ??= load().then(
      (value): ModuleLoad<T> => ({ ok: true, value }),
      (): ModuleLoad<T> => {
        loaded = null;
        return { ok: false };
      },
    );
    return loaded;
  };
}
