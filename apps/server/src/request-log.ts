/**
 * Content-free structured request logging.
 *
 * Note bodies, search queries, passwords, tokens and cookies never reach a log
 * record. The URL passes through a redaction step first.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createServerLogger } from './logging.ts';

/**
 * The address prefixes whose remainder is a secret.
 *
 * One list, because two rules read it. The reset token of the account path is
 * one segment. The whole reader boundary of a published link is the other:
 * decision 0046 puts the token of a link in a path segment and states that
 * `/published/` is that whole boundary, so one prefix matches one shape.
 * Everything after it goes, because the token opens the link and the note and
 * the revision of a picture are identifiers that no record needs.
 */
const secretPrefixes = ['/api/auth/reset-password/', '/published/'] as const;

/** The prefix of this address whose remainder is a secret, or `null`. */
function secretPrefixOf(path: string): string | null {
  return secretPrefixes.find((prefix) => path.startsWith(prefix)) ?? null;
}

/** Redacts every secret path segment of one address, for a log record. */
export function redactPath(path: string): string {
  const prefix = secretPrefixOf(path);
  return prefix === null ? path : `${prefix}[redacted]`;
}

/**
 * The address of one request, as a problem body repeats it.
 *
 * A problem body declares `instance` as a URI reference, and `[redacted]` is
 * not one, so the marker of a log record cannot travel into an answer. A
 * secret address therefore keeps its prefix and loses everything after it. It
 * states what the caller asked for, it discloses nothing, and the boundary
 * check of the declared response schema accepts it.
 */
export function problemInstance(rawUrl: string): string {
  const path = rawUrl.split('?')[0] ?? rawUrl;
  return secretPrefixOf(path) ?? path;
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
