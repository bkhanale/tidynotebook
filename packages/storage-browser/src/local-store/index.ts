/**
 * The IndexedDB implementation of the local persistence port.
 *
 * Two transaction boundaries matter, and they come from the design:
 *
 * - A draft save is one short transaction that writes one draft record. The
 *   target is at most 150 ms after input, so recovery state becomes durable
 *   promptly.
 * - A checkpoint is one transaction that writes the content, the immutable
 *   checkpoint with its parent, the local head, and the queue entry. Either
 *   all of them exist or none does, so a queued mutation always has the bytes
 *   it refers to and a stored checkpoint always has a parent.
 *
 * The store is opened for one server origin and every key starts with that
 * origin, the account, and the workspace. A caller names its account on every
 * method, so one account cannot reach the records of another.
 *
 * The clock and the identifier source are injected, so a test produces the
 * same records twice.
 *
 * `openLocalStore` is the composition root. It opens the database, checks the
 * schema, builds one `LocalStoreContext`, and assembles the full port from the
 * area modules: drafts, versions, file actions, queue and receipts, recovery,
 * preferences, and snapshot. The area modules never touch the invalidation
 * channel, so the messaging and the subscription stay here.
 */
import { generateUUID } from '@notesapp/core';
import {
  LocalStorageError,
  type LocalChange,
  type LocalStore,
} from '@notesapp/sync';
import { createDatabase, defaultDatabaseName, guard } from '../database.ts';
import { ensureSchema } from '../migrations.ts';
import { localChangeOf } from './channel.ts';
import { createDraftsSlice } from './drafts.ts';
import { createFilesSlice } from './files.ts';
import { createFileActionsSlice } from './file-actions.ts';
import { createLegacySlice } from './legacy.ts';
import { createPreferencesSlice } from './preferences.ts';
import { createQueueSlice } from './queue.ts';
import { createRecoverySlice } from './recovery.ts';
import { createSnapshotSlice } from './snapshot.ts';
import type { LocalStoreContext } from './shared.ts';
import { createVersionsSlice } from './versions.ts';

/** One reference-counted invalidation bus used without browser messaging. */
type FallbackBus = {
  readonly listeners: Set<(change: LocalChange) => void>;
  stores: number;
};

/** In-process invalidation buses used when browser messaging is unavailable. */
const fallbackBuses = new Map<string, FallbackBus>();

/** What `openLocalStore` accepts. */
export type LocalStoreOptions = {
  /** The IndexedDB factory. Node tests inject `fake-indexeddb`. */
  readonly indexedDB?: IDBFactory;
  /** The key range constructor that belongs to the injected factory. */
  readonly IDBKeyRange?: typeof IDBKeyRange;
  /** The database name. A test uses its own so runs stay isolated. */
  readonly databaseName?: string;
  /** The clock, in milliseconds. */
  readonly now?: () => number;
  /** The source of client generated identifiers. */
  readonly id?: () => string;
  /** The device identity. The stored one is used when this is absent. */
  readonly deviceId?: string;
};

/**
 * Opens the local database of one server origin.
 *
 * The schema check runs before the store is returned, so an interrupted
 * migration is completed or refused before any note is written.
 */
export async function openLocalStore(
  serverOrigin: string,
  options: LocalStoreOptions = {},
): Promise<LocalStore> {
  if (serverOrigin === '')
    throw new LocalStorageError('unavailable', 'the server origin is empty');
  const clock = options.now ?? Date.now;
  const newId = options.id ?? ((): string => generateUUID());
  const nowIso = (): string => new Date(clock()).toISOString();
  const channelName = `notesapp-local-${options.databaseName ?? defaultDatabaseName}`;
  const canBroadcast =
    typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined';
  const fallbackBus = !canBroadcast
    ? (fallbackBuses.get(channelName) ??
      (() => {
        const created: FallbackBus = { listeners: new Set(), stores: 0 };
        fallbackBuses.set(channelName, created);
        return created;
      })())
    : null;
  if (fallbackBus !== null) fallbackBus.stores += 1;
  const listeners =
    fallbackBus?.listeners ?? new Set<(change: LocalChange) => void>();
  const ownedListeners = new Set<(change: LocalChange) => void>();
  const channel = canBroadcast ? new BroadcastChannel(channelName) : null;
  let messagingClosed = false;
  const closeMessaging = (): void => {
    if (messagingClosed) return;
    messagingClosed = true;
    channel?.close();
    for (const listener of ownedListeners) listeners.delete(listener);
    ownedListeners.clear();
    if (fallbackBus !== null) {
      fallbackBus.stores -= 1;
      if (fallbackBus.stores === 0) fallbackBuses.delete(channelName);
    }
  };
  const notify = (change: LocalChange): void => {
    for (const listener of listeners) listener(change);
  };
  if (channel !== null)
    channel.onmessage = (event: MessageEvent<unknown>): void => {
      const change = localChangeOf(event.data);
      if (change === null) return;
      notify(change);
    };
  const publish = (change: LocalChange): void => {
    notify(change);
    channel?.postMessage(change);
  };
  const backend: {
    indexedDB?: IDBFactory;
    IDBKeyRange?: typeof IDBKeyRange;
  } = {};
  if (options.indexedDB !== undefined) backend.indexedDB = options.indexedDB;
  if (options.IDBKeyRange !== undefined)
    backend.IDBKeyRange = options.IDBKeyRange;
  const { db, tables } = createDatabase(
    options.databaseName ?? defaultDatabaseName,
    backend,
  );
  let deviceId: string;
  try {
    await guard('opening the local database', async () => {
      await db.open();
    });
    const schema = await guard('checking the local schema', () =>
      ensureSchema(tables, newId),
    );
    deviceId = options.deviceId ?? schema.meta.deviceId;
  } catch (error: unknown) {
    closeMessaging();
    db.close();
    throw error;
  }

  const ctx: LocalStoreContext = {
    serverOrigin,
    deviceId,
    db,
    tables,
    clock,
    newId,
    nowIso,
    publish,
  };

  const store: LocalStore = {
    serverOrigin,
    deviceId,

    subscribe(listener: (change: LocalChange) => void): () => void {
      listeners.add(listener);
      ownedListeners.add(listener);
      return () => {
        ownedListeners.delete(listener);
        listeners.delete(listener);
      };
    },

    ...createDraftsSlice(ctx),
    ...createVersionsSlice(ctx),
    ...createFileActionsSlice(ctx),
    ...createQueueSlice(ctx),
    ...createRecoverySlice(ctx),
    ...createPreferencesSlice(ctx),
    ...createFilesSlice(ctx),
    ...createSnapshotSlice(ctx),
    ...createLegacySlice(ctx),

    close(): Promise<void> {
      closeMessaging();
      db.close();
      return Promise.resolve();
    },
  };
  return store;
}
