/**
 * Public entry point of the notesapp server.
 *
 * The HTTP boundary is generated from `@notesapp/api-contract`. Nothing here
 * declares a route, a request shape, or a response shape by hand.
 */
export type { ServerConfig } from './config.ts';
export { ConfigError, loadServerConfig } from './config.ts';
export { createApp, createAppWithHandlers } from './app.ts';
export { createHandlers, evaluateReadiness } from './http/handlers.ts';
export type {
  HandlerMap,
  HandlerResult,
  MediaHandling,
  OperationHandler,
} from './http/register.ts';
export {
  baseMediaType,
  mediaTypeHandling,
  registerOperations,
  toRoutePath,
} from './http/register.ts';
export type { Problem, ProblemCode } from './http/problem.ts';
export { createProblem, problemMediaType } from './http/problem.ts';
