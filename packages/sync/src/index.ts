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
  AttachmentPin,
  BranchSubmissionState,
  CheckpointRecord,
  Draft,
  LocalAcceptedFile,
  LocalBranch,
  LocalCachedNote,
  LocalContent,
  LocalChange,
  LocalConflict,
  LocalCursor,
  LocalFileKind,
  LocalFileSummary,
  LocalReceipt,
  LocalStorageErrorKind,
  LocalStore,
  FileSaveSnapshot,
  Partition,
  Preference,
  QueueEntry,
  QueueState,
  RecoveryInput,
  RecoveryReason,
  RecoveryRecord,
  ResolvedConflict,
  StagedSnapshot,
} from './local-port.ts';
export {
  accountWide,
  isLocalStorageError,
  LocalStorageError,
} from './local-port.ts';
export type {
  RemoteChange,
  RemoteFileChange,
  SnapshotRevision,
} from './local-port.ts';
export type {
  BranchInput,
  BranchResult,
  CommitResult,
  Problem,
  PushOutcome,
  QueueNetwork,
  ServiceOutcome,
  SyncContext,
  SyncNotice,
} from './queue.ts';
export {
  backoffBaseMs,
  backoffCapMs,
  backoffDelay,
  isRetryableStatus,
  maxAttempts,
  pushQueue,
  sendWithRetry,
  SnapshotRestartNeeded,
  SyncFailedError,
} from './queue.ts';
export type {
  ChangeRecord,
  PullOutcome,
  RevisionData,
  SnapshotItemData,
  SnapshotNetwork,
} from './snapshot.ts';
export { pullNew } from './snapshot.ts';
export type { WorkerLease } from './lease.ts';
export {
  acquireWorkerLease,
  isLeaseExpired,
  readWorkerLease,
  releaseWorkerLease,
} from './lease.ts';
export type {
  EngineOptions,
  EngineOperations,
  SessionNetwork,
  SyncEngine,
} from './engine.ts';
export { createSyncEngine } from './engine.ts';
export type { LocalSearchFile } from './local-search.ts';
export { searchLocal } from './local-search.ts';
