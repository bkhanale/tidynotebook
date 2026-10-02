import { useEffect, useRef, useState } from 'react';
import type { WorkspaceFileSummary } from '@notesapp/api-client';
import type { LocalChange, LocalFileSummary, LocalStore } from '@notesapp/sync';
import { createCoalescedRead } from './lib/coalesced-read.ts';

/** The result of one reactive durable local query. */
export type LocalQueryState<T> =
  | { readonly status: 'loading'; readonly value: T }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'error'; readonly value: T };

/**
 * Runs a local query after matching committed changes, focus, and a safety
 * interval. The query reads IndexedDB again. An event is never treated as data.
 *
 * One query runs at a time, and the changes that arrive while it runs ask for
 * one more run after it (`lib/coalesced-read.ts`), so a burst of changes reads
 * twice and not once per change (record 0176).
 */
export function useLocalQuery<T>(
  store: LocalStore | null,
  accountId: string | null,
  workspaceId: string | null,
  query: (
    store: LocalStore,
    accountId: string,
    workspaceId: string,
  ) => Promise<T>,
  initial: T,
  accepts: (change: LocalChange) => boolean = () => true,
  fallbackMs = 30_000,
): LocalQueryState<T> {
  const queryRef = useRef(query);
  const acceptsRef = useRef(accepts);
  queryRef.current = query;
  acceptsRef.current = accepts;
  const [state, setState] = useState<LocalQueryState<T>>({
    status: 'loading',
    value: initial,
  });

  useEffect(() => {
    if (store === null || accountId === null || workspaceId === null) {
      setState({ status: 'ready', value: initial });
      return;
    }
    let current = true;
    const read = createCoalescedRead(async () => {
      try {
        const value = await queryRef.current(store, accountId, workspaceId);
        if (current) setState({ status: 'ready', value });
      } catch {
        if (current)
          setState((previous) => ({ status: 'error', value: previous.value }));
      }
    });
    read.ask();
    const unsubscribe = store.subscribe((change) => {
      if (
        change.accountId === accountId &&
        change.workspaceId === workspaceId &&
        acceptsRef.current(change)
      )
        read.ask();
    });
    window.addEventListener('focus', read.ask);
    const timer = window.setInterval(read.ask, fallbackMs);
    return () => {
      current = false;
      read.stop();
      unsubscribe();
      window.removeEventListener('focus', read.ask);
      window.clearInterval(timer);
    };
  }, [store, accountId, workspaceId, initial, fallbackMs]);

  return state;
}

/** Merges remote accepted metadata with newer local working state. */
export function mergeFileSummaries(
  remote: readonly WorkspaceFileSummary[],
  local: readonly LocalFileSummary[],
): readonly WorkspaceFileSummary[] {
  const merged = new Map<string, WorkspaceFileSummary>(
    remote.map((file) => [file.fileId, file]),
  );
  for (const file of local) {
    if (file.deleted) {
      merged.delete(file.fileId);
      continue;
    }
    const accepted = merged.get(file.fileId);
    // The listing and this device describe the same accepted revision, and
    // nothing of this device waits to be sent. The listing then states when
    // that revision was saved, while the local row states only when this
    // device received it, which a snapshot sets to one instant for every
    // note. The saved instant is the one a person reads.
    if (
      accepted !== undefined &&
      !file.localOnly &&
      file.localHeadRevisionId === file.acceptedHeadRevisionId &&
      file.acceptedHeadRevisionId === accepted.headRevisionId
    )
      continue;
    const localTimestamp = Date.parse(file.updatedAt);
    const remoteTimestamp =
      accepted === undefined
        ? Number.NEGATIVE_INFINITY
        : Date.parse(accepted.updatedAt);
    const localIsNewer =
      file.localOnly ||
      file.localHeadRevisionId !== file.acceptedHeadRevisionId ||
      accepted === undefined ||
      localTimestamp > remoteTimestamp;
    merged.set(file.fileId, {
      fileId: file.fileId,
      path: localIsNewer ? file.path : (accepted?.path ?? file.path),
      kind: file.kind,
      headRevisionId: accepted?.headRevisionId ?? file.acceptedHeadRevisionId,
      // The server owns the creation instant. A file that the server does
      // not know yet was created on this device, so its earliest known
      // instant is the local one.
      createdAt: accepted?.createdAt ?? file.updatedAt,
      updatedAt:
        localIsNewer || accepted === undefined
          ? file.updatedAt
          : accepted.updatedAt,
    });
  }
  return [...merged.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}
