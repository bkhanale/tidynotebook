/**
 * Public entry point of the notesapp browser storage package.
 *
 * It implements the local persistence port of `@notesapp/sync` with IndexedDB
 * through Dexie. The web application composes the two; nothing else opens a
 * browser database.
 */
export type {
  BranchRow,
  CheckpointRow,
  ContentRow,
  CursorRow,
  DraftRow,
  FileRow,
  LocalDatabase,
  MetaRow,
  MigrationState,
  PreferenceRow,
  QueueRow,
  ReceiptRow,
  RecoveryRow,
  SnapshotRow,
  Tables,
} from './database.ts';
export {
  createDatabase,
  defaultDatabaseName,
  metaKey,
  partitionRange,
  schemaVersions,
  tableNames,
  toLocalStorageError,
} from './database.ts';
export type { SchemaState } from './migrations.ts';
export {
  currentSchemaVersion,
  ensureSchema,
  migrationSteps,
  validateAcceptedFile,
  validateBranch,
  validateChangesetInput,
  validateCheckpoint,
  validateContent,
  validateCursor,
  validateDraft,
  validateMeta,
  validatePreference,
  validateQueueRow,
  validateReceipt,
  validateRecovery,
  validateSnapshot,
} from './migrations.ts';
export type { LocalStoreOptions } from './local-store.ts';
export { openLocalStore } from './local-store.ts';
