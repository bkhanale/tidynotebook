/**
 * Schema versions, record validation, and the interrupted migration guard.
 *
 * Two rules come from the design. Stored records are validated when they are
 * read or migrated, because a browser database is local state that another
 * application version, a partial write, or a user tool may have touched. And
 * an interrupted schema change must never be treated as a finished one: the
 * database records that a migration is running, so the next open either
 * finishes it inside a transaction or refuses to use the database.
 *
 * Refusing is a correct outcome. The application then shows a storage error
 * and read-only server content, which is better than editing on top of records
 * whose shape is unknown.
 */
import { LocalStorageError, type QueueState } from '@notesapp/sync';
import type { ChangesetInput, ContentRef, RevisionInput } from '@notesapp/core';
import type { Table } from 'dexie';
import {
  metaKey,
  schemaVersions,
  tableNames,
  type CheckpointRow,
  type ContentRow,
  type CursorRow,
  type DraftRow,
  type FileRow,
  type LeaseRow,
  type MetaRow,
  type MigrationState,
  type PreferenceRow,
  type QueueRow,
  type ReceiptRow,
  type RecoveryRow,
  type SnapshotItemRow,
  type SnapshotRow,
  type Tables,
  type DocumentRow,
} from './database.ts';

/** The schema version this application writes. */
export const currentSchemaVersion: number = Math.max(
  ...schemaVersions.map((entry) => entry.version),
);

/** Refuses a stored value that does not match its declared shape. */
function corrupt(detail: string): never {
  throw new LocalStorageError('corrupt', detail);
}

/**
 * True when a stored value can be read and written by key.
 *
 * A migration step edits the stored record in place, so it cannot use
 * `object`, which copies. This guard proves only that the value holds
 * members; every member stays `unknown` until a reader checks it.
 */
function isWritableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The value as a plain record, or a refusal.
 *
 * Only own enumerable members are kept, so an inherited member of a value that
 * some other tool wrote cannot pass a check.
 */
function object(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    corrupt(`${where} is not a record`);
  const members: Record<string, unknown> = Object.fromEntries(
    Object.entries(value),
  );
  return members;
}

function text(
  row: Record<string, unknown>,
  field: string,
  where: string,
): string {
  const value: unknown = row[field];
  if (typeof value !== 'string') corrupt(`${where}.${field} is not text`);
  return value;
}

function optionalText(
  row: Record<string, unknown>,
  field: string,
  where: string,
): string | null {
  const value: unknown = row[field];
  if (value === null) return null;
  if (typeof value !== 'string')
    corrupt(`${where}.${field} is not text or null`);
  return value;
}

/**
 * Text, or `null` for a field that a record written before it existed omits.
 *
 * A stored recovery record from an earlier release carries no server answer
 * code. Reading it must keep the kept text usable, so an absent field reads
 * as `null` instead of refusing the record.
 */
function addedText(
  row: Record<string, unknown>,
  field: string,
  where: string,
): string | null {
  const value: unknown = row[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string')
    corrupt(`${where}.${field} is not text or null`);
  return value;
}

function flag(
  row: Record<string, unknown>,
  field: string,
  where: string,
): boolean {
  const value: unknown = row[field];
  if (typeof value !== 'boolean') corrupt(`${where}.${field} is not a flag`);
  return value;
}

function count(
  row: Record<string, unknown>,
  field: string,
  where: string,
): number {
  const value: unknown = row[field];
  if (typeof value !== 'number' || !Number.isFinite(value))
    corrupt(`${where}.${field} is not a finite number`);
  return value;
}

function textList(
  row: Record<string, unknown>,
  field: string,
  where: string,
): readonly string[] {
  const value: unknown = row[field];
  if (!Array.isArray(value)) corrupt(`${where}.${field} is not a list`);
  const list: unknown[] = value;
  return list.map((entry: unknown, index: number) => {
    if (typeof entry !== 'string')
      corrupt(`${where}.${field}[${String(index)}] is not text`);
    return entry;
  });
}

function member<T extends string>(
  row: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  where: string,
): T {
  const value: unknown = row[field];
  const found = allowed.find((entry) => entry === value);
  if (found === undefined)
    corrupt(`${where}.${field} is not one of the allowed values`);
  return found;
}

/** The three partition members every private row carries. */
function partition(
  row: Record<string, unknown>,
  where: string,
): { serverOrigin: string; accountId: string; workspaceId: string } {
  return {
    serverOrigin: text(row, 'serverOrigin', where),
    accountId: text(row, 'accountId', where),
    workspaceId: text(row, 'workspaceId', where),
  };
}

/** Narrows one stored working copy. */
export function validateDraft(value: unknown): DraftRow {
  const row = object(value, 'draft');
  return {
    ...partition(row, 'draft'),
    workingCopyId: text(row, 'workingCopyId', 'draft'),
    fileId: text(row, 'fileId', 'draft'),
    baseRevisionId: optionalText(row, 'baseRevisionId', 'draft'),
    text: text(row, 'text', 'draft'),
    path: text(row, 'path', 'draft'),
    deleted: flag(row, 'deleted', 'draft'),
    sequence: count(row, 'sequence', 'draft'),
    lastCheckpointId: optionalText(row, 'lastCheckpointId', 'draft'),
    savedAt: text(row, 'savedAt', 'draft'),
  };
}

/** Narrows one stored content reference of a queued revision. */
function validateContentRef(value: unknown, where: string): ContentRef {
  const row = object(value, where);
  const kind = member(row, 'kind', ['markdown', 'attachment'] as const, where);
  if (kind === 'markdown') {
    // The content of a queued note revision is the document work of its save
    // (record 0081): the update, the generation, and the state it had seen.
    const save = object(row['document'], where);
    const work = object(save['work'], where);
    const workKind = member(
      work,
      'kind',
      ['update', 'text', 'none'] as const,
      where,
    );
    return {
      kind,
      document: {
        work:
          workKind === 'update'
            ? { kind: workKind, update: byteString(work, 'update', where) }
            : workKind === 'text'
              ? { kind: workKind, text: text(work, 'text', where) }
              : { kind: workKind },
        epoch: count(save, 'epoch', where),
        observed:
          save['observed'] === null
            ? null
            : byteString(save, 'observed', where),
      },
    };
  }
  return {
    kind,
    digest: text(row, 'digest', where),
    objectId: text(row, 'objectId', where),
  };
}

/** Narrows one stored submitted revision. */
function validateRevisionInput(value: unknown, where: string): RevisionInput {
  const row = object(value, where);
  return {
    id: text(row, 'id', where),
    fileId: text(row, 'fileId', where),
    parents: textList(row, 'parents', where),
    path: text(row, 'path', where),
    deleted: flag(row, 'deleted', where),
    content: validateContentRef(row['content'], `${where}.content`),
    clientTime: text(row, 'clientTime', where),
    message: optionalText(row, 'message', where),
    restoredFrom: optionalText(row, 'restoredFrom', where),
  };
}

/** Narrows one stored changeset body. */
export function validateChangesetInput(value: unknown): ChangesetInput {
  const where = 'changeset';
  const row = object(value, where);
  const heads = object(row['expectedHeads'], `${where}.expectedHeads`);
  const expectedHeads: Record<string, string | null> = {};
  for (const [fileId, head] of Object.entries(heads)) {
    if (head !== null && typeof head !== 'string')
      corrupt(`${where}.expectedHeads.${fileId} is not a revision or null`);
    expectedHeads[fileId] = head;
  }
  const revisions: unknown = row['revisions'];
  if (!Array.isArray(revisions)) corrupt(`${where}.revisions is not a list`);
  const list: unknown[] = revisions;
  return {
    workspaceId: text(row, 'workspaceId', where),
    mutationId: text(row, 'mutationId', where),
    deviceId: text(row, 'deviceId', where),
    expectedHeads,
    revisions: list.map((entry: unknown, index: number) =>
      validateRevisionInput(entry, `${where}.revisions[${String(index)}]`),
    ),
  };
}

/** Narrows one stored queue entry. */
export function validateQueueRow(value: unknown): QueueRow {
  const row = object(value, 'queue entry');
  const states: readonly QueueState[] = ['pending', 'sending', 'conflict'];
  return {
    ...partition(row, 'queue entry'),
    mutationId: text(row, 'mutationId', 'queue entry'),
    sequence: count(row, 'sequence', 'queue entry'),
    input: validateChangesetInput(row['input']),
    state: member(row, 'state', states, 'queue entry'),
    digest: optionalText(row, 'digest', 'queue entry'),
    errorCode: optionalText(row, 'errorCode', 'queue entry'),
    createdAt: text(row, 'createdAt', 'queue entry'),
  };
}

/** Narrows one stored checkpoint. */
export function validateCheckpoint(value: unknown): CheckpointRow {
  const row = object(value, 'checkpoint');
  return {
    ...partition(row, 'checkpoint'),
    revisionId: text(row, 'revisionId', 'checkpoint'),
    fileId: text(row, 'fileId', 'checkpoint'),
    workingCopyId: text(row, 'workingCopyId', 'checkpoint'),
    parents: textList(row, 'parents', 'checkpoint'),
    path: text(row, 'path', 'checkpoint'),
    deleted: flag(row, 'deleted', 'checkpoint'),
    digest: text(row, 'digest', 'checkpoint'),
    message: optionalText(row, 'message', 'checkpoint'),
    clientTime: text(row, 'clientTime', 'checkpoint'),
    mutationId: text(row, 'mutationId', 'checkpoint'),
    accepted: flag(row, 'accepted', 'checkpoint'),
    sequence: count(row, 'sequence', 'checkpoint'),
  };
}

/** Narrows one stored content body. */
export function validateContent(value: unknown): ContentRow {
  const row = object(value, 'content');
  const body: unknown = row['text'];
  const bytes: unknown = row['bytes'];
  if (body === null && !(bytes instanceof Blob))
    corrupt('content carries neither text nor bytes');
  if (body !== null && typeof body !== 'string')
    corrupt('content.text is not text or null');
  if (bytes !== null && !(bytes instanceof Blob))
    corrupt('content.bytes is not a blob or null');
  return {
    ...partition(row, 'content'),
    digest: text(row, 'digest', 'content'),
    text: typeof body === 'string' ? body : null,
    bytes: bytes instanceof Blob ? bytes : null,
    size: count(row, 'size', 'content'),
  };
}

/** Narrows one stored file record. */
export function validateAcceptedFile(value: unknown): FileRow {
  const row = object(value, 'file');
  return {
    ...partition(row, 'file'),
    fileId: text(row, 'fileId', 'file'),
    path: text(row, 'path', 'file'),
    kind: member(row, 'kind', ['note', 'attachment'] as const, 'file'),
    acceptedHeadRevisionId: optionalText(row, 'acceptedHeadRevisionId', 'file'),
    acceptedHeadDigest: optionalText(row, 'acceptedHeadDigest', 'file'),
    localHeadRevisionId: optionalText(row, 'localHeadRevisionId', 'file'),
    deleted: flag(row, 'deleted', 'file'),
    updatedAt: text(row, 'updatedAt', 'file'),
  };
}

/** Narrows one stored receipt. */
export function validateReceipt(value: unknown): ReceiptRow {
  const row = object(value, 'receipt');
  return {
    ...partition(row, 'receipt'),
    mutationId: text(row, 'mutationId', 'receipt'),
    revisionIds: textList(row, 'revisionIds', 'receipt'),
    cursor: text(row, 'cursor', 'receipt'),
    acknowledgedAt: text(row, 'acknowledgedAt', 'receipt'),
  };
}

/** Narrows one staged snapshot. */
export function validateSnapshot(value: unknown): SnapshotRow {
  const row = object(value, 'snapshot');
  return {
    ...partition(row, 'snapshot'),
    token: text(row, 'token', 'snapshot'),
    revisionIds: textList(row, 'revisionIds', 'snapshot'),
    cursor: text(row, 'cursor', 'snapshot'),
    state: member(
      row,
      'state',
      ['staging', 'complete', 'active'] as const,
      'snapshot',
    ),
    createdAt: text(row, 'createdAt', 'snapshot'),
  };
}

/** Narrows one staged snapshot item. */
export function validateSnapshotItem(value: unknown): SnapshotItemRow {
  const row = object(value, 'snapshot item');
  return {
    ...partition(row, 'snapshot item'),
    token: text(row, 'token', 'snapshot item'),
    revisionId: text(row, 'revisionId', 'snapshot item'),
    fileId: text(row, 'fileId', 'snapshot item'),
    path: text(row, 'path', 'snapshot item'),
    kind: member(row, 'kind', ['note', 'attachment'] as const, 'snapshot item'),
    deleted: flag(row, 'deleted', 'snapshot item'),
    digest: text(row, 'digest', 'snapshot item'),
    storedAt: text(row, 'storedAt', 'snapshot item'),
    document: addedBytes(row, 'document', 'snapshot item'),
    epoch: addedCount(row, 'epoch', 'snapshot item'),
  };
}

/** Narrows the single sync worker lease. */
export function validateLease(value: unknown): LeaseRow {
  const row = object(value, 'lease');
  if (text(row, 'key', 'lease') !== 'worker')
    corrupt('lease.key is unexpected');
  return {
    key: 'worker',
    ownerId: text(row, 'ownerId', 'lease'),
    expiresAt: count(row, 'expiresAt', 'lease'),
  };
}

/** Narrows one stored change position. */
export function validateCursor(value: unknown): CursorRow {
  const row = object(value, 'cursor');
  return {
    ...partition(row, 'cursor'),
    cursor: text(row, 'cursor', 'cursor'),
    updatedAt: text(row, 'updatedAt', 'cursor'),
  };
}

/** Narrows one stored setting. */
export function validatePreference(value: unknown): PreferenceRow {
  const row = object(value, 'preference');
  return {
    ...partition(row, 'preference'),
    name: text(row, 'name', 'preference'),
    value: text(row, 'value', 'preference'),
  };
}

/** Reads one stored byte string, or refuses the row. */
function byteString(
  row: Record<string, unknown>,
  name: string,
  table: string,
): Uint8Array {
  const value = row[name];
  if (value instanceof Uint8Array) return value;
  // A structured clone can return an ArrayBuffer for bytes that an older
  // engine stored, so the value is read and never asserted.
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new LocalStorageError('corrupt', `${table}.${name} is not bytes`);
}

/**
 * Bytes, or `null` for a field that a record written before it existed omits.
 *
 * A staged snapshot item of an earlier release carries no document, and the
 * item of an attachment never carries one.
 */
function addedBytes(
  row: Record<string, unknown>,
  name: string,
  table: string,
): Uint8Array | null {
  const value: unknown = row[name];
  if (value === undefined || value === null) return null;
  return byteString(row, name, table);
}

/** A number, or `null` for a field that a record omits. */
function addedCount(
  row: Record<string, unknown>,
  name: string,
  table: string,
): number | null {
  const value: unknown = row[name];
  if (value === undefined || value === null) return null;
  return count(row, name, table);
}

/** Narrows one stored document of a note. */
export function validateDocument(value: unknown): DocumentRow {
  const row = object(value, 'document');
  return {
    ...partition(row, 'document'),
    fileId: text(row, 'fileId', 'document'),
    bytes: byteString(row, 'bytes', 'document'),
    epoch: count(row, 'epoch', 'document'),
    appliedVector: byteString(row, 'appliedVector', 'document'),
  };
}

/** Narrows one stored recovery entry. */
export function validateRecovery(value: unknown): RecoveryRow {
  const row = object(value, 'recovery');
  return {
    ...partition(row, 'recovery'),
    recoveryId: text(row, 'recoveryId', 'recovery'),
    fileId: text(row, 'fileId', 'recovery'),
    path: text(row, 'path', 'recovery'),
    text: text(row, 'text', 'recovery'),
    reason: member(
      row,
      'reason',
      ['purged', 'sign_out', 'save_refused', 'stale_draft'] as const,
      'recovery',
    ),
    code: addedText(row, 'code', 'recovery'),
    mutationId: addedText(row, 'mutationId', 'recovery'),
    createdAt: text(row, 'createdAt', 'recovery'),
  };
}

/** Narrows the bookkeeping row. */
export function validateMeta(value: unknown): MetaRow {
  const row = object(value, 'meta');
  const states: readonly MigrationState[] = ['complete', 'in-progress'];
  if (text(row, 'key', 'meta') !== metaKey) corrupt('meta.key is unexpected');
  return {
    key: metaKey,
    schemaVersion: count(row, 'schemaVersion', 'meta'),
    migrationState: member(row, 'migrationState', states, 'meta'),
    deviceId: text(row, 'deviceId', 'meta'),
  };
}

/**
 * One step from one schema version to the next.
 *
 * Version 1 is the first released schema. Version 2 adds the sync worker
 * lease and the staged snapshot items; both tables start empty, so the step
 * only records the move. Version 4 removes what the conflict-branch feature
 * wrote. A gap between two stored versions with no step is a refusal, never
 * a silent continuation.
 */
export const migrationSteps: readonly {
  readonly from: number;
  readonly to: number;
  readonly run: (tables: Tables) => Promise<void>;
}[] = [
  {
    from: 1,
    to: 2,
    run: () => Promise.resolve(),
  },
  {
    from: 2,
    to: 3,
    run: async (tables): Promise<void> => {
      await tables.queue.toCollection().modify((value: unknown) => {
        if (!isWritableRecord(value)) return;
        value['errorCode'] = null;
      });
    },
  },
  {
    from: 3,
    to: 4,
    run: async (tables): Promise<void> => {
      // The branch members of a queue entry have no reader left. The Dexie
      // schema of version 4 already deleted the `branches` table itself.
      await tables.queue.toCollection().modify((value: unknown) => {
        if (!isWritableRecord(value)) return;
        delete value['conflictGroupId'];
        delete value['branchMutationId'];
        delete value['branchState'];
      });
      // Only a revoked membership or a viewer downgrade wrote these two
      // reasons, and neither can happen now. No shipped code path ever wrote
      // one, so nothing of the person's work is dropped here.
      await tables.recovery
        .filter((row: unknown) => {
          if (!isWritableRecord(row)) return false;
          const reason: unknown = row['reason'];
          return reason === 'access_revoked' || reason === 'role_downgraded';
        })
        .delete();
    },
  },
];

/** The most records held for validation at one time. */
const validationBatchSize = 100;

/** Reads and validates one table without holding all of its rows. */
async function validateTable<Row, Key>(
  table: Table<Row, Key>,
  validate: (value: unknown) => unknown,
): Promise<void> {
  let offset = 0;
  for (;;) {
    const rows = await table
      .toCollection()
      .offset(offset)
      .limit(validationBatchSize)
      .toArray();
    for (const row of rows) validate(row);
    if (rows.length < validationBatchSize) return;
    offset += rows.length;
  }
}

/**
 * Reads and validates every record of every partitioned table.
 *
 * Each table is read in fixed-size batches. No table becomes one in-memory
 * array, so repair cost grows with the record count but its memory use stays
 * bounded. This runs only when a migration is pending. It checks that an
 * interrupted change left every record in a shape this application can read.
 */
async function revalidate(tables: Tables): Promise<void> {
  await validateTable(tables.drafts, validateDraft);
  await validateTable(tables.checkpoints, validateCheckpoint);
  await validateTable(tables.contents, validateContent);
  await validateTable(tables.acceptedFiles, validateAcceptedFile);
  await validateTable(tables.queue, validateQueueRow);
  await validateTable(tables.receipts, validateReceipt);
  await validateTable(tables.stagedSnapshots, validateSnapshot);
  await validateTable(tables.snapshotItems, validateSnapshotItem);
  await validateTable(tables.leases, validateLease);
  await validateTable(tables.cursors, validateCursor);
  await validateTable(tables.preferences, validatePreference);
  await validateTable(tables.recovery, validateRecovery);
  await validateTable(tables.documents, validateDocument);
}

/**
 * Applies the record migration from one stored version to the current one.
 *
 * A rerun at the current version revalidates every record, because an
 * interrupted migration may have written a record and stopped before the next
 * one. Validation is the check that the database is complete and readable.
 */
async function migrateRecords(
  tables: Tables,
  from: number,
  to: number,
): Promise<void> {
  let version = from;
  while (version < to) {
    const step = migrationSteps.find((entry) => entry.from === version);
    if (step === undefined)
      throw new LocalStorageError(
        'corrupt',
        `no migration step leads away from schema version ${String(version)}`,
      );
    await step.run(tables);
    version = step.to;
  }
  await revalidate(tables);
}

/** The result of the schema check that runs on every open. */
export type SchemaState = {
  readonly meta: MetaRow;
  /** Whether an interrupted migration was found and completed. */
  readonly repaired: boolean;
};

/**
 * Checks the stored schema state and completes an interrupted migration.
 *
 * The three writes are separate transactions on purpose. Marking the migration
 * as running has to be durable before the records change, otherwise a stop in
 * the middle would leave a database that claims to be complete. The record
 * migration itself is one transaction over every table, so it either applies
 * fully or not at all.
 *
 * A database written by a newer application version, or one whose stored
 * version has no migration step, is refused with a `corrupt` failure. The
 * application then stops claiming persistence rather than editing records
 * whose shape it does not know.
 */
export async function ensureSchema(
  tables: Tables,
  newDeviceId: () => string,
): Promise<SchemaState> {
  const stored: unknown = await tables.meta.get(metaKey);
  if (stored === undefined) {
    const meta: MetaRow = {
      key: metaKey,
      schemaVersion: currentSchemaVersion,
      migrationState: 'complete',
      deviceId: newDeviceId(),
    };
    await tables.meta.put(meta);
    return { meta, repaired: false };
  }
  const meta = validateMeta(stored);
  if (meta.schemaVersion > currentSchemaVersion)
    throw new LocalStorageError(
      'corrupt',
      `stored schema version ${String(meta.schemaVersion)} is newer than this application`,
    );
  if (
    meta.migrationState === 'complete' &&
    meta.schemaVersion === currentSchemaVersion
  )
    return { meta, repaired: false };

  const running: MetaRow = { ...meta, migrationState: 'in-progress' };
  await tables.meta.put(running);
  const db = tables.meta.db;
  await db.transaction('rw', tableNames, async () => {
    await migrateRecords(tables, meta.schemaVersion, currentSchemaVersion);
  });
  const done: MetaRow = {
    ...meta,
    schemaVersion: currentSchemaVersion,
    migrationState: 'complete',
  };
  await tables.meta.put(done);
  return { meta: done, repaired: true };
}

/**
 * Whether a schema failure blocks an application upgrade.
 *
 * A database written by a newer application, or one whose interrupted
 * migration cannot be repaired, keeps the old application usable: the caller
 * shows the blocked-upgrade instructions and keeps drafts in memory instead
 * of discarding them or retrying the migration. Any other local failure is
 * not a blocked upgrade.
 */
export function isBlockedUpgradeError(value: unknown): boolean {
  if (!(value instanceof LocalStorageError)) return false;
  if (value.kind !== 'corrupt') return false;
  return (
    value.message.includes('newer than this application') ||
    value.message.includes('no migration step leads away') ||
    value.message.includes('is not a record') ||
    value.message.includes('is not text') ||
    value.message.includes('is not a flag') ||
    value.message.includes('is not a finite number') ||
    value.message.includes('is not text or null') ||
    value.message.includes('found an unreadable database')
  );
}

/**
 * The blocked-upgrade instructions shown without losing drafts.
 *
 * The user keeps the in-memory buffer with clipboard access, closes every
 * other tab of this application, then reloads this tab so the newest
 * application runs the migration once. Nothing is discarded by the upgrade.
 */
export const blockedUpgradeInstructions =
  'Another tab runs a newer version or the local upgrade is blocked. ' +
  'Keep this tab open so drafts stay in memory, close every other tab of ' +
  'this application, then reload this tab to finish the upgrade. ' +
  'No draft is discarded by these steps.';
