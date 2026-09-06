/**
 * The IndexedDB implementation of the local persistence port.
 *
 * Two transaction boundaries matter, and they come from the design:
 *
 * - A draft save is one transaction over one table. The target is at most
 *   150 ms after input, so the editor can show Saved on this device.
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
import { contentDigest } from '@notesapp/core';
import type { AcceptedChangeset, ChangesetInput } from '@notesapp/core';
import {
  LocalStorageError,
  accountWide,
  shouldCheckpoint,
  type CheckpointRecord,
  type Draft,
  type LocalAcceptedFile,
  type LocalCachedNote,
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
  validateBranch,
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
  const newId = options.id ?? ((): string => crypto.randomUUID());
  const nowIso = (): string => new Date(clock()).toISOString();
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
    for (const row of await tables.branches.toArray()) {
      const parsed = validateBranch(row);
      if (matchesPartition(parsed, accountId, workspaceId))
        await tables.branches.delete([
          parsed.serverOrigin,
          parsed.accountId,
          parsed.workspaceId,
          parsed.branchId,
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
  const clearAccountPartition = async (accountId: string): Promise<void> => {
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
    for (const row of await tables.branches.toArray())
      collect(validateBranch(row));
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
  };

  const store: LocalStore = {
    serverOrigin,
    deviceId,

    saveDraft(draft: Draft): Promise<void> {
      return guard('saving a draft', () =>
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
      // The digest is computed before the transaction. WebCrypto is not a
      // database promise, so awaiting it inside a Dexie transaction would
      // leave the transaction zone and the transaction would already be gone.
      // A browser without WebCrypto cannot address content, so the caller
      // receives the same typed failure as for a refused write.
      const digest = await guard('creating a checkpoint', () =>
        contentDigest(draft.text),
      );
      const clientTime = nowIso();
      const revisionId = newId();
      const mutationId = newId();
      const branchId = newId();
      return guard('creating a checkpoint', () =>
        db.transaction(
          'rw',
          [
            tables.drafts,
            tables.checkpoints,
            tables.contents,
            tables.acceptedFiles,
            tables.branches,
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
              file.acceptedHeadRevisionId === draft.baseRevisionId
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
            const localHead =
              file?.localHeadRevisionId ?? file?.acceptedHeadRevisionId ?? null;
            // Another working copy of this file already moved the local head,
            // so this checkpoint is a second tip over the same base.
            const diverged = localHead !== null && localHead !== parentId;

            await tables.contents.put({
              serverOrigin,
              accountId,
              workspaceId,
              digest,
              text: draft.text,
              bytes: null,
              size: byteLength(draft.text),
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
              path: diverged ? (file?.path ?? draft.path) : draft.path,
              deleted: diverged
                ? (file?.deleted ?? draft.deleted)
                : draft.deleted,
              acceptedHeadRevisionId: file?.acceptedHeadRevisionId ?? null,
              acceptedHeadDigest: file?.acceptedHeadDigest ?? null,
              localHeadRevisionId: diverged ? localHead : revisionId,
              updatedAt: clientTime,
            };
            await tables.acceptedFiles.put(nextFile);
            if (diverged)
              await tables.branches.add({
                serverOrigin,
                accountId,
                workspaceId,
                branchId,
                fileId,
                baseRevisionId: parentId,
                tips: [localHead, revisionId],
                resolved: false,
                createdAt: clientTime,
              });

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
                  content: { kind: 'markdown', digest, text: draft.text },
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
              createdAt: clientTime,
            });

            const base =
              current !== null && current.sequence > draft.sequence
                ? current
                : draftRow(draft, lastCheckpointId);
            await tables.drafts.put({
              ...base,
              lastCheckpointId: revisionId,
              savedAt: clientTime,
            });
            return {
              accountId,
              input,
              state: 'pending',
              digest: null,
            };
          },
        ),
      );
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
            }));
        }),
      );
    },

    markSending(
      accountId: string,
      mutationId: string,
      digest: string,
    ): Promise<void> {
      return guard('marking a mutation as sending', () =>
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
        }),
      );
    },

    markConflict(accountId: string, mutationId: string): Promise<void> {
      return guard('marking a mutation as conflicting', () =>
        db.transaction('rw', tables.queue, async () => {
          const entry = await queueEntryOf(accountId, mutationId);
          if (entry === null) return;
          await tables.queue.put({ ...entry, state: 'conflict' });
        }),
      );
    },

    acknowledge(accountId: string, result: AcceptedChangeset): Promise<void> {
      return guard('acknowledging a mutation', () =>
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
            }
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

    addRecovery(
      accountId: string,
      workspaceId: string,
      entry: RecoveryInput,
    ): Promise<RecoveryRecord> {
      return guard('keeping a recovery copy', () =>
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
            createdAt: entry.createdAt ?? nowIso(),
          };
          await tables.recovery.put(validateRecovery(record));
          return record;
        }),
      );
    },

    removeRecovery(
      accountId: string,
      workspaceId: string,
      recoveryId: string,
    ): Promise<void> {
      return guard('removing a recovery copy', () =>
        db.transaction('rw', tables.recovery, async () => {
          const stored: unknown = await tables.recovery.get([
            serverOrigin,
            accountId,
            workspaceId,
            recoveryId,
          ]);
          if (stored === undefined) return;
          await tables.recovery.delete([
            serverOrigin,
            accountId,
            workspaceId,
            recoveryId,
          ]);
        }),
      );
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

    readCachedNote(
      accountId: string,
      workspaceId: string,
      fileId: string,
    ): Promise<LocalCachedNote | null> {
      return guard('reading a cached note', () =>
        db.transaction(
          'r',
          [
            tables.acceptedFiles,
            tables.checkpoints,
            tables.contents,
            tables.drafts,
          ],
          async () => {
            const draftRows: unknown[] = await tables.drafts
              .where('[serverOrigin+accountId+workspaceId+fileId]')
              .equals([serverOrigin, accountId, workspaceId, fileId])
              .toArray();
            const drafts = draftRows.map((row: unknown) => validateDraft(row));
            const draft = drafts.sort((left, right) => {
              if (left.savedAt !== right.savedAt)
                return left.savedAt < right.savedAt ? 1 : -1;
              return left.workingCopyId < right.workingCopyId ? 1 : -1;
            })[0];
            if (draft !== undefined) {
              return {
                fileId,
                path: draft.path,
                text: draft.text,
                deleted: draft.deleted,
                baseRevisionId: draft.lastCheckpointId ?? draft.baseRevisionId,
              };
            }

            const storedFile: unknown = await tables.acceptedFiles.get([
              serverOrigin,
              accountId,
              workspaceId,
              fileId,
            ]);
            if (storedFile === undefined) return null;
            const file = validateAcceptedFile(storedFile);
            if (file.kind !== 'note') return null;
            if (file.deleted)
              return {
                fileId,
                path: file.path,
                text: '',
                deleted: true,
                baseRevisionId: file.localHeadRevisionId,
              };

            const localHead = file.localHeadRevisionId;
            if (
              localHead !== null &&
              localHead !== file.acceptedHeadRevisionId
            ) {
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
                  baseRevisionId: checkpoint.revisionId,
                };
              const storedContent: unknown = await tables.contents.get([
                serverOrigin,
                accountId,
                workspaceId,
                checkpoint.digest,
              ]);
              if (storedContent === undefined) return null;
              const content = validateContent(storedContent);
              if (content.text === null) return null;
              return {
                fileId,
                path: checkpoint.path,
                text: content.text,
                deleted: false,
                baseRevisionId: checkpoint.revisionId,
              };
            }

            if (
              file.acceptedHeadRevisionId === null ||
              file.acceptedHeadDigest === null
            )
              return null;
            const storedContent: unknown = await tables.contents.get([
              serverOrigin,
              accountId,
              workspaceId,
              file.acceptedHeadDigest,
            ]);
            if (storedContent === undefined) return null;
            const content = validateContent(storedContent);
            if (content.text === null) return null;
            return {
              fileId,
              path: file.path,
              text: content.text,
              deleted: false,
              baseRevisionId: file.acceptedHeadRevisionId,
            };
          },
        ),
      );
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
            for (const raw of acceptedRows) {
              const file = validateAcceptedFile(raw);
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

    clearPrivateData(accountId: string, workspaceId?: string): Promise<void> {
      return guard('clearing private local data', () =>
        db.transaction(
          'rw',
          [
            tables.drafts,
            tables.checkpoints,
            tables.contents,
            tables.acceptedFiles,
            tables.branches,
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
              await clearAccountPartition(accountId);
            } else {
              await clearWorkspacePartition(accountId, workspaceId);
            }
          },
        ),
      );
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

    activateSnapshot(token: string): Promise<void> {
      return guard('activating a snapshot', () =>
        db.transaction(
          'rw',
          [
            tables.stagedSnapshots,
            tables.snapshotItems,
            tables.contents,
            tables.acceptedFiles,
            tables.cursors,
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
            if (plan.state === 'active') return;
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
              const dirty =
                file !== null &&
                file.localHeadRevisionId !== null &&
                file.localHeadRevisionId !== file.acceptedHeadRevisionId;
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
          },
        ),
      );
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

    applyRemoteChanges(
      accountId: string,
      workspaceId: string,
      changes: readonly RemoteChange[],
      nextCursor: string,
    ): Promise<void> {
      return guard('applying remote changes', () =>
        db.transaction(
          'rw',
          [tables.contents, tables.acceptedFiles, tables.cursors],
          async () => {
            for (const change of changes) {
              const file = change.file;
              if (file === null) continue;
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
              const dirty =
                current !== null &&
                current.localHeadRevisionId !== null &&
                current.localHeadRevisionId !== current.acceptedHeadRevisionId;
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
    },

    close(): Promise<void> {
      db.close();
      return Promise.resolve();
    },
  };
  return store;
}
