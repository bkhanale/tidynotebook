/**
 * Public entry point of the notesapp server.
 *
 * The HTTP boundary is generated from `@notesapp/api-contract`. Nothing here
 * declares a route, a request shape, or a response shape by hand.
 */
export type { LogLevel, MailConfig, ServerConfig } from './config.ts';
export {
  ConfigError,
  loadProtectedEnvironment,
  loadServerConfig,
} from './config.ts';
export type {
  Drain,
  DrainEvent,
  DrainOptions,
  DrainTimers,
  ServiceLifecycle,
  ServiceState,
} from './lifecycle.ts';
export {
  createDrain,
  createServiceLifecycle,
  realTimers,
  runningLifecycle,
} from './lifecycle.ts';
export type { AppOptions } from './app.ts';
export { createApp, createAppWithHandlers } from './app.ts';
export type {
  HandlerDependencies,
  ReadinessCheck,
  ReadinessProbe,
} from './routes/handlers.ts';
export {
  configurationProbe,
  createHandlers,
  databaseProbe,
  evaluateReadiness,
  migrationProbe,
  storageProbe,
} from './routes/handlers.ts';
export { attachRequestLogging, redactUrl } from './request-log.ts';
export type {
  HandlerMap,
  HandlerResult,
  IdentityResolver,
  ProtocolAdapter,
  ProtocolResult,
} from './plugins/register.ts';
export type {
  IdentityAdapter,
  IdentityDependencies,
  ResolvedActor,
} from './auth/actor.ts';
export {
  createIdentityAdapter,
  requestActor,
  requireActor,
} from './auth/actor.ts';
export type {
  AuthHandle,
  AuthOptions,
  NotesappAuth,
} from './auth/better-auth.ts';
export { createSetupHandlers } from './auth/setup.ts';
export {
  authBasePath,
  authRoutes,
  betterAuthProtocol,
  createAuth,
  createAuthPool,
  createAuthProtocol,
} from './auth/better-auth.ts';
export type { Problem, ProblemCode } from './plugins/problem.ts';
export {
  createProblem,
  DomainProblemError,
  ForbiddenError,
  NotFoundError,
  OriginRequiredError,
  PreconditionRequiredError,
  problemMediaType,
  UnauthenticatedError,
} from './plugins/problem.ts';
export {
  createFileHandlers,
  missingWorkspaceStore,
  parseTag,
  revisionTag,
} from './routes/files.ts';
export type { MailMessage, MailTransport } from './auth/mail.ts';
export { createMailTransport } from './auth/mail.ts';
export { bootstrapOwner, type BootstrapResult } from './cli/bootstrap.ts';
export { recoverAccount, type RecoveryResult } from './cli/recover-account.ts';
export { createSyncCleanup } from './jobs/sync-cleanup.ts';
export { createAttachmentCleanup } from './jobs/attachment-cleanup.ts';
export { createSearchHandlers } from './routes/search.ts';
