/**
 * Content-free structured request logging.
 *
 * Note bodies, search queries, passwords, tokens and cookies never reach a log
 * record. The URL passes through a redaction step first.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Content-free request log entry. */
export type RequestLogRecord = {
  readonly requestId: string;
  readonly method: string;
  readonly url: string;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly errorCode?: string;
};

/** Redacts sensitive path segments and query strings from a URL. */
export function redactUrl(rawUrl: string): string {
  const [pathPart] = rawUrl.split('?');
  const path = (pathPart ?? rawUrl).replace(
    /^(\/s\/)[^/?]+(?:\/attachments\/[^/?]+)?/,
    '$1[redacted]',
  );
  // Redact any query string completely to ensure search terms and parameters never leak.
  if (rawUrl.includes('?')) {
    return `${path}?[redacted]`;
  }
  return path;
}

/** Attaches the content-free request log hooks to the Fastify application. */
export function attachRequestLogging(app: FastifyInstance): void {
  app.addHook(
    'onRequest',
    async (request: FastifyRequest & { startTime?: bigint }) => {
      request.startTime = process.hrtime.bigint();
    },
  );

  app.addHook(
    'onResponse',
    async (
      request: FastifyRequest & { startTime?: bigint },
      reply: FastifyReply,
    ) => {
      const durationMs = request.startTime
        ? Number(process.hrtime.bigint() - request.startTime) / 1_000_000
        : 0;

      if (app.log && typeof app.log.info === 'function') {
        app.log.info({
          type: 'request',
          requestId: request.id,
          method: request.method,
          url: redactUrl(request.url),
          statusCode: reply.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        });
      }
    },
  );
}
