/**
 * The IndexedDB implementation of the local persistence port.
 *
 * Two transaction boundaries matter, and they come from the design:
 *
 * - A draft save is one transaction over one table. The target is at most
 *   150 ms after input, so recovery state becomes durable promptly.
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
 */
import { contentDigest, generateUUID } from '@notesapp/core';
import type { AcceptedChangeset, ChangesetInput } from '@notesapp/core';
import {
  LocalStorageError,
  accountWide,
  shouldCheckpoint,
  type CheckpointRecord,
  type Draft,
  type FileSaveSnapshot,
  type LocalChange,
  type LocalAcceptedFile,
  type LocalCachedNote,
  type LocalConflict,
  type LocalFileSummary,
  type LocalStore,
  type QueueEntry,
  type RecoveryInput,
  type RecoveryRecord,
  type RemoteChange,
  type SnapshotRevision,
} from '@notesapp/sync';
import {
  createDatabase,
  defaultDatabaseName,
  guard,
  partitionRange,
  type CheckpointRow,
  type DraftRow,
  type FileRow,
  type QueueRow,
  type SnapshotItemRow,
} from './database.ts';
import {
  ensureSchema,
  validateAcceptedFile,
  validateCheckpoint,
  validateContent,
  validateCursor,
  validateDraft,
  validateLease,
  validatePreference,
  validateQueueRow,
  validateReceipt,
  validateRecovery,
  validateSnapshot,
  validateSnapshotItem,
} from './migrations.ts';

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

/** The number of UTF-8 bytes of a string. */
/**
 * Whether a working copy still describes the current state of its file.
 *
 * A draft is built on one revision: its last checkpoint, or the head it was
 * opened from. It leads whenever that anchor is still the accepted head, which
 * is the ordinary case of typing into a file that is in sync, and whenever
 * this device holds unsent work, whose local head is past the accepted one.
 *
 * It does not lead when the server moved the file past the anchor and nothing
 * local is pending. The accepted row is then the newer statement of the path
 * and of the deletion state, so a draft left over from an earlier deletion
 * cannot hide a note that the server brought back.
 */
function draftLeads(
  file: FileRow | null | undefined,
  draft: DraftRow,
): boolean {
  if (file === null || file === undefined) return true;
  if (file.acceptedHeadRevisionId === null) return true;
  const anchor = draft.lastCheckpointId ?? draft.baseRevisionId;
  if (file.acceptedHeadRevisionId === anchor) return true;
  return file.localHeadRevisionId !== file.acceptedHeadRevisionId;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

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
      const value = event.data;
      if (value === null || typeof value !== 'object') return;
      const row = value as Record<string, unknown>;
      if (
        typeof row['accountId'] !== 'string' ||
        typeof row['workspaceId'] !== 'string' ||
        (typeof row['fileId'] !== 'string' && row['fileId'] !== null) ||
        !['draft', 'queue', 'file', 'conflict', 'cursor', 'reset'].includes(
          String(row['kind']),
        )
      )
        return;
      notify(value as LocalChange);
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

  /** The stored form of a draft the caller supplied. */
  const draftRow = (
    draft: Draft,
    lastCheckpointId: string | null,
  ): DraftRow => ({
    serverOrigin,
    accountId: draft.accountId,
    workspaceId: draft.workspaceId,
    workingCopyId: draft.workingCopyId,
    fileId: draft.fileId,
    baseRevisionId: draft.baseRevisionId,
    text: draft.text,
    path: draft.path,
    deleted: draft.deleted,
    sequence: draft.sequence,
    lastCheckpointId,
    savedAt: nowIso(),
  });

  /** The editor view of a stored draft. */
  const draftOf = (row: DraftRow): Draft => ({
    accountId: row.accountId,
    workspaceId: row.workspaceId,
    workingCopyId: row.workingCopyId,
    fileId: row.fileId,
    baseRevisionId: row.baseRevisionId,
    text: row.text,
    path: row.path,
    deleted: row.deleted,
    sequence: row.sequence,
  });

  /** The public view of a stored checkpoint. */
  const checkpointOf = (row: CheckpointRow): CheckpointRecord => ({
    serverOrigin: row.serverOrigin,
    accountId: row.accountId,
    workspaceId: row.workspaceId,
    revisionId: row.revisionId,
    fileId: row.fileId,
    workingCopyId: row.workingCopyId,
    parents: row.parents,
    path: row.path,
    deleted: row.deleted,
    digest: row.digest,
    message: row.message,
    clientTime: row.clientTime,
    mutationId: row.mutationId,
    accepted: row.accepted,
  });

  /** The next submission order number of one partition. */
  const nextQueueSequence = async (
    accountId: string,
    workspaceId: string,
  ): Promise<number> => {
    const range = partitionRange(serverOrigin, accountId, workspaceId);
    const last: unknown = await tables.queue
      .where('[serverOrigin+accountId+workspaceId+sequence]')
      .between(range.lower, range.upper, true, true)
      .last();
    return last === undefined ? 1 : validateQueueRow(last).sequence + 1;
  };

  /** The next checkpoint order number of one partition. */
  const nextCheckpointSequence = async (
    accountId: string,
    workspaceId: string,
  ): Promise<number> => {
    const range = partitionRange(serverOrigin, accountId, workspaceId);
    const last: unknown = await tables.checkpoints
      .where('[serverOrigin+accountId+workspaceId+sequence]')
      .between(range.lower, range.upper, true, true)
      .last();
    return last === undefined ? 1 : validateCheckpoint(last).sequence + 1;
  };

  /** One queued mutation of one account, wherever its workspace is. */
  const queueEntryOf = async (
    accountId: string,
    mutationId: string,
  ): Promise<QueueRow | null> => {
    const stored: unknown = await tables.queue
      .where('[serverOrigin+accountId+mutationId]')
      .equals([serverOrigin, accountId, mutationId])
      .first();
    return stored === undefined ? null : validateQueueRow(stored);
  };

  /** Every stored draft of one file, newest first. */
  const draftsOfFile = async (
    accountId: string,
    workspaceId: string,
    fileId: string,
  ): Promise<DraftRow[]> => {
    const rows: unknown[] = await tables.drafts
      .where('[serverOrigin+accountId+workspaceId+fileId]')
      .equals([serverOrigin, accountId, workspaceId, fileId])
      .toArray();
    return rows
      .map((row: unknown) => validateDraft(row))
      .sort((left, right) => {
        if (left.savedAt !== right.savedAt)
          return left.savedAt < right.savedAt ? 1 : -1;
        if (left.sequence !== right.sequence)
          return right.sequence - left.sequence;
        return left.workingCopyId < right.workingCopyId ? 1 : -1;
      });
  };

  /** The stored Markdown body of one digest, or `null` when it is absent. */
  const bodyOfDigest = async (
    accountId: string,
    workspaceId: string,
    digest: string,
  ): Promise<string | null> => {
    const stored: unknown = await tables.contents.get([
      serverOrigin,
      accountId,
      workspaceId,
      digest,
    ]);
    if (stored === undefined) return null;
    return validateContent(stored).text;
  };

  /** One state of a file that a draft can be compared with. */
  type HeadState = {
    readonly path: string;
    readonly deleted: boolean;
    readonly text: string | null;
  };

  /** Whether one draft says something that neither head says. */
  const draftIsUnsentWork = (
    draft: DraftRow,
    heads: readonly HeadState[],
  ): boolean =>
    !heads.some(
      (head) =>
        head.text !== null &&
        draft.text === head.text &&
        draft.path === head.path &&
        draft.deleted === head.deleted,
    );

  /**
   * Whether a draft of one file holds work that no head of it holds.
   *
   * This is the second half of the dirty test. A local head that is ahead of
   * the accepted head is unsubmitted work, and so is a draft whose text, path
   * or deletion state neither the current accepted head nor the arriving one
   * contains. Without the draft half, an arriving head moves the local head
   * while the draft keeps shadowing it, and the person then edits stale text
   * with no notice.
   *
   * A draft that one of the two heads already contains is not work: the
   * arriving head either states it or supersedes it, so the file follows the
   * server and `readCachedNote` removes the draft on the next open.
   */
  const hasDivergentDraft = async (
    accountId: string,
    workspaceId: string,
    fileId: string,
    heads: readonly HeadState[],
  ): Promise<boolean> => {
    const drafts = await draftsOfFile(accountId, workspaceId, fileId);
    return drafts.some((draft) => draftIsUnsentWork(draft, heads));
  };

  /** The accepted state of one file as a comparable head. */
  const acceptedHeadState = async (
    accountId: string,
    workspaceId: string,
    file: FileRow | null,
  ): Promise<HeadState | null> => {
    if (file === null || file.acceptedHeadDigest === null) return null;
    return {
      path: file.path,
      deleted: file.deleted,
      text: await bodyOfDigest(accountId, workspaceId, file.acceptedHeadDigest),
    };
  };

  /**
   * One note as it reads with no draft applied.
   *
   * The local head wins over the accepted head, because an unsent checkpoint
   * is work this device already promised to send. Returns `null` when the
   * body this device would need is not stored, so the caller can fall back
   * to the server instead of showing an empty note.
   */
  const headNote = async (
    accountId: string,
    workspaceId: string,
    fileId: string,
    file: FileRow | null,
  ): Promise<LocalCachedNote | null> => {
    if (file === null || file.kind !== 'note') return null;
    const acceptedPath = file.path;
    const acceptedRevisionId = file.acceptedHeadRevisionId;
    if (file.deleted)
      return {
        fileId,
        path: file.path,
        text: '',
        deleted: true,
        sequence: 0,
        baseRevisionId: file.localHeadRevisionId,
        stale: false,
        acceptedText: null,
        acceptedPath,
        acceptedRevisionId,
      };
    const localHead = file.localHeadRevisionId;
    if (localHead !== null && localHead !== file.acceptedHeadRevisionId) {
      const storedCheckpoint: unknown = await tables.checkpoints.get([
        serverOrigin,
        accountId,
        workspaceId,
        localHead,
      ]);
      if (storedCheckpoint === undefined) return null;
      const checkpoint = validateCheckpoint(storedCheckpoint);
      if (checkpoint.deleted)
        return {
          fileId,
          path: checkpoint.path,
          text: '',
          deleted: true,
          sequence: 0,
          baseRevisionId: checkpoint.revisionId,
          stale: false,
          acceptedText: null,
          acceptedPath,
          acceptedRevisionId,
        };
      const body = await bodyOfDigest(
        accountId,
        workspaceId,
        checkpoint.digest,
      );
      if (body === null) return null;
      return {
        fileId,
        path: checkpoint.path,
        text: body,
        deleted: false,
        sequence: 0,
        baseRevisionId: checkpoint.revisionId,
        stale: false,
        acceptedText: null,
        acceptedPath,
        acceptedRevisionId,
      };
    }
    if (
      file.acceptedHeadRevisionId === null ||
      file.acceptedHeadDigest === null
    )
      return null;
    const body = await bodyOfDigest(
      accountId,
      workspaceId,
      file.acceptedHeadDigest,
    );
    if (body === null) return null;
    return {
      fileId,
      path: file.path,
      text: body,
      deleted: false,
      sequence: 0,
      baseRevisionId: file.acceptedHeadRevisionId,
      stale: false,
      acceptedText: null,
      acceptedPath,
      acceptedRevisionId,
    };
  };

  /**
   * Removes one draft that the accepted head already contains.
   *
   * The removal repeats the check inside its own write transaction: a
   * keystroke may have arrived between the read and this write, and that
   * newer text must survive.
   */
  const dropStaleDraft = async (
    accountId: string,
    workspaceId: string,
    draft: DraftRow,
  ): Promise<void> => {
    const removed = await guard('removing a matched draft', () =>
      db.transaction('rw', tables.drafts, async (): Promise<boolean> => {
        const stored: unknown = await tables.drafts.get([
          serverOrigin,
          accountId,
          workspaceId,
          draft.workingCopyId,
        ]);
        if (stored === undefined) return false;
        const current = validateDraft(stored);
        if (
          current.sequence !== draft.sequence ||
          current.text !== draft.text ||
          current.path !== draft.path ||
          current.deleted !== draft.deleted
        )
          return false;
        await tables.drafts.delete([
          serverOrigin,
          accountId,
          workspaceId,
          draft.workingCopyId,
        ]);
        return true;
      }),
    );
    if (removed)
      publish({
        accountId,
        workspaceId,
        fileId: draft.fileId,
        kind: 'draft',
      });
  };

  /** The key of the single sync worker lease row. */
  const leaseKey = 'worker';

  /** The account-wide preference that records an offline sign-out. */
  const signOutMarkerName = 'signout-marker';

  type AccountRow = {
    readonly serverOrigin: string;
    readonly accountId: string;
    readonly workspaceId: string;
  };

  /** Whether a stored row belongs to one account of this origin. */
  const matchesAccount = (row: AccountRow, accountId: string): boolean =>
    row.serverOrigin === serverOrigin && row.accountId === accountId;

  /** Whether a stored row belongs to one workspace partition. */
  const matchesPartition = (
    row: AccountRow,
    accountId: string,
    workspaceId: string,
  ): boolean =>
    row.serverOrigin === serverOrigin &&
    row.accountId === accountId &&
    row.workspaceId === workspaceId;

  /**
   * Forgets the cached metadata and working copies of one permanently deleted
   * file.
   *
   * The listing of the server can only say which files exist, so a cache
   * entry that the server dropped stays until something removes it. A purge
   * marker in the ordered change feed is that signal. The working copy goes
   * with the metadata, because a draft carries the path and the deletion state
   * of the file and would otherwise keep the note in the file tree.
   *
   * The call runs inside the transaction of its caller, which must cover the
   * accepted files and the drafts.
   */
  const forgetFile = async (
    accountId: string,
    workspaceId: string,
    fileId: string,
  ): Promise<void> => {
    await tables.acceptedFiles.delete([
      serverOrigin,
      accountId,
      workspaceId,
      fileId,
    ]);
    for (const row of await tables.drafts.toArray()) {
      const parsed = validateDraft(row);
      if (
        matchesPartition(parsed, accountId, workspaceId) &&
        parsed.fileId === fileId
      )
        await tables.drafts.delete([
          parsed.serverOrigin,
          parsed.accountId,
          parsed.workspaceId,
          parsed.workingCopyId,
        ]);
    }
  };

  /** Deletes every private row of one workspace partition. */
  const clearWorkspacePartition = async (
    accountId: string,
    workspaceId: string,
  ): Promise<void> => {
    for (const row of await tables.drafts.toArray()) {
      const parsed = validateDraft(row);
      if (matchesPartition(parsed, accountId, workspaceId))
        await tables.drafts.delete([
          parsed.serverOrigin,
          parsed.accountId,
          parsed.workspaceId,
          parsed.workingCopyId,
        ]);
    }
    for (const row of await tables.checkpoints.toArray()) {
      const parsed = validateCheckpoint(row);
      if (matchesPartition(parsed, accountId, workspaceId))
        await tables.checkpoints.delete([
          parsed.serverOrigin,
          parsed.accountId,
          parsed.workspaceId,
          parsed.revisionId,
        ]);
    }
    for (const row of await tables.contents.toArray()) {
      const parsed = validateContent(row);
      if (matchesPartition(parsed, accountId, workspaceId))
        await tables.contents.delete([
          parsed.serverOrigin,
          parsed.accountId,
          parsed.workspaceId,
          parsed.digest,
        ]);
    }
    for (const row of await tables.acceptedFiles.toArray()) {
      const parsed = validateAcceptedFile(row);
      if (matchesPartition(parsed, accountId, workspaceId))
        await tables.acceptedFiles.delete([
          parsed.serverOrigin,
          parsed.accountId,
          parsed.workspaceId,
          parsed.fileId,
        ]);
    }
    for (const row of await tables.queue.toArray()) {
      const parsed = validateQueueRow(row);
      if (matchesPartition(parsed, accountId, workspaceId))
        await tables.queue.delete([
          parsed.serverOrigin,
          parsed.accountId,
          parsed.workspaceId,
          parsed.mutationId,
        ]);
    }
    for (const row of await tables.receipts.toArray()) {
      const parsed = validateReceipt(row);
      if (matchesPartition(parsed, accountId, workspaceId))
        await tables.receipts.delete([
          parsed.serverOrigin,
          parsed.accountId,
          parsed.workspaceId,
          parsed.mutationId,
        ]);
    }
    for (const row of await tables.stagedSnapshots.toArray()) {
      const parsed = validateSnapshot(row);
      if (matchesPartition(parsed, accountId, workspaceId))
        await tables.stagedSnapshots.delete([
          parsed.serverOrigin,
          parsed.accountId,
          parsed.workspaceId,
          parsed.token,
        ]);
    }
    for (const row of await tables.snapshotItems.toArray()) {
      const parsed = validateSnapshotItem(row);
      if (matchesPartition(parsed, accountId, workspaceId))
        await tables.snapshotItems.delete([
          parsed.serverOrigin,
          parsed.accountId,
          parsed.workspaceId,
          parsed.token,
          parsed.revisionId,
        ]);
    }
    await tables.cursors.delete([serverOrigin, accountId, workspaceId]);
    for (const row of await tables.recovery.toArray()) {
      const parsed = validateRecovery(row);
      if (matchesPartition(parsed, accountId, workspaceId))
        await tables.recovery.delete([
          parsed.serverOrigin,
          parsed.accountId,
          parsed.workspaceId,
          parsed.recoveryId,
        ]);
    }
    // Workspace preferences go, but the account-wide sign-out marker stays:
    // reconnect must see it before any private content is restored.
    for (const row of await tables.preferences.toArray()) {
      const parsed = validatePreference(row);
      if (!matchesPartition(parsed, accountId, workspaceId)) continue;
      if (
        parsed.workspaceId === accountWide &&
        parsed.name === signOutMarkerName
      )
        continue;
      await tables.preferences.delete([
        parsed.serverOrigin,
        parsed.accountId,
        parsed.workspaceId,
        parsed.name,
      ]);
    }
  };

  /** Deletes every workspace partition of one account, keeping the marker. */
  const clearAccountPartition = async (
    accountId: string,
  ): Promise<readonly string[]> => {
    const workspaces = new Set<string>();
    const collect = (row: AccountRow): void => {
      if (matchesAccount(row, accountId)) workspaces.add(row.workspaceId);
    };
    for (const row of await tables.drafts.toArray())
      collect(validateDraft(row));
    for (const row of await tables.checkpoints.toArray())
      collect(validateCheckpoint(row));
    for (const row of await tables.contents.toArray())
      collect(validateContent(row));
    for (const row of await tables.acceptedFiles.toArray())
      collect(validateAcceptedFile(row));
    for (const row of await tables.queue.toArray())
      collect(validateQueueRow(row));
    for (const row of await tables.receipts.toArray())
      collect(validateReceipt(row));
    for (const row of await tables.stagedSnapshots.toArray())
      collect(validateSnapshot(row));
    for (const row of await tables.snapshotItems.toArray())
      collect(validateSnapshotItem(row));
    for (const row of await tables.cursors.toArray())
      collect(validateCursor(row));
    for (const row of await tables.recovery.toArray())
      collect(validateRecovery(row));
    for (const row of await tables.preferences.toArray())
      collect(validatePreference(row));
    workspaces.delete(accountWide);
    for (const workspaceId of workspaces)
      await clearWorkspacePartition(accountId, workspaceId);
    // Any leftover account-wide preference other than the marker goes too.
    for (const row of await tables.preferences.toArray()) {
      const parsed = validatePreference(row);
      if (!matchesAccount(parsed, accountId)) continue;
      if (
        parsed.workspaceId === accountWide &&
        parsed.name === signOutMarkerName
      )
        continue;
      if (parsed.workspaceId !== accountWide) continue;
      await tables.preferences.delete([
        parsed.serverOrigin,
        parsed.accountId,
        parsed.workspaceId,
        parsed.name,
      ]);
    }
    return [...workspaces];
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

    async saveDraft(draft: Draft): Promise<void> {
      await guard('saving a draft', () =>
        db.transaction('rw', tables.drafts, async () => {
          const stored: unknown = await tables.drafts.get([
            serverOrigin,
            draft.accountId,
            draft.workspaceId,
            draft.workingCopyId,
          ]);
          const current = stored === undefined ? null : validateDraft(stored);
          // A save that arrives after a newer one must not undo it.
          if (current !== null && current.sequence > draft.sequence) return;
          await tables.drafts.put(
            draftRow(draft, current?.lastCheckpointId ?? null),
          );
        }),
      );
      publish({
        accountId: draft.accountId,
        workspaceId: draft.workspaceId,
        fileId: draft.fileId,
        kind: 'draft',
      });
    },

    readDraft(
      accountId: string,
      workspaceId: string,
      workingCopyId: string,
    ): Promise<Draft | null> {
      return guard('reading a draft', () =>
        db.transaction('r', tables.drafts, async () => {
          const stored: unknown = await tables.drafts.get([
            serverOrigin,
            accountId,
            workspaceId,
            workingCopyId,
          ]);
          return stored === undefined ? null : draftOf(validateDraft(stored));
        }),
      );
    },

    async checkpoint(
      draft: Draft,
      message: string | null,
    ): Promise<QueueEntry | null> {
      // A tombstone carries no text. The revision before it still holds the
      // content of the note, and a deletion that submitted Markdown would add
      // content while it claims to remove a file, which the server refuses.
      const revisionText = draft.deleted ? '' : draft.text;
      // The digest is computed before the transaction. WebCrypto is not a
      // database promise, so awaiting it inside a Dexie transaction would
      // leave the transaction zone and the transaction would already be gone.
      // A browser without WebCrypto cannot address content, so the caller
      // receives the same typed failure as for a refused write.
      const digest = await guard('creating a checkpoint', () =>
        contentDigest(revisionText),
      );
      const clientTime = nowIso();
      const revisionId = newId();
      const mutationId = newId();
      const created = await guard('creating a checkpoint', () =>
        db.transaction(
          'rw',
          [
            tables.drafts,
            tables.checkpoints,
            tables.contents,
            tables.acceptedFiles,
            tables.queue,
          ],
          async (): Promise<QueueEntry | null> => {
            const { accountId, workspaceId, fileId } = draft;
            const storedDraft: unknown = await tables.drafts.get([
              serverOrigin,
              accountId,
              workspaceId,
              draft.workingCopyId,
            ]);
            const current =
              storedDraft === undefined ? null : validateDraft(storedDraft);
            // A caller that supplies an older buffer than the stored draft
            // would commit older text as an immutable version. The write is
            // refused, so the newer draft stays intact and the caller can
            // flush it and try again.
            if (current !== null && current.sequence > draft.sequence)
              throw new LocalStorageError(
                'stale',
                'a newer draft of this working copy is stored',
              );
            const storedFile: unknown = await tables.acceptedFiles.get([
              serverOrigin,
              accountId,
              workspaceId,
              fileId,
            ]);
            const file =
              storedFile === undefined
                ? null
                : validateAcceptedFile(storedFile);

            const lastCheckpointId = current?.lastCheckpointId ?? null;
            let previous: {
              digest: string;
              path: string;
              deleted: boolean;
            } | null = null;
            if (lastCheckpointId !== null) {
              const stored: unknown = await tables.checkpoints.get([
                serverOrigin,
                accountId,
                workspaceId,
                lastCheckpointId,
              ]);
              if (stored !== undefined) previous = validateCheckpoint(stored);
            }
            // A working copy that has not checkpointed yet is compared with
            // the accepted head it started from, so opening a file and leaving
            // it writes nothing.
            if (
              previous === null &&
              file !== null &&
              file.acceptedHeadDigest !== null &&
              file.acceptedHeadRevisionId ===
                (lastCheckpointId ?? draft.baseRevisionId)
            )
              previous = {
                digest: file.acceptedHeadDigest,
                path: file.path,
                deleted: file.deleted,
              };

            if (
              !shouldCheckpoint(
                previous,
                { digest, path: draft.path, deleted: draft.deleted },
                message,
              )
            )
              return null;

            const parentId = lastCheckpointId ?? draft.baseRevisionId;
            const parents = parentId === null ? [] : [parentId];
            await tables.contents.put({
              serverOrigin,
              accountId,
              workspaceId,
              digest,
              text: revisionText,
              bytes: null,
              size: byteLength(revisionText),
            });
            const checkpoint: CheckpointRow = {
              serverOrigin,
              accountId,
              workspaceId,
              revisionId,
              fileId,
              workingCopyId: draft.workingCopyId,
              parents,
              path: draft.path,
              deleted: draft.deleted,
              digest,
              message,
              clientTime,
              mutationId,
              accepted: false,
              sequence: await nextCheckpointSequence(accountId, workspaceId),
            };
            // `add` and not `put`: a checkpoint is immutable, so writing over
            // an existing identifier is a defect, not an update.
            await tables.checkpoints.add(checkpoint);

            const nextFile: FileRow = {
              serverOrigin,
              accountId,
              workspaceId,
              fileId,
              kind: file?.kind ?? 'note',
              path: draft.path,
              deleted: draft.deleted,
              acceptedHeadRevisionId: file?.acceptedHeadRevisionId ?? null,
              acceptedHeadDigest: file?.acceptedHeadDigest ?? null,
              localHeadRevisionId: revisionId,
              updatedAt: clientTime,
            };
            await tables.acceptedFiles.put(nextFile);
            const input: ChangesetInput = {
              workspaceId,
              mutationId,
              deviceId,
              // The accepted head known locally. `null` states that the server
              // must not have this file yet.
              expectedHeads: { [fileId]: file?.acceptedHeadRevisionId ?? null },
              revisions: [
                {
                  id: revisionId,
                  fileId,
                  parents,
                  path: draft.path,
                  deleted: draft.deleted,
                  content: { kind: 'markdown', digest, text: revisionText },
                  clientTime,
                  message,
                  restoredFrom: null,
                },
              ],
            };
            await tables.queue.add({
              serverOrigin,
              accountId,
              workspaceId,
              mutationId,
              sequence: await nextQueueSequence(accountId, workspaceId),
              input,
              state: 'pending',
              digest: null,
              errorCode: null,
              createdAt: clientTime,
            });

            await tables.drafts.put({
              ...draftRow(draft, lastCheckpointId),
              lastCheckpointId: revisionId,
              savedAt: clientTime,
            });
            return {
              accountId,
              input,
              state: 'pending',
              digest: null,
              errorCode: null,
            };
          },
        ),
      );
      if (created !== null)
        publish({
          accountId: draft.accountId,
          workspaceId: draft.workspaceId,
          fileId: draft.fileId,
          kind: 'queue',
        });
      return created;
    },

    pending(
      accountId: string,
      workspaceId: string,
    ): Promise<readonly QueueEntry[]> {
      return guard('reading the queue', () =>
        db.transaction('r', tables.queue, async () => {
          const range = partitionRange(serverOrigin, accountId, workspaceId);
          const rows: unknown[] = await tables.queue
            .where('[serverOrigin+accountId+workspaceId+sequence]')
            .between(range.lower, range.upper, true, true)
            .toArray();
          return rows
            .map((row: unknown) => validateQueueRow(row))
            .map((row) => ({
              accountId: row.accountId,
              input: row.input,
              state: row.state,
              digest: row.digest,
              errorCode: row.errorCode,
            }));
        }),
      );
    },

    async markSending(
      accountId: string,
      mutationId: string,
      digest: string,
    ): Promise<void> {
      const changes: LocalChange[] = [];
      await guard('marking a mutation as sending', () =>
        db.transaction('rw', tables.queue, async () => {
          const entry = await queueEntryOf(accountId, mutationId);
          if (entry === null) return;
          // The digest freezes on the first send. A retry repeats the same
          // operation, so a later value would describe a different request.
          await tables.queue.put({
            ...entry,
            state: 'sending',
            digest: entry.digest ?? digest,
          });
          changes.push({
            accountId,
            workspaceId: entry.workspaceId,
            fileId: entry.input.revisions[0]?.fileId ?? null,
            kind: 'queue',
          });
        }),
      );
      for (const change of changes) publish(change);
    },

    async markConflict(
      accountId: string,
      mutationId: string,
      details,
    ): Promise<void> {
      const changes: LocalChange[] = [];
      await guard('marking a mutation as conflicting', () =>
        db.transaction('rw', tables.queue, async () => {
          const entry = await queueEntryOf(accountId, mutationId);
          if (entry === null) return;
          await tables.queue.put({
            ...entry,
            state: 'conflict',
            errorCode: details?.errorCode ?? entry.errorCode,
          });
          changes.push({
            accountId,
            workspaceId: entry.workspaceId,
            fileId: entry.input.revisions[0]?.fileId ?? null,
            kind: 'queue',
          });
        }),
      );
      for (const change of changes) publish(change);
    },

    async discardQueueEntry(
      accountId: string,
      mutationId: string,
    ): Promise<void> {
      const changes: LocalChange[] = [];
      await guard('discarding a queued mutation', () =>
        db.transaction(
          'rw',
          [tables.queue, tables.checkpoints, tables.acceptedFiles],
          async () => {
            const entry = await queueEntryOf(accountId, mutationId);
            if (entry === null) return;
            const workspaceId = entry.workspaceId;
            await tables.queue.delete([
              serverOrigin,
              accountId,
              workspaceId,
              entry.mutationId,
            ]);
            const rows: unknown[] = await tables.checkpoints
              .where('[serverOrigin+accountId+workspaceId+mutationId]')
              .equals([serverOrigin, accountId, workspaceId, entry.mutationId])
              .toArray();
            for (const row of rows) {
              const checkpoint = validateCheckpoint(row);
              await tables.checkpoints.delete([
                serverOrigin,
                accountId,
                workspaceId,
                checkpoint.revisionId,
              ]);
            }
            // The tip of the discarded mutation decides what it had set on the
            // file row: a tombstone tip set the deletion flag, and every tip
            // set the local head.
            const tips = new Map<string, boolean>();
            for (const revision of entry.input.revisions)
              tips.set(revision.fileId, revision.deleted);
            for (const [fileId, wasDeletion] of tips) {
              const stored: unknown = await tables.acceptedFiles.get([
                serverOrigin,
                accountId,
                workspaceId,
                fileId,
              ]);
              if (stored !== undefined) {
                const file = validateAcceptedFile(stored);
                await tables.acceptedFiles.put({
                  ...file,
                  deleted: wasDeletion ? false : file.deleted,
                  localHeadRevisionId: file.acceptedHeadRevisionId,
                  updatedAt: nowIso(),
                });
              }
              changes.push({
                accountId,
                workspaceId,
                fileId,
                kind: 'file',
              });
            }
            changes.push({
              accountId,
              workspaceId,
              fileId: entry.input.revisions[0]?.fileId ?? null,
              kind: 'queue',
            });
          },
        ),
      );
      for (const change of changes) publish(change);
    },

    async reparentQueueEntry(
      accountId: string,
      mutationId: string,
      expectedHeads: Readonly<Record<string, string | null>>,
    ): Promise<QueueEntry | null> {
      const changes: LocalChange[] = [];
      const moved = await guard('reparenting a queued mutation', () =>
        db.transaction('rw', tables.queue, async () => {
          const entry = await queueEntryOf(accountId, mutationId);
          if (entry === null) return null;
          // A sent mutation froze its body. Rewriting it would describe a
          // request that the frozen digest does not cover.
          if (entry.state === 'conflict') return null;
          const next: QueueRow = {
            ...entry,
            state: 'pending',
            digest: null,
            input: {
              ...entry.input,
              expectedHeads: { ...entry.input.expectedHeads, ...expectedHeads },
            },
          };
          await tables.queue.put(next);
          changes.push({
            accountId,
            workspaceId: entry.workspaceId,
            fileId: entry.input.revisions[0]?.fileId ?? null,
            kind: 'queue',
          });
          return {
            accountId: next.accountId,
            input: next.input,
            state: next.state,
            digest: next.digest,
            errorCode: next.errorCode,
          };
        }),
      );
      for (const change of changes) publish(change);
      return moved;
    },

    async acknowledge(
      accountId: string,
      result: AcceptedChangeset,
    ): Promise<void> {
      const changes: LocalChange[] = [];
      await guard('acknowledging a mutation', () =>
        db.transaction(
          'rw',
          [
            tables.queue,
            tables.checkpoints,
            tables.acceptedFiles,
            tables.receipts,
          ],
          async () => {
            const entry = await queueEntryOf(accountId, result.mutationId);
            // The queue entry is gone, so this answer was already applied.
            // Repeating it must change nothing.
            if (entry === null) return;
            const workspaceId = entry.workspaceId;
            for (const revision of entry.input.revisions)
              changes.push({
                accountId,
                workspaceId: entry.workspaceId,
                fileId: revision.fileId,
                kind: 'file',
              });
            await tables.queue.delete([
              serverOrigin,
              accountId,
              workspaceId,
              entry.mutationId,
            ]);
            const rows: unknown[] = await tables.checkpoints
              .where('[serverOrigin+accountId+workspaceId+mutationId]')
              .equals([serverOrigin, accountId, workspaceId, entry.mutationId])
              .toArray();
            const range = partitionRange(serverOrigin, accountId, workspaceId);
            const laterQueue = (
              await tables.queue
                .where('[serverOrigin+accountId+workspaceId+sequence]')
                .between(range.lower, range.upper, true, true)
                .toArray()
            )
              .map((row: unknown) => validateQueueRow(row))
              .filter((row) => row.sequence > entry.sequence);
            const rebasedQueue = new Map<string, QueueRow>();
            const accepted = new Set(result.revisionIds);
            const newest = new Map<string, CheckpointRow>();
            for (const row of rows) {
              const checkpoint = validateCheckpoint(row);
              if (!accepted.has(checkpoint.revisionId)) continue;
              await tables.checkpoints.put({ ...checkpoint, accepted: true });
              const seen = newest.get(checkpoint.fileId);
              if (seen === undefined || checkpoint.sequence > seen.sequence)
                newest.set(checkpoint.fileId, checkpoint);
            }
            for (const [fileId, checkpoint] of newest) {
              const stored: unknown = await tables.acceptedFiles.get([
                serverOrigin,
                accountId,
                workspaceId,
                fileId,
              ]);
              const file =
                stored === undefined ? null : validateAcceptedFile(stored);
              const previousAcceptedHead = file?.acceptedHeadRevisionId ?? null;
              // Only the accepted head moves. The local head, the path, and
              // the deletion state keep whatever later local work set, so a
              // checkpoint created after the submission survives.
              await tables.acceptedFiles.put({
                serverOrigin,
                accountId,
                workspaceId,
                fileId,
                kind: file?.kind ?? 'note',
                path: file?.path ?? checkpoint.path,
                deleted: file?.deleted ?? checkpoint.deleted,
                acceptedHeadRevisionId: checkpoint.revisionId,
                acceptedHeadDigest: checkpoint.digest,
                localHeadRevisionId:
                  file?.localHeadRevisionId ?? checkpoint.revisionId,
                updatedAt: nowIso(),
              });

              // The first later mutation of this file can be a child that was
              // queued while this request was in flight. Its body is still
              // mutable only while it is pending and has no frozen digest.
              // Advance that child's precondition with its accepted parent so
              // the file does not conflict with its own ordered checkpoints.
              const storedSuccessor = laterQueue.find((row) =>
                row.input.revisions.some(
                  (revision) => revision.fileId === fileId,
                ),
              );
              if (storedSuccessor === undefined) continue;
              const successor =
                rebasedQueue.get(storedSuccessor.mutationId) ?? storedSuccessor;
              const directlyFollows = successor.input.revisions.some(
                (revision) =>
                  revision.fileId === fileId &&
                  revision.parents.includes(checkpoint.revisionId),
              );
              if (
                successor.state !== 'pending' ||
                successor.digest !== null ||
                successor.input.expectedHeads[fileId] !==
                  previousAcceptedHead ||
                !directlyFollows
              )
                continue;
              rebasedQueue.set(successor.mutationId, {
                ...successor,
                input: {
                  ...successor.input,
                  expectedHeads: {
                    ...successor.input.expectedHeads,
                    [fileId]: checkpoint.revisionId,
                  },
                },
              });
            }
            for (const row of rebasedQueue.values())
              await tables.queue.put(row);
            await tables.receipts.put({
              serverOrigin,
              accountId,
              workspaceId,
              mutationId: entry.mutationId,
              revisionIds: [...result.revisionIds],
              cursor: result.cursor,
              acknowledgedAt: nowIso(),
            });
          },
        ),
      );
      for (const change of changes) publish(change);
    },

    listCheckpoints(
      accountId: string,
      workspaceId: string,
      fileId: string,
    ): Promise<readonly CheckpointRecord[]> {
      return guard('reading local history', () =>
        db.transaction('r', tables.checkpoints, async () => {
          const rows: unknown[] = await tables.checkpoints
            .where('[serverOrigin+accountId+workspaceId+fileId]')
            .equals([serverOrigin, accountId, workspaceId, fileId])
            .toArray();
          return rows
            .map((row: unknown) => validateCheckpoint(row))
            .sort((left, right) => left.sequence - right.sequence)
            .map(checkpointOf);
        }),
      );
    },

    recover(
      accountId: string,
      workspaceId: string,
    ): Promise<readonly RecoveryRecord[]> {
      return guard('reading the recovery area', () =>
        db.transaction('r', tables.recovery, async () => {
          const range = partitionRange(serverOrigin, accountId, workspaceId);
          const rows: unknown[] = await tables.recovery
            .where('[serverOrigin+accountId+workspaceId+createdAt]')
            .between(range.lower, range.upper, true, true)
            .toArray();
          return rows.map((row: unknown) => validateRecovery(row));
        }),
      );
    },

    async addRecovery(
      accountId: string,
      workspaceId: string,
      entry: RecoveryInput,
    ): Promise<RecoveryRecord> {
      const record = await guard('keeping a recovery copy', () =>
        db.transaction('rw', tables.recovery, async () => {
          if (entry.fileId === '' || entry.path === '')
            throw new LocalStorageError(
              'corrupt',
              'the recovery copy names no file',
            );
          const record: RecoveryRecord = {
            serverOrigin,
            accountId,
            workspaceId,
            recoveryId: entry.recoveryId ?? newId(),
            fileId: entry.fileId,
            path: entry.path,
            text: entry.text,
            reason: entry.reason,
            code: entry.code ?? null,
            mutationId: entry.mutationId ?? null,
            createdAt: entry.createdAt ?? nowIso(),
          };
          await tables.recovery.put(validateRecovery(record));
          return record;
        }),
      );
      // The Needs attention list reads this table, so a kept copy is a
      // durable change that other views must learn about.
      publish({
        accountId,
        workspaceId,
        fileId: record.fileId,
        kind: 'conflict',
      });
      return record;
    },

    async removeRecovery(
      accountId: string,
      workspaceId: string,
      recoveryId: string,
    ): Promise<void> {
      const removed = await guard('removing a recovery copy', () =>
        db.transaction(
          'rw',
          tables.recovery,
          async (): Promise<string | null> => {
            const stored: unknown = await tables.recovery.get([
              serverOrigin,
              accountId,
              workspaceId,
              recoveryId,
            ]);
            if (stored === undefined) return null;
            const record = validateRecovery(stored);
            await tables.recovery.delete([
              serverOrigin,
              accountId,
              workspaceId,
              recoveryId,
            ]);
            return record.fileId;
          },
        ),
      );
      if (removed === null) return;
      publish({ accountId, workspaceId, fileId: removed, kind: 'conflict' });
    },

    listAcceptedFiles(
      accountId: string,
      workspaceId: string,
    ): Promise<readonly LocalAcceptedFile[]> {
      return guard('reading accepted files', () =>
        db.transaction('r', tables.acceptedFiles, async () => {
          const range = partitionRange(serverOrigin, accountId, workspaceId);
          const rows: unknown[] = await tables.acceptedFiles
            .where('[serverOrigin+accountId+workspaceId+fileId]')
            .between(range.lower, range.upper, true, true)
            .toArray();
          return rows
            .map((row: unknown) => validateAcceptedFile(row))
            .sort((left, right) => (left.path < right.path ? -1 : 1));
        }),
      );
    },

    listLocalFiles(
      accountId: string,
      workspaceId: string,
    ): Promise<readonly LocalFileSummary[]> {
      return guard('reading local files', () =>
        db.transaction('r', [tables.acceptedFiles, tables.drafts], async () => {
          const range = partitionRange(serverOrigin, accountId, workspaceId);
          const acceptedRows: unknown[] = await tables.acceptedFiles
            .where('[serverOrigin+accountId+workspaceId+fileId]')
            .between(range.lower, range.upper, true, true)
            .toArray();
          const draftRows: unknown[] = await tables.drafts.toArray();
          const result = new Map<string, LocalFileSummary>();
          const accepted = new Map<string, FileRow>();
          for (const raw of acceptedRows) {
            const file = validateAcceptedFile(raw);
            accepted.set(file.fileId, file);
            result.set(file.fileId, {
              fileId: file.fileId,
              path: file.path,
              kind: file.kind,
              deleted: file.deleted,
              updatedAt: file.updatedAt,
              acceptedHeadRevisionId: file.acceptedHeadRevisionId,
              localHeadRevisionId: file.localHeadRevisionId,
              localOnly: file.acceptedHeadRevisionId === null,
            });
          }
          const newestDrafts = new Map<string, DraftRow>();
          for (const raw of draftRows) {
            const draft = validateDraft(raw);
            if (!matchesPartition(draft, accountId, workspaceId)) continue;
            const previous = newestDrafts.get(draft.fileId);
            if (
              previous === undefined ||
              draft.savedAt > previous.savedAt ||
              (draft.savedAt === previous.savedAt &&
                draft.sequence > previous.sequence)
            )
              newestDrafts.set(draft.fileId, draft);
          }
          for (const draft of newestDrafts.values()) {
            const known = result.get(draft.fileId);
            if (!draftLeads(accepted.get(draft.fileId), draft)) continue;
            result.set(draft.fileId, {
              fileId: draft.fileId,
              path: draft.path,
              kind: known?.kind ?? 'note',
              deleted: draft.deleted,
              updatedAt: draft.savedAt,
              acceptedHeadRevisionId: known?.acceptedHeadRevisionId ?? null,
              localHeadRevisionId:
                known?.localHeadRevisionId ?? draft.lastCheckpointId,
              localOnly: known?.acceptedHeadRevisionId == null,
            });
          }
          return [...result.values()].sort((left, right) =>
            left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
          );
        }),
      );
    },

    readFileSaveSnapshot(
      accountId: string,
      workspaceId: string,
      fileId: string,
    ): Promise<FileSaveSnapshot> {
      return guard('reading file save state', () =>
        db.transaction(
          'r',
          [
            tables.acceptedFiles,
            tables.drafts,
            tables.checkpoints,
            tables.contents,
            tables.queue,
          ],
          async () => {
            const draftRows: unknown[] = await tables.drafts
              .where('[serverOrigin+accountId+workspaceId+fileId]')
              .equals([serverOrigin, accountId, workspaceId, fileId])
              .toArray();
            const draft = draftRows
              .map((row: unknown) => validateDraft(row))
              .sort((left, right) =>
                left.savedAt < right.savedAt
                  ? 1
                  : left.savedAt > right.savedAt
                    ? -1
                    : right.sequence - left.sequence,
              )[0];
            const queueRows: unknown[] = await tables.queue
              .where('[serverOrigin+accountId+workspaceId+sequence]')
              .between(
                partitionRange(serverOrigin, accountId, workspaceId).lower,
                partitionRange(serverOrigin, accountId, workspaceId).upper,
                true,
                true,
              )
              .toArray();
            const queue = queueRows
              .map((row: unknown) => validateQueueRow(row))
              .filter((row) =>
                row.input.revisions.some(
                  (revision) => revision.fileId === fileId,
                ),
              )
              .at(-1);
            const storedFile: unknown = await tables.acceptedFiles.get([
              serverOrigin,
              accountId,
              workspaceId,
              fileId,
            ]);
            const file =
              storedFile === undefined
                ? null
                : validateAcceptedFile(storedFile);
            let hasUncheckpointedDraft = draft !== undefined;
            if (draft?.lastCheckpointId !== null && draft !== undefined) {
              const storedCheckpoint: unknown = await tables.checkpoints.get([
                serverOrigin,
                accountId,
                workspaceId,
                draft.lastCheckpointId,
              ]);
              if (storedCheckpoint !== undefined) {
                const checkpoint = validateCheckpoint(storedCheckpoint);
                const storedContent: unknown = await tables.contents.get([
                  serverOrigin,
                  accountId,
                  workspaceId,
                  checkpoint.digest,
                ]);
                const content =
                  storedContent === undefined
                    ? null
                    : validateContent(storedContent);
                hasUncheckpointedDraft =
                  content?.text !== draft.text ||
                  checkpoint.path !== draft.path ||
                  checkpoint.deleted !== draft.deleted;
              } else if (
                file?.acceptedHeadRevisionId === draft.lastCheckpointId &&
                file.acceptedHeadDigest !== null
              ) {
                const storedContent: unknown = await tables.contents.get([
                  serverOrigin,
                  accountId,
                  workspaceId,
                  file.acceptedHeadDigest,
                ]);
                const content =
                  storedContent === undefined
                    ? null
                    : validateContent(storedContent);
                hasUncheckpointedDraft =
                  content?.text !== draft.text ||
                  file.path !== draft.path ||
                  file.deleted !== draft.deleted;
              }
            }
            return {
              fileId,
              latestDraftSequence: draft?.sequence ?? null,
              latestMutationId: queue?.mutationId ?? null,
              queueState: queue?.state ?? null,
              acceptedHeadRevisionId: file?.acceptedHeadRevisionId ?? null,
              localHeadRevisionId: file?.localHeadRevisionId ?? null,
              hasUncheckpointedDraft,
            };
          },
        ),
      );
    },

    listLocalConflicts(
      accountId: string,
      workspaceId: string,
    ): Promise<readonly LocalConflict[]> {
      return this.pending(accountId, workspaceId).then((entries) =>
        entries
          .filter((entry) => entry.state === 'conflict')
          .flatMap((entry) =>
            entry.input.revisions.map((revision) => ({
              accountId: entry.accountId,
              fileId: revision.fileId,
              mutationId: entry.input.mutationId,
              input: entry.input,
              errorCode: entry.errorCode,
            })),
          ),
      );
    },

    async readCachedNote(
      accountId: string,
      workspaceId: string,
      fileId: string,
    ): Promise<LocalCachedNote | null> {
      // The read runs first and alone. A digest of the draft text may be
      // needed to compare it with the accepted head, and WebCrypto is not a
      // database promise: awaiting it inside a Dexie transaction would leave
      // the transaction zone. So the comparison and any removal follow the
      // read in their own steps.
      const snapshot = await guard('reading a cached note', () =>
        db.transaction(
          'r',
          [
            tables.acceptedFiles,
            tables.checkpoints,
            tables.contents,
            tables.drafts,
          ],
          async () => {
            const drafts = await draftsOfFile(accountId, workspaceId, fileId);
            const draft = drafts[0] ?? null;
            const storedFile: unknown = await tables.acceptedFiles.get([
              serverOrigin,
              accountId,
              workspaceId,
              fileId,
            ]);
            const file =
              storedFile === undefined
                ? null
                : validateAcceptedFile(storedFile);
            const acceptedText =
              file === null || file.acceptedHeadDigest === null
                ? null
                : await bodyOfDigest(
                    accountId,
                    workspaceId,
                    file.acceptedHeadDigest,
                  );
            // A head this device created has a checkpoint row. A head that
            // has none came from the server, so it is the one that can leave
            // a draft behind. Without this test a queued save of this device
            // would read as a newer version of somebody else.
            const acceptedIsLocal =
              file === null || file.acceptedHeadRevisionId === null
                ? false
                : (await tables.checkpoints.get([
                    serverOrigin,
                    accountId,
                    workspaceId,
                    file.acceptedHeadRevisionId,
                  ])) !== undefined;
            const accepted = {
              revisionId: file?.acceptedHeadRevisionId ?? null,
              digest: file?.acceptedHeadDigest ?? null,
              path: file === null ? null : file.path,
              deleted: file?.deleted ?? false,
              text: acceptedText,
              isLocal: acceptedIsLocal,
            };
            const head = await headNote(accountId, workspaceId, fileId, file);
            const leads = draft === null ? false : draftLeads(file, draft);
            return { draft, accepted, head, leads };
          },
        ),
      );

      const draft = snapshot.draft;
      if (draft === null) return snapshot.head;
      const accepted = snapshot.accepted;
      const draftBase = draft.lastCheckpointId ?? draft.baseRevisionId;

      // A draft that says nothing the accepted head does not already say is
      // recovery data with nothing left to recover. It is removed, so one
      // keystroke cannot shadow newer server text for the life of the
      // device. A pending rename or deletion is never treated as equal.
      if (
        accepted.digest !== null &&
        !draft.deleted &&
        draft.path === accepted.path
      ) {
        const equal =
          accepted.text !== null
            ? accepted.text === draft.text
            : (await guard('reading a cached note', () =>
                contentDigest(draft.text),
              )) === accepted.digest;
        if (equal) {
          await dropStaleDraft(accountId, workspaceId, draft);
          return snapshot.head;
        }
      }

      // A stale draft is text of this device over a server version it never
      // saw. "Based on an older head" needs a base to compare, the head must
      // be one the server set, and a deleted head is not a version to offer:
      // deletion recovery is the Trash, not this choice.
      const stale =
        !draft.deleted &&
        !accepted.deleted &&
        !accepted.isLocal &&
        draftBase !== null &&
        accepted.revisionId !== null &&
        accepted.text !== null &&
        draftBase !== accepted.revisionId;

      // The draft no longer describes its file and holds no stale text to
      // choose from, so the accepted row is the newer statement of the path
      // and of the deletion state.
      if (!snapshot.leads && !stale) return snapshot.head;

      return {
        fileId,
        path: draft.path,
        text: draft.text,
        deleted: draft.deleted,
        workingCopyId: draft.workingCopyId,
        sequence: draft.sequence,
        baseRevisionId: draftBase,
        stale,
        acceptedText: stale ? accepted.text : null,
        acceptedPath: accepted.path,
        acceptedRevisionId: accepted.revisionId,
      };
    },

    async rebaseDraft(
      accountId: string,
      workspaceId: string,
      workingCopyId: string,
    ): Promise<void> {
      const rebased = await guard('rebasing a draft', () =>
        db.transaction(
          'rw',
          [tables.drafts, tables.acceptedFiles],
          async (): Promise<DraftRow | null> => {
            const stored: unknown = await tables.drafts.get([
              serverOrigin,
              accountId,
              workspaceId,
              workingCopyId,
            ]);
            if (stored === undefined) return null;
            const draft = validateDraft(stored);
            const storedFile: unknown = await tables.acceptedFiles.get([
              serverOrigin,
              accountId,
              workspaceId,
              draft.fileId,
            ]);
            if (storedFile === undefined) return null;
            const file = validateAcceptedFile(storedFile);
            const next: DraftRow = {
              ...draft,
              baseRevisionId: file.acceptedHeadRevisionId,
              // The draft keeps its text and drops its old local parent, so
              // the next checkpoint names the accepted head the server has.
              lastCheckpointId: null,
              savedAt: nowIso(),
            };
            await tables.drafts.put(next);
            return next;
          },
        ),
      );
      if (rebased === null) return;
      publish({
        accountId,
        workspaceId,
        fileId: rebased.fileId,
        kind: 'draft',
      });
    },

    async dropDraft(
      accountId: string,
      workspaceId: string,
      workingCopyId: string,
    ): Promise<void> {
      const removed = await guard('removing a draft', () =>
        db.transaction(
          'rw',
          tables.drafts,
          async (): Promise<string | null> => {
            const stored: unknown = await tables.drafts.get([
              serverOrigin,
              accountId,
              workspaceId,
              workingCopyId,
            ]);
            if (stored === undefined) return null;
            const draft = validateDraft(stored);
            await tables.drafts.delete([
              serverOrigin,
              accountId,
              workspaceId,
              workingCopyId,
            ]);
            return draft.fileId;
          },
        ),
      );
      if (removed === null) return;
      publish({ accountId, workspaceId, fileId: removed, kind: 'draft' });
    },

    listSearchFiles(accountId: string, workspaceId: string) {
      return guard('reading local search content', () =>
        db.transaction(
          'r',
          [tables.acceptedFiles, tables.contents, tables.drafts],
          async () => {
            const range = partitionRange(serverOrigin, accountId, workspaceId);
            const acceptedRows: unknown[] = await tables.acceptedFiles
              .where('[serverOrigin+accountId+workspaceId+fileId]')
              .between(range.lower, range.upper, true, true)
              .toArray();
            const result = new Map<
              string,
              {
                fileId: string;
                path: string;
                revisionId: string;
                text: string;
              }
            >();
            const accepted = new Map<string, FileRow>();
            for (const raw of acceptedRows) {
              const file = validateAcceptedFile(raw);
              accepted.set(file.fileId, file);
              if (
                file.deleted ||
                file.kind !== 'note' ||
                file.acceptedHeadRevisionId === null ||
                file.acceptedHeadDigest === null
              )
                continue;
              const body: unknown = await tables.contents.get([
                serverOrigin,
                accountId,
                workspaceId,
                file.acceptedHeadDigest,
              ]);
              if (body === undefined) continue;
              const content = validateContent(body);
              if (content.text === null) continue;
              result.set(file.fileId, {
                fileId: file.fileId,
                path: file.path,
                revisionId: file.acceptedHeadRevisionId,
                text: content.text,
              });
            }

            const drafts: unknown[] = await tables.drafts.toArray();
            const latest = new Map<string, DraftRow>();
            for (const raw of drafts) {
              const draft = validateDraft(raw);
              if (!matchesPartition(draft, accountId, workspaceId)) continue;
              const seen = latest.get(draft.fileId);
              if (seen === undefined || seen.sequence < draft.sequence)
                latest.set(draft.fileId, draft);
            }
            for (const draft of latest.values()) {
              if (!draftLeads(accepted.get(draft.fileId), draft)) continue;
              if (draft.deleted) {
                result.delete(draft.fileId);
                continue;
              }
              result.set(draft.fileId, {
                fileId: draft.fileId,
                path: draft.path,
                revisionId:
                  draft.lastCheckpointId ??
                  draft.baseRevisionId ??
                  draft.workingCopyId,
                text: draft.text,
              });
            }
            return [...result.values()].sort((left, right) =>
              left.path < right.path ? -1 : 1,
            );
          },
        ),
      );
    },

    hasContent(
      accountId: string,
      workspaceId: string,
      digest: string,
    ): Promise<boolean> {
      return guard('reading stored content', () =>
        db.transaction('r', tables.contents, async () => {
          const stored: unknown = await tables.contents.get([
            serverOrigin,
            accountId,
            workspaceId,
            digest,
          ]);
          return stored !== undefined;
        }),
      );
    },

    setAttachmentPinned(
      accountId: string,
      workspaceId: string,
      digest: string,
      pinned: boolean,
    ): Promise<void> {
      return guard('pinning an attachment', () =>
        db.transaction('rw', tables.preferences, async () => {
          const name = `pin-attachment:${digest}`;
          const key: [string, string, string, string] = [
            serverOrigin,
            accountId,
            workspaceId,
            name,
          ];
          if (pinned)
            await tables.preferences.put({
              serverOrigin,
              accountId,
              workspaceId,
              name,
              value: '1',
            });
          else await tables.preferences.delete(key);
        }),
      );
    },

    isAttachmentPinned(
      accountId: string,
      workspaceId: string,
      digest: string,
    ): Promise<boolean> {
      return guard('reading an attachment pin', () =>
        db.transaction('r', tables.preferences, async () => {
          const stored: unknown = await tables.preferences.get([
            serverOrigin,
            accountId,
            workspaceId,
            `pin-attachment:${digest}`,
          ]);
          return stored !== undefined;
        }),
      );
    },

    setHistoryPinned(
      accountId: string,
      workspaceId: string,
      revisionId: string,
      pinned: boolean,
    ): Promise<void> {
      return guard('pinning a historic revision', () =>
        db.transaction('rw', tables.preferences, async () => {
          const name = `pin-history:${revisionId}`;
          const key: [string, string, string, string] = [
            serverOrigin,
            accountId,
            workspaceId,
            name,
          ];
          if (pinned)
            await tables.preferences.put({
              serverOrigin,
              accountId,
              workspaceId,
              name,
              value: '1',
            });
          else await tables.preferences.delete(key);
        }),
      );
    },

    isHistoryPinned(
      accountId: string,
      workspaceId: string,
      revisionId: string,
    ): Promise<boolean> {
      return guard('reading a history pin', () =>
        db.transaction('r', tables.preferences, async () => {
          const stored: unknown = await tables.preferences.get([
            serverOrigin,
            accountId,
            workspaceId,
            `pin-history:${revisionId}`,
          ]);
          return stored !== undefined;
        }),
      );
    },

    setSignOutMarker(accountId: string): Promise<void> {
      return guard('recording the sign-out marker', () =>
        db.transaction('rw', tables.preferences, async () => {
          await tables.preferences.put({
            serverOrigin,
            accountId,
            workspaceId: accountWide,
            name: signOutMarkerName,
            value: 'signed-out',
          });
        }),
      );
    },

    hasSignOutMarker(accountId: string): Promise<boolean> {
      return guard('reading the sign-out marker', () =>
        db.transaction('r', tables.preferences, async () => {
          const stored: unknown = await tables.preferences.get([
            serverOrigin,
            accountId,
            accountWide,
            signOutMarkerName,
          ]);
          return stored !== undefined;
        }),
      );
    },

    clearSignOutMarker(accountId: string): Promise<void> {
      return guard('clearing the sign-out marker', () =>
        db.transaction('rw', tables.preferences, async () => {
          await tables.preferences.delete([
            serverOrigin,
            accountId,
            accountWide,
            signOutMarkerName,
          ]);
        }),
      );
    },

    async clearPrivateData(
      accountId: string,
      workspaceId?: string,
    ): Promise<void> {
      const clearedWorkspaces = await guard('clearing private local data', () =>
        db.transaction(
          'rw',
          [
            tables.drafts,
            tables.checkpoints,
            tables.contents,
            tables.acceptedFiles,
            tables.queue,
            tables.receipts,
            tables.stagedSnapshots,
            tables.snapshotItems,
            tables.cursors,
            tables.preferences,
            tables.recovery,
          ],
          async () => {
            if (workspaceId === undefined) {
              return clearAccountPartition(accountId);
            } else {
              await clearWorkspacePartition(accountId, workspaceId);
              return [workspaceId];
            }
          },
        ),
      );
      for (const clearedWorkspaceId of clearedWorkspaces)
        publish({
          accountId,
          workspaceId: clearedWorkspaceId,
          fileId: null,
          kind: 'reset',
        });
    },

    acquireLease(ownerId: string, expiresAt: number): Promise<boolean> {
      return guard('acquiring the sync lease', () =>
        db.transaction('rw', tables.leases, async () => {
          const stored: unknown = await tables.leases.get(leaseKey);
          if (stored !== undefined) {
            const lease = validateLease(stored);
            // Another worker holds a live lease. An expired lease, or one
            // this owner already holds, may be taken over or renewed.
            if (lease.ownerId !== ownerId && lease.expiresAt > clock())
              return false;
          }
          await tables.leases.put({
            key: leaseKey,
            ownerId,
            expiresAt,
          });
          return true;
        }),
      );
    },

    releaseLease(ownerId: string): Promise<void> {
      return guard('releasing the sync lease', () =>
        db.transaction('rw', tables.leases, async () => {
          const stored: unknown = await tables.leases.get(leaseKey);
          if (stored === undefined) return;
          // Releasing a lease that another worker took over does nothing.
          if (validateLease(stored).ownerId !== ownerId) return;
          await tables.leases.delete(leaseKey);
        }),
      );
    },

    readLeaseState(): Promise<{
      readonly ownerId: string;
      readonly expiresAt: number;
    } | null> {
      return guard('reading the sync lease', () =>
        db.transaction('r', tables.leases, async () => {
          const stored: unknown = await tables.leases.get(leaseKey);
          if (stored === undefined) return null;
          const lease = validateLease(stored);
          return { ownerId: lease.ownerId, expiresAt: lease.expiresAt };
        }),
      );
    },

    stageSnapshot(
      accountId: string,
      workspaceId: string,
      token: string,
      revisionIds: readonly string[],
      cursor: string,
    ): Promise<void> {
      return guard('staging a snapshot', () =>
        db.transaction(
          'rw',
          [tables.stagedSnapshots, tables.snapshotItems],
          async () => {
            await tables.stagedSnapshots.put({
              serverOrigin,
              accountId,
              workspaceId,
              token,
              revisionIds: [...revisionIds],
              cursor,
              state: 'staging',
              createdAt: nowIso(),
            });
            // A restarted download under the same token drops the items of
            // the previous attempt before new ones arrive.
            await tables.snapshotItems
              .where('[serverOrigin+accountId+workspaceId+token]')
              .equals([serverOrigin, accountId, workspaceId, token])
              .delete();
          },
        ),
      );
    },

    storeSnapshotRevision(
      accountId: string,
      workspaceId: string,
      revision: SnapshotRevision,
    ): Promise<void> {
      return guard('storing a snapshot revision', () =>
        db.transaction(
          'rw',
          [tables.contents, tables.snapshotItems],
          async () => {
            if (revision.text !== null) {
              await tables.contents.put({
                serverOrigin,
                accountId,
                workspaceId,
                digest: revision.digest,
                text: revision.text,
                bytes: null,
                size: byteLength(revision.text),
              });
            }
            const item: SnapshotItemRow = {
              serverOrigin,
              accountId,
              workspaceId,
              token: revision.token,
              revisionId: revision.revisionId,
              fileId: revision.fileId,
              path: revision.path,
              kind: revision.kind,
              deleted: revision.deleted,
              digest: revision.digest,
              storedAt: nowIso(),
            };
            await tables.snapshotItems.put(item);
          },
        ),
      );
    },

    async activateSnapshot(token: string): Promise<void> {
      const activated = await guard('activating a snapshot', () =>
        db.transaction(
          'rw',
          [
            tables.stagedSnapshots,
            tables.snapshotItems,
            tables.contents,
            tables.acceptedFiles,
            tables.cursors,
            tables.drafts,
          ],
          async () => {
            const plans: unknown[] = await tables.stagedSnapshots.toArray();
            const plan =
              plans
                .map((row: unknown) => validateSnapshot(row))
                .find((row) => row.token === token) ?? null;
            if (plan === null)
              throw new LocalStorageError(
                'corrupt',
                'no staged snapshot carries this token',
              );
            if (plan.state === 'active') return null;
            const { accountId, workspaceId } = plan;
            const stored: unknown[] = await tables.snapshotItems
              .where('[serverOrigin+accountId+workspaceId+token]')
              .equals([serverOrigin, accountId, workspaceId, token])
              .toArray();
            const byRevision = new Map(
              stored.map((row: unknown) => {
                const item = validateSnapshotItem(row);
                return [item.revisionId, item] as const;
              }),
            );
            for (const revisionId of plan.revisionIds) {
              const item = byRevision.get(revisionId);
              if (item === undefined)
                throw new LocalStorageError(
                  'aborted',
                  'the staged snapshot is incomplete',
                );
              if (!item.deleted && item.kind === 'note') {
                const body: unknown = await tables.contents.get([
                  serverOrigin,
                  accountId,
                  workspaceId,
                  item.digest,
                ]);
                if (body === undefined || validateContent(body).text === null)
                  throw new LocalStorageError(
                    'aborted',
                    'the staged snapshot is incomplete',
                  );
              }
            }
            const byFile = new Map<string, SnapshotItemRow>();
            for (const item of byRevision.values())
              byFile.set(item.fileId, item);
            for (const item of byFile.values()) {
              const known: unknown = await tables.acceptedFiles.get([
                serverOrigin,
                accountId,
                workspaceId,
                item.fileId,
              ]);
              const file =
                known === undefined ? null : validateAcceptedFile(known);
              // Same dirty test as the change feed: a local head ahead of
              // the accepted head, or a draft that neither head contains.
              const heads: HeadState[] = [];
              const knownHead = await acceptedHeadState(
                accountId,
                workspaceId,
                file,
              );
              if (knownHead !== null) heads.push(knownHead);
              heads.push({
                path: item.path,
                deleted: item.deleted,
                text: await bodyOfDigest(accountId, workspaceId, item.digest),
              });
              const dirty =
                file !== null &&
                ((file.localHeadRevisionId !== null &&
                  file.localHeadRevisionId !== file.acceptedHeadRevisionId) ||
                  (await hasDivergentDraft(
                    accountId,
                    workspaceId,
                    item.fileId,
                    heads,
                  )));
              if (!dirty) {
                await tables.acceptedFiles.put({
                  serverOrigin,
                  accountId,
                  workspaceId,
                  fileId: item.fileId,
                  kind: item.kind,
                  path: item.path,
                  deleted: item.deleted,
                  acceptedHeadRevisionId: item.revisionId,
                  acceptedHeadDigest: item.digest,
                  localHeadRevisionId: item.revisionId,
                  updatedAt: nowIso(),
                });
              } else if (file !== null) {
                // The accepted head follows the snapshot, but the path, the
                // deletion state, and the local head keep whatever local
                // work set. A remote head never replaces a dirty copy.
                await tables.acceptedFiles.put({
                  ...file,
                  acceptedHeadRevisionId: item.revisionId,
                  acceptedHeadDigest: item.digest,
                  updatedAt: nowIso(),
                });
              }
            }
            await tables.cursors.put({
              serverOrigin,
              accountId,
              workspaceId,
              cursor: plan.cursor,
              updatedAt: nowIso(),
            });
            await tables.stagedSnapshots.put({ ...plan, state: 'active' });
            return {
              accountId,
              workspaceId,
              fileIds: [...byFile.keys()],
            };
          },
        ),
      );
      if (activated === null) return;
      for (const fileId of activated.fileIds)
        publish({
          accountId: activated.accountId,
          workspaceId: activated.workspaceId,
          fileId,
          kind: 'file',
        });
      publish({
        accountId: activated.accountId,
        workspaceId: activated.workspaceId,
        fileId: null,
        kind: 'cursor',
      });
    },

    readCursor(accountId: string, workspaceId: string): Promise<string | null> {
      return guard('reading the sync cursor', () =>
        db.transaction('r', tables.cursors, async () => {
          const stored: unknown = await tables.cursors.get([
            serverOrigin,
            accountId,
            workspaceId,
          ]);
          return stored === undefined ? null : validateCursor(stored).cursor;
        }),
      );
    },

    async applyRemoteChanges(
      accountId: string,
      workspaceId: string,
      changes: readonly RemoteChange[],
      nextCursor: string,
    ): Promise<void> {
      await guard('applying remote changes', () =>
        db.transaction(
          'rw',
          [
            tables.contents,
            tables.acceptedFiles,
            tables.drafts,
            tables.cursors,
          ],
          async () => {
            for (const change of changes) {
              const file = change.file;
              if (file === null) {
                // A permanent deletion leaves nothing to restore, so the
                // cached metadata and the cached working copy of that file go
                // with it. Without this the note would stay in the file tree
                // for as long as the cache lives, because the listing of the
                // server can only say which files exist, not which vanished.
                if (change.purgedFileId !== null)
                  await forgetFile(accountId, workspaceId, change.purgedFileId);
                continue;
              }
              if (file.text !== null) {
                await tables.contents.put({
                  serverOrigin,
                  accountId,
                  workspaceId,
                  digest: file.digest,
                  text: file.text,
                  bytes: null,
                  size: byteLength(file.text),
                });
              }
              const known: unknown = await tables.acceptedFiles.get([
                serverOrigin,
                accountId,
                workspaceId,
                file.fileId,
              ]);
              const current =
                known === undefined ? null : validateAcceptedFile(known);
              // Unsubmitted work is a local head ahead of the accepted head,
              // and it is also a draft that neither the accepted head nor
              // the arriving one contains. Without the draft half this write
              // moves the local head while the draft keeps shadowing it.
              const heads: HeadState[] = [];
              const knownHead = await acceptedHeadState(
                accountId,
                workspaceId,
                current,
              );
              if (knownHead !== null) heads.push(knownHead);
              heads.push({
                path: file.path,
                deleted: file.deleted,
                text:
                  file.text ??
                  (await bodyOfDigest(accountId, workspaceId, file.digest)),
              });
              const dirty =
                current !== null &&
                ((current.localHeadRevisionId !== null &&
                  current.localHeadRevisionId !==
                    current.acceptedHeadRevisionId) ||
                  (await hasDivergentDraft(
                    accountId,
                    workspaceId,
                    file.fileId,
                    heads,
                  )));
              if (current === null || !dirty) {
                await tables.acceptedFiles.put({
                  serverOrigin,
                  accountId,
                  workspaceId,
                  fileId: file.fileId,
                  kind: file.fileKind,
                  path: file.path,
                  deleted: file.deleted,
                  acceptedHeadRevisionId: file.revisionId,
                  acceptedHeadDigest: file.digest,
                  localHeadRevisionId: file.revisionId,
                  updatedAt: nowIso(),
                });
              } else {
                await tables.acceptedFiles.put({
                  ...current,
                  acceptedHeadRevisionId: file.revisionId,
                  acceptedHeadDigest: file.digest,
                  updatedAt: nowIso(),
                });
              }
            }
            await tables.cursors.put({
              serverOrigin,
              accountId,
              workspaceId,
              cursor: nextCursor,
              updatedAt: nowIso(),
            });
          },
        ),
      );
      for (const change of changes) {
        const fileId = change.file?.fileId ?? change.purgedFileId;
        publish({
          accountId,
          workspaceId,
          fileId,
          kind: fileId === null ? 'cursor' : 'file',
        });
      }
    },

    close(): Promise<void> {
      closeMessaging();
      db.close();
      return Promise.resolve();
    },
  };
  return store;
}
