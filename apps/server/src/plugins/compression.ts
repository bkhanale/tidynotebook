/**
 * Compression of a large JSON read (record 0169).
 *
 * Record 0013 puts delivery in the application, because a deployment may
 * have no proxy. The built assets arrive compressed from the build, and this
 * module does the same for the JSON answer of a read, which only exists when
 * a request asks for it.
 *
 * `answerEncoding` is the one rule. An answer is compressed when all of these
 * hold:
 *
 * - The request is a `GET` of a contract operation. A write can carry a new
 *   secret, such as the token of a published link, beside text that the
 *   caller chose, and a compressed size could then tell the secret apart.
 * - The answer succeeded, it is JSON, it carries no content coding yet, and
 *   it sets no cookie.
 * - The body reaches `compressionThresholdBytes`, below which the bytes that
 *   a coding saves do not pay for its work.
 *
 * Brotli at a low quality comes first and gzip second, in the order that
 * `acceptedEncodings` of `./static-assets.ts` gives, so the static files and
 * the API negotiate one way. The work runs in the thread pool of `node:zlib`,
 * so a large read does not hold the event loop. The entity tag stays as the
 * handler wrote it: it names the revision, which a write states as its
 * precondition, and no range of a JSON answer is served.
 */
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { acceptedEncodings, type StaticEncoding } from './static-assets.ts';

/** The smallest JSON body that is compressed, in bytes. */
export const compressionThresholdBytes = 1024;

/**
 * The Brotli quality of an answer.
 *
 * The build spends its time on the best ratio, because it compresses once. An
 * answer is compressed on each request, so a low quality keeps the work to a
 * few milliseconds for a large note and still beats gzip.
 */
const brotliQuality = 4;

const brotli = promisify(brotliCompress);
const deflate = promisify(gzip);

/** What the rule reads of one request and its answer. */
export type AnswerFacts = {
  readonly method: string;
  readonly status: number;
  readonly contentType: string;
  readonly contentEncoding: string;
  readonly setsCookie: boolean;
  readonly size: number;
  readonly acceptEncoding: string | undefined;
};

/** Whether the answer may be compressed, whatever the caller accepts. */
export function compressible(
  facts: Omit<AnswerFacts, 'acceptEncoding'>,
): boolean {
  const mediaType = facts.contentType.split(';')[0]?.trim().toLowerCase();
  return (
    facts.method === 'GET' &&
    facts.status >= 200 &&
    facts.status < 300 &&
    mediaType === 'application/json' &&
    facts.contentEncoding === '' &&
    !facts.setsCookie &&
    facts.size >= compressionThresholdBytes
  );
}

/** The coding of one answer, or `null` when it is sent as it is. */
export function answerEncoding(facts: AnswerFacts): StaticEncoding | null {
  if (!compressible(facts)) return null;
  return acceptedEncodings(facts.acceptEncoding)[0] ?? null;
}

/** The bytes of one body in one coding. */
export function encodeBody(
  body: Buffer,
  encoding: StaticEncoding,
): Promise<Buffer> {
  return encoding === 'br'
    ? brotli(body, {
        params: {
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
          [constants.BROTLI_PARAM_QUALITY]: brotliQuality,
          [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
        },
      })
    : deflate(body);
}

/** The text of one response header, or an empty string. */
function headerText(reply: FastifyReply, name: string): string {
  const value = reply.getHeader(name);
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return Array.isArray(value) ? value.join(', ') : '';
}

/**
 * The `onSend` hook of a contract read.
 *
 * It answers the payload to send: the compressed bytes, or the payload as the
 * framework serialized it.
 */
export async function compressAnswer(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
  const body = typeof payload === 'string' ? Buffer.from(payload) : payload;
  const facts = {
    method: request.method,
    status: reply.statusCode,
    contentType: headerText(reply, 'content-type'),
    contentEncoding: headerText(reply, 'content-encoding'),
    setsCookie: reply.hasHeader('set-cookie'),
    size: body.length,
  };
  if (!compressible(facts)) return payload;
  // The answer of this address depends on the codings that the caller
  // accepts, so a cache keeps one answer for each of them.
  const vary = headerText(reply, 'vary');
  if (!/(^|,)\s*accept-encoding\s*(,|$)/i.test(vary))
    reply.header(
      'vary',
      vary === '' ? 'Accept-Encoding' : `${vary}, Accept-Encoding`,
    );
  const encoding = answerEncoding({
    ...facts,
    acceptEncoding:
      typeof request.headers['accept-encoding'] === 'string'
        ? request.headers['accept-encoding']
        : undefined,
  });
  if (encoding === null) return payload;
  const encoded = await encodeBody(body, encoding);
  reply.header('content-encoding', encoding);
  reply.header('content-length', String(encoded.length));
  return encoded;
}
