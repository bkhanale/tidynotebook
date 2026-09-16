/**
 * Content-free structured request logging.
 *
 * Note bodies, search queries, passwords, tokens and cookies never reach a log
 * record. The URL passes through a redaction step first.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createServerLogger } from './logging.ts';

const passwordResetTokenPath = /^(\/api\/auth\/reset-password\/)[^/]+/;

/**
 * The whole reader boundary of a published link.
 *
 * Decision 0046 puts the token of a link in a path segment and states that
 * `/published/` is the whole reader boundary, so one rule matches one shape.
 * Everything after the prefix goes: the token opens the link, and the note and
 * the revision of a picture are identifiers that no log line needs.
 */
const publishedReaderPath = /^(\/published\/).*$/;

/** Redacts every secret path segment of one address. */
export function redactPath(path: string): string {
  return path
    .replace(passwordResetTokenPath, '$1[redacted]')
    .replace(publishedReaderPath, '$1[redacted]');
}

/** Redacts secret path segments and the query string of a URL. */
export function redactUrl(rawUrl: string): string {
  const [pathPart] = rawUrl.split('?');
  const path = redactPath(pathPart ?? rawUrl);
  // The query string goes completely, so a search term and the reading ticket
  // of a published link never reach a log.
  if (rawUrl.includes('?')) {
    return `${path}?[redacted]`;
  }
  return path;
}

/** Attaches the content-free request log hooks to the Fastify application. */
export function attachRequestLogging(app: FastifyInstance): void {
  const logger = createServerLogger(app.log);
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

      logger.bind({ requestId: request.id }).emit('http.request.completed', {
        method: request.method,
        url: redactUrl(request.url),
        statusCode: reply.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    },
  );
}
