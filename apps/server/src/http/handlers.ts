/**
 * Handlers of the operations that the contract declares today.
 *
 * A handler returns a status, a media type, and a body. The boundary validates
 * that body against the declared response schema before it is sent, so a
 * handler never has to repeat the contract shape.
 */
import type { ServerConfig } from '../config.ts';
import type { HandlerMap, HandlerResult } from './register.ts';
import { createProblem, problemMediaType } from './problem.ts';

const jsonMediaType = 'application/json';

/** Readiness of one startup requirement. */
type ReadinessCheck = {
  readonly name: string;
  readonly status: 'ok' | 'degraded';
  readonly detail?: string;
};

/** Amount of readiness information the caller asked for. */
function readDetailLevel(query: unknown): 'summary' | 'full' {
  if (query === null || typeof query !== 'object') return 'full';
  const value: unknown = Object.fromEntries(Object.entries(query)).detail;
  return value === 'summary' ? 'summary' : 'full';
}

/**
 * Evaluates every startup requirement that this release can check.
 *
 * Configuration is the only requirement today, because no database and no
 * attachment storage exists yet. The task that adds PostgreSQL adds a database
 * check to this list, and the task that adds attachment storage adds a storage
 * check.
 */
export function evaluateReadiness(
  config: ServerConfig,
  level: 'summary' | 'full',
): { status: 'ok' | 'degraded'; checks: readonly ReadinessCheck[] } {
  const configurationDetail =
    config.allowedHosts.length > 0
      ? 'Configuration was validated at startup. No database or attachment storage exists in this release, so nothing else is checked.'
      : 'The deployment serves no Host value, so no request can reach it.';
  const checks: ReadinessCheck[] = [
    {
      name: 'configuration',
      status: config.allowedHosts.length > 0 ? 'ok' : 'degraded',
      ...(level === 'full' ? { detail: configurationDetail } : {}),
    },
  ];
  return {
    status: checks.some((check) => check.status === 'degraded')
      ? 'degraded'
      : 'ok',
    checks,
  };
}

/** Builds the handler map for the operations in the contract. */
export function createHandlers(config: ServerConfig): HandlerMap {
  return {
    getHealth: (): Promise<HandlerResult> =>
      Promise.resolve({
        status: 200,
        mediaType: jsonMediaType,
        body: { status: 'ok' },
      }),
    getReadiness: (request): Promise<HandlerResult> => {
      const report = evaluateReadiness(config, readDetailLevel(request.query));
      if (report.status === 'ok')
        return Promise.resolve({
          status: 200,
          mediaType: jsonMediaType,
          body: report,
        });
      return Promise.resolve({
        status: 503,
        mediaType: problemMediaType,
        body: createProblem({
          code: 'not_ready',
          status: 503,
          detail: report.checks
            .filter((check) => check.status === 'degraded')
            .map((check) => check.name)
            .join(', '),
          instance: request.url.split('?')[0] ?? request.url,
          requestId: request.id,
        }),
      });
    },
  };
}
