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
export { authorize, verifyActor } from './identity/actor.ts';
export type {
  AcceptedChangeset,
  ChangesetInput,
  ContentRef,
  DomainError,
  DomainErrorCode,
  Result,
  RevisionInput,
} from './files/model.ts';
export { fail, ok } from './files/model.ts';
export type { PathKind } from './files/path.ts';
export { normalizePath } from './files/path.ts';
export { validateGraph } from './files/graph.ts';
export type {
  MutationReceipt,
  OperationalErrorKind,
  WorkspaceStore,
  WorkspaceTransaction,
} from './files/ports.ts';
export { isOperationalError, OperationalError } from './files/ports.ts';
