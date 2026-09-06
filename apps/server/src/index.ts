/**
 * Public entry point of the notesapp server.
 *
 * The HTTP boundary is generated from `@notesapp/api-contract`. Nothing here
 * declares a route, a request shape, or a response shape by hand.
 */
export type {
  LogLevel,
  MailConfig,
  OidcConfig,
  ServerConfig,
} from './config.ts';
export {
  ConfigError,
  loadProtectedEnvironment,
  loadServerConfig,
} from './config.ts';
export type { AppOptions } from './app.ts';
export { createApp, createAppWithHandlers, redactAccessUrl } from './app.ts';
export type {
  HandlerDependencies,
  ReadinessCheck,
  ReadinessProbe,
} from './http/handlers.ts';
export {
  configurationProbe,
  createHandlers,
  databaseProbe,
  evaluateReadiness,
  migrationProbe,
  storageProbe,
} from './http/handlers.ts';
export { WritePauseCoordinator, type WritePauseState } from './write-pause.ts';
export {
  MetricsCollector,
  attachObservability,
  redactUrl,
  type RequestLogRecord,
} from './observability.ts';
export type {
  HandlerMap,
  IdentityResolver,
  ProtocolAdapter,
  ProtocolResult,
} from './http/register.ts';
export type {
  ActorSource,
  IdentityAdapter,
  IdentityDependencies,
  ResolvedActor,
} from './auth/actor.ts';
export {
  agentTokenHash,
  createIdentityAdapter,
  requestActor,
  requireActor,
} from './auth/actor.ts';
export type {
  AuthHandle,
  AuthOptions,
  NotesappAuth,
} from './auth/better-auth.ts';
export {
  authBasePath,
  authRoutes,
  betterAuthProtocol,
  createAuth,
  createAuthPool,
  createAuthProtocol,
  oidcProviderId,
} from './auth/better-auth.ts';
export type { Problem, ProblemCode } from './http/problem.ts';
export {
  createProblem,
  DomainProblemError,
  ForbiddenError,
  NotFoundError,
  OidcRequiredError,
  OriginRequiredError,
  PreconditionRequiredError,
  problemMediaType,
  UnauthenticatedError,
} from './http/problem.ts';
export {
  createFileHandlers,
  missingWorkspaceStore,
  parseTag,
  revisionTag,
} from './http/files.ts';
export type {
  InvitationAccounts,
  OpenInvitation,
  RegistrationOutcome,
} from './auth/invitations.ts';
export { createInvitationAccounts } from './auth/invitations.ts';
export type { MailMessage, MailTransport } from './auth/mail.ts';
export { createMailTransport } from './auth/mail.ts';
export { invitationTokenHash } from './http/workspaces.ts';
export { bootstrapOwner, type BootstrapResult } from './cli/bootstrap.ts';
export { recoverAccount, type RecoveryResult } from './cli/recover-account.ts';
export { createSyncCleanup } from './jobs/sync-cleanup.ts';
export { createAttachmentCleanup } from './jobs/attachment-cleanup.ts';
export { createSearchHandlers } from './http/search.ts';
export { createSharingHandlers, publicTokenHash } from './http/sharing.ts';
export { publicSharePage } from './public/page.ts';
export type {
  ActiveOAuthToken,
  McpAuthDependencies,
  RegisteredOAuthClient,
} from './mcp/authorization.ts';
export {
  findRegisteredClient,
  McpAuthorizationServer,
  registerOAuthClient,
  sha256Hex,
  supportedMcpScopes,
  verifyPkce,
} from './mcp/authorization.ts';
export type { McpServerDependencies } from './mcp/server.ts';
export { createMcpHttpHandler, mountMcpServer } from './mcp/server.ts';
