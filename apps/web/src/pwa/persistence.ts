/**
 * What the frame says about persistent storage on this device.
 *
 * The application asks the browser to keep its local data after the first
 * save (`requestPersistentStorage` in `./lifecycle.ts`). Chrome refuses a
 * site that a person has not used much, so a refusal is common and is not a
 * failure: the server keeps every note that reached it, and the browser
 * removes local data only when the device runs out of space.
 *
 * The refusal therefore says two different things. With no work that waits
 * on this device, it is one quiet fact for the device: an info notice that
 * shows until the person closes it, and never again on that device. With work
 * that is only on this device and cannot go to the server now, the same
 * refusal puts that work at risk, so a strong notice says so and states what
 * to do. It shows while the risk lasts, whether or not the quiet notice was
 * closed, because closing a fact is not accepting a loss.
 *
 * Everything here is pure, so the rule is tested without a browser. The hook
 * in `apps/web/src/shell/pwa-notices.tsx` reads the stored values and the
 * state of the work and renders the answer.
 */

/** The outcome of a persistent storage request. */
export type PersistenceRequest = 'granted' | 'denied' | 'unsupported';

/** The notice of persistent storage that the frame shows now. */
export type StorageNotice =
  | { readonly kind: 'none' }
  /** The refusal, said once for the device. */
  | { readonly kind: 'quiet'; readonly message: string }
  /** Work that is only on this device is at risk while the refusal holds. */
  | { readonly kind: 'at-risk'; readonly message: string };

/** The local settings key of the outcome of the request on this device. */
export const persistenceAskedKey = 'notesapp.persistence-asked';

/** The local settings key that records that the quiet notice was closed. */
export const persistenceNoticeClosedKey = 'notesapp.persistence-notice-closed';

/** The sentence of the quiet notice. */
export const persistenceQuietMessage =
  'This browser can remove offline data when the device needs space. Notes on the server stay safe.';

/** The sentence of the strong notice. */
export const persistenceAtRiskMessage =
  'Some changes are only on this device, and this browser can remove them when the device needs space. Keep this tab open until they go to the server.';

/** Reads a stored outcome, and treats anything else as not asked yet. */
export function readPersistenceOutcome(
  value: string | null,
): PersistenceRequest | null {
  return value === 'granted' || value === 'denied' || value === 'unsupported'
    ? value
    : null;
}

/**
 * Which notice of persistent storage shows.
 *
 * `outcome` is the stored answer of the browser, or `null` when this device
 * has not asked. `unsentWork` is true when this device holds work that the
 * server does not have. `sending` is true when that work can go to the server
 * now: the device is online and sync runs. Only a refusal speaks.
 */
export function persistenceNotice(input: {
  readonly outcome: PersistenceRequest | null;
  readonly closed: boolean;
  readonly unsentWork: boolean;
  readonly sending: boolean;
}): StorageNotice {
  if (input.outcome !== 'denied') return { kind: 'none' };
  if (input.unsentWork && !input.sending)
    return { kind: 'at-risk', message: persistenceAtRiskMessage };
  if (input.closed) return { kind: 'none' };
  return { kind: 'quiet', message: persistenceQuietMessage };
}
