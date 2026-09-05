/**
 * Public entry point of the notesapp server.
 *
 * The HTTP boundary is generated from `@notesapp/api-contract`. Nothing here
 * declares a route, a request shape, or a response shape by hand.
 */
export type { LogLevel, ServerConfig } from './config.ts';
export { ConfigError, loadServerConfig } from './config.ts';
export type { AppOptions } from './app.ts';
export { createApp, createAppWithHandlers } from './app.ts';
export type { ReadinessCheck, ReadinessProbe } from './http/handlers.ts';
export { createHandlers } from './http/handlers.ts';
export type { HandlerMap, IdentityResolver } from './http/register.ts';
