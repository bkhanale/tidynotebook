/**
 * The two notices of the installed application.
 *
 * An installed worker waits until the person accepts the update, so the
 * shell has to offer it. Durable local storage has to be asked for, and a
 * refusal has to be said once, because the promise of offline drafts does
 * not hold without it.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { LocalStore } from '@notesapp/sync';
import { Button, Notice } from '@notesapp/ui';
import {
  persistenceDenialMessage,
  prepareForUpdate,
  requestPersistentStorage,
  requestUpdate,
} from '../pwa/lifecycle.ts';

/** Watches the worker registration for a version that waits to activate. */
export function useWaitingUpdate(): boolean {
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const container = navigator.serviceWorker;
    if (container === undefined) return;
    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;
    let removeInstalling = (): void => {};
    const check = (): void => {
      if (cancelled) return;
      setWaiting(registration?.waiting != null);
    };
    const watchInstalling = (): void => {
      removeInstalling();
      const installing = registration?.installing;
      if (installing === undefined || installing === null) {
        removeInstalling = (): void => {};
        check();
        return;
      }
      installing.addEventListener('statechange', check);
      removeInstalling = () =>
        installing.removeEventListener('statechange', check);
      check();
    };
    void container
      .getRegistration()
      .then((found) => {
        if (cancelled) return;
        registration = found ?? null;
        watchInstalling();
        registration?.addEventListener('updatefound', watchInstalling);
      })
      .catch(() => undefined);
    container.addEventListener('controllerchange', check);
    return () => {
      cancelled = true;
      removeInstalling();
      registration?.removeEventListener('updatefound', watchInstalling);
      container.removeEventListener('controllerchange', check);
    };
  }, []);

  return waiting;
}

/**
 * Offers the waiting version.
 *
 * Accepting writes every draft, stops queue writes, closes the database of
 * this tab, and only then lets the new worker take over. A tab that cannot
 * close its database says why and keeps the old version usable.
 */
export function UpdateNotice({
  store,
  ownerId,
  onFlushDrafts,
  onStopQueue,
}: {
  readonly store: LocalStore | null;
  readonly ownerId: string;
  readonly onFlushDrafts: () => Promise<void>;
  readonly onStopQueue: () => Promise<void>;
}): ReactNode {
  const waiting = useWaitingUpdate();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const install = useCallback((): void => {
    setBusy(true);
    void (async (): Promise<void> => {
      try {
        if (store !== null)
          await prepareForUpdate(store, ownerId, {
            flushDrafts: onFlushDrafts,
            stopQueue: onStopQueue,
          });
        await requestUpdate();
        window.location.reload();
      } catch (failure: unknown) {
        setBusy(false);
        setProblem(
          failure instanceof Error
            ? failure.message
            : 'The update could not start. Close the other tabs and try again.',
        );
      }
    })();
  }, [store, ownerId, onFlushDrafts, onStopQueue]);

  if (!waiting) return null;
  if (problem !== null) return <Notice tone="problem" message={problem} />;
  return (
    <Notice tone="info" message="A new version of Notesapp is ready.">
      <Button variant="primary" size="sm" disabled={busy} onClick={install}>
        {busy ? 'Updating' : 'Update now'}
      </Button>
    </Notice>
  );
}

const persistenceAskedKey = 'notesapp.persistence-asked';

/**
 * Asks for durable storage after the first save, once per device.
 *
 * The request needs a reason the browser can see, so it runs after a save
 * instead of at start. A refusal is said once and then remembered, so the
 * message never repeats on every save.
 */
export function usePersistentStorage(afterFirstSave: boolean): {
  readonly denial: string | null;
  readonly dismiss: () => void;
} {
  const [denial, setDenial] = useState<string | null>(null);

  useEffect(() => {
    if (!afterFirstSave) return;
    let asked = 'no';
    try {
      asked = window.localStorage.getItem(persistenceAskedKey) ?? 'no';
    } catch {
      return;
    }
    if (asked !== 'no') return;
    void requestPersistentStorage().then((outcome) => {
      try {
        window.localStorage.setItem(persistenceAskedKey, outcome);
      } catch {
        // The outcome is still correct for this tab.
      }
      if (outcome === 'denied') setDenial(persistenceDenialMessage());
    });
  }, [afterFirstSave]);

  const dismiss = useCallback((): void => {
    setDenial(null);
  }, []);

  return { denial, dismiss };
}
