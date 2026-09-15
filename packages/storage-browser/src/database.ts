/**
 * The IndexedDB schema of one browser profile.
 *
 * Every private table is partitioned by the server origin, the account, and
 * the workspace, and every primary key starts with those three parts. One
 * browser profile can hold several accounts of several installations, so a
 * query that forgets a partition part would read another account's notes.
 * Compound keys make that mistake impossible: a range over one partition
 * cannot reach a row of another.
 *
 * Dexie owns the connection, the versioned schema, and the transaction. This
 * module owns the row shapes, the key ranges, and the mapping from a browser
 * failure to a typed `LocalStorageError`.
 */
// The named import is deliberate. The package's default export describes a
// CommonJS module, so a default import would be the module namespace under
// `module: NodeNext` without `esModuleInterop`. The named `Dexie` is the
// constructor, the database type, and the namespace of the static members.
import { Dexie, type DexieOptions, type Table } from 'dexie';
import {
  LocalStorageError,
  type CheckpointRecord,
  type Draft,
  type LocalAcceptedFile,
  type LocalContent,
  type LocalCursor,
  type LocalFileKind,
  type LocalReceipt,
  type Preference,
  type QueueState,
  type RecoveryRecord,
  type StagedSnapshot,
} from '@notesapp/sync';
import type { ChangesetInput } from '@notesapp/core';

/**
 * The stored form of one working copy.
 *
 * `lastCheckpointId` is the parent of the next checkpoint of this working
 * copy. It is storage state rather than editor state, so it stays out of the
 * `Draft` the editor supplies.
 */
export type DraftRow = Draft & {
  readonly serverOrigin: string;
  readonly lastCheckpointId: string | null;
  readonly savedAt: string;
};

/**
 * The stored form of one queued mutation.
 *
 * `sequence` fixes submission order inside one partition. A pending input can
 * advance its expected head when its queued parent is accepted. Once sending
 * starts and the digest is frozen, the input never changes.
 */
export type QueueRow = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly mutationId: string;
  readonly sequence: number;
  readonly input: ChangesetInput;
  readonly state: QueueState;
  readonly digest: string | null;
  readonly errorCode: string | null;
  readonly createdAt: string;
};

/**
 * The stored form of one local checkpoint.
 *
 * `sequence` orders the checkpoints of one partition. Two checkpoints can
 * carry the same client time, so a time alone would not order them.
 */
export type CheckpointRow = CheckpointRecord & { readonly sequence: number };

/** The stored form of the accepted and local knowledge of one file. */
export type FileRow = LocalAcceptedFile;

/** The stored form of one immutable content body. */
export type ContentRow = LocalContent;

/** The stored form of one acknowledgment. */
export type ReceiptRow = LocalReceipt;

/** The stored form of one staged snapshot. Task 11 fills this table. */
export type SnapshotRow = StagedSnapshot;

/**
 * The stored form of one staged snapshot item.
 *
 * One row per captured revision: the file metadata the snapshot pinned and
 * the digest whose body `storeSnapshotRevision` writes to the content table.
 * Activation joins these rows against the staged plan and the stored
 * content, so an incomplete download can never become accepted metadata.
 */
export type SnapshotItemRow = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly token: string;
  readonly revisionId: string;
  readonly fileId: string;
  readonly path: string;
  readonly kind: LocalFileKind;
  readonly deleted: boolean;
  readonly digest: string;
  readonly storedAt: string;
};

/**
 * The stored form of the single sync worker lease.
 *
 * One row coordinates every tab of this browser profile: the holding owner
 * and the millisecond epoch at which its lease expires. A worker whose lease
 * expired without renewal has failed, so another worker may take over.
 */
export type LeaseRow = {
  readonly key: 'worker';
  readonly ownerId: string;
  readonly expiresAt: number;
};

/** The stored form of one consumed change position. */
export type CursorRow = LocalCursor;

/** The stored form of one setting. */
export type PreferenceRow = Preference;

/** The stored form of one recovery entry. Task 17 fills this table. */
export type RecoveryRow = RecoveryRecord;

/** Whether the recorded schema change finished. */
export type MigrationState = 'complete' | 'in-progress';

/**
 * The one bookkeeping row of the database.
 *
 * It is not partitioned, because it describes the database itself. It holds no
 * note content and no account identity beyond the device identifier this
 * browser profile uses when it submits a mutation.
 */
export type MetaRow = {
  readonly key: 'database';
  readonly schemaVersion: number;
  readonly migrationState: MigrationState;
  readonly deviceId: string;
};

/** The single key of the bookkeeping row. */
export const metaKey = 'database';

/** Every table of the local database. */
export type Tables = {
  readonly drafts: Table<DraftRow, [string, string, string, string]>;
  readonly checkpoints: Table<CheckpointRow, [string, string, string, string]>;
  readonly contents: Table<ContentRow, [string, string, string, string]>;
  readonly acceptedFiles: Table<FileRow, [string, string, string, string]>;
  readonly queue: Table<QueueRow, [string, string, string, string]>;
  readonly receipts: Table<ReceiptRow, [string, string, string, string]>;
  readonly stagedSnapshots: Table<
    SnapshotRow,
    [string, string, string, string]
  >;
  readonly snapshotItems: Table<
    SnapshotItemRow,
    [string, string, string, string, string]
  >;
  readonly leases: Table<LeaseRow, string>;
  readonly cursors: Table<CursorRow, [string, string, string]>;
  readonly preferences: Table<PreferenceRow, [string, string, string, string]>;
  readonly recovery: Table<RecoveryRow, [string, string, string, string]>;
  readonly meta: Table<MetaRow, string>;
};

/**
 * The schema of each version.
 *
 * A later task adds a version by appending an entry and a migration step in
 * `./migrations.ts`. An entry is never edited once it is released, because a
 * released browser already ran it.
 *
 * Version 2 adds the sync worker lease and the staged snapshot items. Both
 * tables start empty; the migration only revalidates. Version 4 drops the
 * `branches` table of the removed conflict-branch feature.
 */
export const schemaVersions: readonly {
  readonly version: number;
  /** An index specification, or `null` to delete the store. */
  readonly stores: Readonly<Record<string, string | null>>;
}[] = [
  {
    version: 1,
    stores: {
      drafts:
        '[serverOrigin+accountId+workspaceId+workingCopyId], [serverOrigin+accountId+workspaceId+fileId]',
      checkpoints:
        '[serverOrigin+accountId+workspaceId+revisionId], [serverOrigin+accountId+workspaceId+fileId], [serverOrigin+accountId+workspaceId+mutationId], [serverOrigin+accountId+workspaceId+sequence]',
      contents: '[serverOrigin+accountId+workspaceId+digest]',
      acceptedFiles:
        '[serverOrigin+accountId+workspaceId+fileId], [serverOrigin+accountId+workspaceId+path]',
      branches:
        '[serverOrigin+accountId+workspaceId+branchId], [serverOrigin+accountId+workspaceId+fileId]',
      queue:
        '[serverOrigin+accountId+workspaceId+mutationId], [serverOrigin+accountId+workspaceId+sequence], [serverOrigin+accountId+mutationId]',
      receipts: '[serverOrigin+accountId+workspaceId+mutationId]',
      stagedSnapshots: '[serverOrigin+accountId+workspaceId+token]',
      cursors: '[serverOrigin+accountId+workspaceId]',
      preferences: '[serverOrigin+accountId+workspaceId+name]',
      recovery:
        '[serverOrigin+accountId+workspaceId+recoveryId], [serverOrigin+accountId+workspaceId+createdAt]',
      meta: 'key',
    },
  },
  {
    version: 2,
    stores: {
      drafts:
        '[serverOrigin+accountId+workspaceId+workingCopyId], [serverOrigin+accountId+workspaceId+fileId]',
      checkpoints:
        '[serverOrigin+accountId+workspaceId+revisionId], [serverOrigin+accountId+workspaceId+fileId], [serverOrigin+accountId+workspaceId+mutationId], [serverOrigin+accountId+workspaceId+sequence]',
      contents: '[serverOrigin+accountId+workspaceId+digest]',
      acceptedFiles:
        '[serverOrigin+accountId+workspaceId+fileId], [serverOrigin+accountId+workspaceId+path]',
      branches:
        '[serverOrigin+accountId+workspaceId+branchId], [serverOrigin+accountId+workspaceId+fileId]',
      queue:
        '[serverOrigin+accountId+workspaceId+mutationId], [serverOrigin+accountId+workspaceId+sequence], [serverOrigin+accountId+mutationId]',
      receipts: '[serverOrigin+accountId+workspaceId+mutationId]',
      stagedSnapshots: '[serverOrigin+accountId+workspaceId+token]',
      snapshotItems:
        '[serverOrigin+accountId+workspaceId+token+revisionId], [serverOrigin+accountId+workspaceId+token]',
      leases: 'key',
      cursors: '[serverOrigin+accountId+workspaceId]',
      preferences: '[serverOrigin+accountId+workspaceId+name]',
      recovery:
        '[serverOrigin+accountId+workspaceId+recoveryId], [serverOrigin+accountId+workspaceId+createdAt]',
      meta: 'key',
    },
  },
  {
    version: 3,
    stores: {
      drafts:
        '[serverOrigin+accountId+workspaceId+workingCopyId], [serverOrigin+accountId+workspaceId+fileId]',
      checkpoints:
        '[serverOrigin+accountId+workspaceId+revisionId], [serverOrigin+accountId+workspaceId+fileId], [serverOrigin+accountId+workspaceId+mutationId], [serverOrigin+accountId+workspaceId+sequence]',
      contents: '[serverOrigin+accountId+workspaceId+digest]',
      acceptedFiles:
        '[serverOrigin+accountId+workspaceId+fileId], [serverOrigin+accountId+workspaceId+path]',
      branches:
        '[serverOrigin+accountId+workspaceId+branchId], [serverOrigin+accountId+workspaceId+fileId]',
      queue:
        '[serverOrigin+accountId+workspaceId+mutationId], [serverOrigin+accountId+workspaceId+sequence], [serverOrigin+accountId+mutationId]',
      receipts: '[serverOrigin+accountId+workspaceId+mutationId]',
      stagedSnapshots: '[serverOrigin+accountId+workspaceId+token]',
      snapshotItems:
        '[serverOrigin+accountId+workspaceId+token+revisionId], [serverOrigin+accountId+workspaceId+token]',
      leases: 'key',
      cursors: '[serverOrigin+accountId+workspaceId]',
      preferences: '[serverOrigin+accountId+workspaceId+name]',
      recovery:
        '[serverOrigin+accountId+workspaceId+recoveryId], [serverOrigin+accountId+workspaceId+createdAt]',
      meta: 'key',
    },
  },
  {
    version: 4,
    stores: {
      // `null` deletes the store. The conflict-branch feature left the
      // product, so the table it wrote has no reader and no writer.
      branches: null,
    },
  },
];

/** The names of every table, in the order a whole database transaction uses. */
export const tableNames: readonly string[] = [
  'drafts',
  'checkpoints',
  'contents',
  'acceptedFiles',
  'queue',
  'receipts',
  'stagedSnapshots',
  'snapshotItems',
  'leases',
  'cursors',
  'preferences',
  'recovery',
  'meta',
];

/** The default database name. Tests pass their own to stay isolated. */
export const defaultDatabaseName = 'notesapp';

/** What an opened database offers. */
export type LocalDatabase = {
  readonly db: Dexie;
  readonly tables: Tables;
};

/**
 * Creates the Dexie database and declares every schema version.
 *
 * The IndexedDB factory can be injected, which is how Node tests run this code
 * against `fake-indexeddb`. Dexie reads the global factory when nothing is
 * injected, which is the browser case.
 */
export function createDatabase(
  name: string,
  backend?: {
    readonly indexedDB?: IDBFactory;
    readonly IDBKeyRange?: typeof IDBKeyRange;
  },
): LocalDatabase {
  const options: DexieOptions = { autoOpen: false };
  // `exactOptionalPropertyTypes` forbids an explicit `undefined`, so each
  // injected member is added only when the caller supplied it.
  if (backend?.indexedDB !== undefined) options.indexedDB = backend.indexedDB;
  if (backend?.IDBKeyRange !== undefined)
    options.IDBKeyRange = backend.IDBKeyRange;
  const db = new Dexie(name, options);
  for (const entry of schemaVersions)
    db.version(entry.version).stores(entry.stores);
  const tables: Tables = {
    drafts: db.table<DraftRow, [string, string, string, string]>('drafts'),
    checkpoints: db.table<CheckpointRow, [string, string, string, string]>(
      'checkpoints',
    ),
    contents: db.table<ContentRow, [string, string, string, string]>(
      'contents',
    ),
    acceptedFiles: db.table<FileRow, [string, string, string, string]>(
      'acceptedFiles',
    ),
    queue: db.table<QueueRow, [string, string, string, string]>('queue'),
    receipts: db.table<ReceiptRow, [string, string, string, string]>(
      'receipts',
    ),
    stagedSnapshots: db.table<SnapshotRow, [string, string, string, string]>(
      'stagedSnapshots',
    ),
    snapshotItems: db.table<
      SnapshotItemRow,
      [string, string, string, string, string]
    >('snapshotItems'),
    leases: db.table<LeaseRow, string>('leases'),
    cursors: db.table<CursorRow, [string, string, string]>('cursors'),
    preferences: db.table<PreferenceRow, [string, string, string, string]>(
      'preferences',
    ),
    recovery: db.table<RecoveryRow, [string, string, string, string]>(
      'recovery',
    ),
    meta: db.table<MetaRow, string>('meta'),
  };
  return { db, tables };
}

/** The lowest and the highest key of one partition, for a range query. */
export function partitionRange(
  serverOrigin: string,
  accountId: string,
  workspaceId: string,
): { readonly lower: unknown[]; readonly upper: unknown[] } {
  return {
    lower: [serverOrigin, accountId, workspaceId, Dexie.minKey],
    upper: [serverOrigin, accountId, workspaceId, Dexie.maxKey],
  };
}

/** The name of a thrown value, for failure classification. */
function errorName(value: unknown): string {
  if (value instanceof Error) return value.name;
  if (typeof value === 'object' && value !== null && 'name' in value) {
    const name: unknown = value.name;
    if (typeof name === 'string') return name;
  }
  return '';
}

/**
 * Maps a browser database failure to a typed local failure.
 *
 * The caller needs the kind, not the vendor's wording: a quota failure asks
 * the user to free space, an abort is a retry, and an unavailable database
 * stops the claim of persistence. The original error travels as the cause, so
 * a diagnostic keeps it, and the message carries no note text.
 */
export function toLocalStorageError(
  value: unknown,
  operation: string,
): LocalStorageError {
  if (value instanceof LocalStorageError) return value;
  const name = errorName(value);
  if (name === 'QuotaExceededError' || name === 'QuotaExceeded')
    return new LocalStorageError('quota', `${operation} ran out of space`, {
      cause: value,
    });
  if (name === 'AbortError' || name === 'TransactionInactiveError')
    return new LocalStorageError('aborted', `${operation} did not commit`, {
      cause: value,
    });
  if (
    name === 'DatabaseClosedError' ||
    name === 'MissingAPIError' ||
    name === 'InvalidStateError' ||
    name === 'NoSuchDatabaseError' ||
    name === 'OpenFailedError' ||
    name === 'UnknownError' ||
    name === 'VersionChangeError'
  )
    return new LocalStorageError(
      'unavailable',
      `${operation} found no usable database`,
      { cause: value },
    );
  if (
    name === 'VersionError' ||
    name === 'SchemaError' ||
    name === 'UpgradeError' ||
    name === 'DataError' ||
    name === 'ConstraintError'
  )
    return new LocalStorageError(
      'corrupt',
      `${operation} found an unreadable database`,
      { cause: value },
    );
  // An unrecognized failure did not commit either. Report the safe kind.
  return new LocalStorageError('aborted', `${operation} failed`, {
    cause: value,
  });
}

/** Runs one database operation and maps every failure to a typed one. */
export async function guard<T>(
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error: unknown) {
    throw toLocalStorageError(error, operation);
  }
}
