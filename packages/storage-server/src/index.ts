/**
 * Public entry point of the notesapp server storage package.
 *
 * This package is Node only. It implements the workspace storage ports that
 * `@notesapp/core` owns, and it holds the PostgreSQL schema, the reviewed
 * migrations, and the roles and row access policies that protect the data.
 * A browser package must never import it.
 */
export {
  DatabaseFailure,
  openWorkspaceStore,
  WorkspaceUnavailableError,
  type WorkspaceStoreHandle,
  type WorkspaceStoreOptions,
} from './workspace-store.ts';
export {
  main as runMigrationCommand,
  migrationsFolder,
  runMigrations,
  runtimeRole,
  testDatabaseUrl,
  testRuntimePassword,
  type MigrationRun,
} from './migrate.ts';
export {
  assertProfileDatabase,
  databaseName,
  isTestDatabaseName,
  parseProfile,
  testDatabasePrefix,
  withCredentials,
  withDatabaseName,
  type MigrationProfile,
} from './profiles.ts';
export { createTestDatabase, dropTestDatabase } from './admin.ts';
export {
  openIdentityStore,
  type IdentityStoreHandle,
  type IdentityStoreOptions,
} from './identity-store.ts';
export {
  accountIdentities,
  accountPreferences,
  agentTokens,
  authAccount,
  authSession,
  authUser,
  authVerification,
  invitations,
} from './schema.ts';
export {
  defaultQuotaBytes,
  provisionAccounts,
  provisionWorkspace,
  type WorkspaceSeed,
} from './provision.ts';
