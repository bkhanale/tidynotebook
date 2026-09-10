/**
 * Public entry point of the notesapp domain core.
 *
 * This package holds the rules that both runtimes share: the role and action
 * matrix, path rules, revision graph rules, and the storage ports that the
 * server implements. It must stay free of Node built-in modules, a database
 * driver, an HTTP framework, a browser database, and the generated HTTP
 * client, because the browser also runs these rules.
 *
 * Only the names below are public. The verified actor marker stays internal,
 * so an actor can be built only through `verifyActor`.
 */
export type { Action, Actor, Grant, Role } from './identity/actor.ts';
export { actionsForRole, authorize, verifyActor } from './identity/actor.ts';
export { generateUUID } from './identity/uuid.ts';
export type {
  AcceptedChangeset,
  AcceptedRevision,
  ChangesetInput,
  ContentRef,
  DomainError,
  DomainErrorCode,
  Result,
  RevisionInput,
  SupersededHead,
} from './files/model.ts';
export { fail, ok } from './files/model.ts';
export type { PathKind } from './files/path.ts';
export { normalizePath } from './files/path.ts';
export { validateGraph } from './files/graph.ts';
export {
  CanonicalJsonError,
  canonicalJson,
  contentDigest,
  requestDigest,
} from './files/digest.ts';
export type {
  AcceptedBranch,
  BlockingReference,
  DeletedFilePage,
  DeletedFileRecord,
  BranchFilter,
  BranchRecord,
  BranchState,
  FileKind,
  FilePage,
  FileRecord,
  HeadState,
  HistoryPage,
  HistoryRevision,
  MutationReceipt,
  OperationalErrorKind,
  PageRequest,
  PurgePreview,
  PurgedFilesResult,
  RevisionRecord,
  CreateShareRecord,
  PublicShareReader,
  PublicShareRecord,
  ShareRecord,
  SharingStore,
  SnapshotItem,
  SnapshotPage,
  SnapshotStart,
  StartSnapshotInput,
  SubmitBranchInput,
  SyncChange,
  SyncChangeFeed,
  SyncEntityKind,
  SyncPage,
  TransactOptions,
  WorkspaceStore,
  WorkspaceTransaction,
} from './files/ports.ts';
export { isOperationalError, OperationalError } from './files/ports.ts';
export { commitChangeset, maxFilesPerChangeset } from './files/commit.ts';
export type {
  CreateFileInput,
  FolderMember,
  RenameFolderInput,
  SubmissionIds,
  UpdateFileInput,
} from './files/operations.ts';
export {
  createFileChangeset,
  markdownContent,
  renameFolderChangeset,
  tombstoneContent,
  updateFileChangeset,
} from './files/operations.ts';
export type {
  AttachmentMediaType,
  AttachmentObjectRecord,
  AttachmentState,
} from './files/attachments.ts';
export {
  allowedMediaTypes,
  createAttachmentChangeset,
  isAllowedMediaType,
} from './files/attachments.ts';
export type { RestoreFileInput } from './files/trash.ts';
export {
  listDeletedFiles,
  restoreCandidates,
  restoreFile,
} from './files/trash.ts';
export type { FileWithHead } from './files/read.ts';
export {
  defaultPageSize,
  listFiles,
  maxPageSize,
  pageSize,
  readFile,
  readHeadForWrite,
  readMutationReceipt,
  readRevision,
} from './files/read.ts';
export type {
  AccountTransaction,
  InvitationInput,
  InvitationState,
  InvitationSummary,
  Member,
  Preferences,
  ThemeChoice,
  WorkspaceAdminStore,
  WorkspaceAdminTransaction,
  WorkspaceSummary,
} from './workspaces/ports.ts';
export {
  acceptInvitation,
  createWorkspace,
  deleteWorkspace,
  invitationLifetimeMs,
  inviteMember,
  listMembers,
  listWorkspaces,
  readPreferences,
  removeMember,
  sessionGrants,
  themeChoices,
  transferOwnership,
  updateMember,
  updatePreferences,
  updateWorkspace,
} from './workspaces/service.ts';
export type {
  AcceptedBranchResolution,
  BranchResolution,
  CreateCheckpointInput,
  ResolveBranchesInput,
  RestoreRevisionInput,
} from './history/service.ts';
export {
  createCheckpoint,
  defaultHistoryLimit,
  listBranches,
  listHistory,
  maxHistoryLimit,
  resolveBranches,
  restoreRevision,
  submitBranch,
} from './history/service.ts';
export { previewPurge, purgeFiles } from './history/purge.ts';
export type { CreateShareInput, UpdateShareInput } from './sharing/service.ts';
export {
  createShare,
  listShares,
  revokeShare,
  updateShare,
} from './sharing/service.ts';
export type {
  SnapshotPageOptions,
  StartSnapshotOptions,
  SyncChangesOptions,
} from './files/snapshot.ts';
export {
  formatSyncCursor,
  getChanges,
  getSnapshotPage,
  isSupportedSyncVersion,
  maxOpenSnapshots,
  parseSyncCursor,
  snapshotDefaultPageSize,
  snapshotMaxPageSize,
  snapshotPageSize,
  snapshotPosition,
  snapshotTtlMs,
  startSnapshot,
  supportedSyncVersions,
  syncDefaultLimit,
  syncLimit,
  syncMaxLimit,
  syncRetentionDays,
} from './files/snapshot.ts';
export type { Backlink, SearchHit } from './search/service.ts';
export {
  defaultSearchLimit,
  getBacklinks,
  maxSearchLimit,
  searchFiles,
  searchLimit,
} from './search/service.ts';
