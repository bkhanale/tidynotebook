/**
 * Public entry point of the notesapp sync package.
 *
 * This package owns the local persistence port and the pure rules of offline
 * work. It runs in the browser, so it imports no Node module, no browser
 * database, and no server package. `@notesapp/storage-browser` implements the
 * port with IndexedDB; the sync engine of Task 11 uses the same port.
 */
export type {
  CheckpointComparison,
  CheckpointDecision,
  CheckpointReason,
  CheckpointScheduler,
  CheckpointSchedulerOptions,
  TimerHandle,
} from './checkpoints.ts';
export {
  createCheckpointScheduler,
  defaultIdleMs,
  defaultMaxIntervalMs,
  shouldCheckpoint,
} from './checkpoints.ts';
export type {
  CheckpointRecord,
  Draft,
  LocalAcceptedFile,
  LocalBranch,
  LocalContent,
  LocalCursor,
  LocalFileKind,
  LocalReceipt,
  LocalStorageErrorKind,
  LocalStore,
  Partition,
  Preference,
  QueueEntry,
  QueueState,
  RecoveryReason,
  RecoveryRecord,
  StagedSnapshot,
} from './local-port.ts';
export {
  accountWide,
  isLocalStorageError,
  LocalStorageError,
} from './local-port.ts';
