/**
 * Delivery of the built browser assets.
 *
 * The application serves its own front end, so caching, compression and the
 * document security policy belong here rather than to a reverse proxy that a
 * self-hosted installation may not have.
 *
 * Three rules decide every answer:
 *
 *   * A hashed file never changes under its name, so it is cached for a year
 *     and marked immutable. Everything else is revalidated on every load.
 *   * A precompressed neighbour is served when the caller accepts its
 *     encoding. The build writes `.br` and `.gz` next to each compressible
 *     file, so nothing is compressed per request.
 *   * A document gets the content policy of its kind. Everything else keeps
 *     the base policy of `security-headers.ts`.
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { basename } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  appShellContentPolicy,
  framedDocumentContentPolicy,
  inlineScriptHashes,
} from './security-headers.ts';

/** MIME content type mapping for web assets. */
export function mimeTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs'))
    return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.webmanifest'))
    return 'application/manifest+json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.ico')) return 'image/x-icon';
  if (filePath.endsWith('.woff')) return 'font/woff';
  if (filePath.endsWith('.woff2')) return 'font/woff2';
  if (filePath.endsWith('.map')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

/** A content encoding that the build can prepare in advance. */
export type StaticEncoding = 'br' | 'gzip';

/** The file name suffix of one prepared encoding. */
export const encodingSuffix: Readonly<Record<StaticEncoding, string>> = {
  br: '.br',
  gzip: '.gz',
};

/**
 * The encodings that one `Accept-Encoding` header permits.
 *
 * A `q=0` weight is a refusal, so it is honoured. Order of preference is the
 * server's own: Brotli first, because the build spends its time there.
 */
export function acceptedEncodings(
  header: string | undefined,
): readonly StaticEncoding[] {
  if (header === undefined || header.trim() === '') return [];
  const permitted = new Set<string>();
  for (const part of header.split(',')) {
    const [rawName, ...parameters] = part.split(';');
    const name = (rawName ?? '').trim().toLowerCase();
    if (name === '') continue;
    const weight = parameters
      .map((parameter) => parameter.trim().toLowerCase())
      .find((parameter) => parameter.startsWith('q='));
    if (weight !== undefined && Number(weight.slice(2)) === 0) continue;
    permitted.add(name);
  }
  const order: StaticEncoding[] = ['br', 'gzip'];
  return order.filter(
    (encoding) => permitted.has(encoding) || permitted.has('*'),
  );
}

/**
 * Whether a built file carries a content hash in its name.
 *
 * Vite writes `name-<hash>.ext` for every emitted chunk and asset, so the
 * name changes whenever the bytes change. Such a file can be cached for as
 * long as the browser likes.
 */
export function isHashedAssetName(filePath: string): boolean {
  return /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(basename(filePath));
}

/** Names that must be revalidated on every load, whatever their extension. */
const alwaysRevalidated = new Set([
  'index.html',
  'service-worker.js',
  'manifest.webmanifest',
]);

/** The cache directive of one built file. */
export function cacheControlFor(filePath: string): string {
  const name = basename(filePath);
  if (alwaysRevalidated.has(name) || name.endsWith('.html')) return 'no-cache';
  return isHashedAssetName(filePath)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

/**
 * The entity tag of one representation.
 *
 * It is derived from the size and the modification time of the file that
 * holds the bytes, so a rebuild always produces a new tag and two encodings
 * of the same file never share one.
 */
export function entityTag(stats: Stats): string {
  const digest = createHash('sha256')
    .update(`${String(stats.size)}:${String(stats.mtimeMs)}`)
    .digest('base64url')
    .slice(0, 27);
  return `"${digest}"`;
}

/** Whether an `If-None-Match` header names the tag of the answer. */
export function matchesEntityTag(
  header: string | undefined,
  tag: string,
): boolean {
  if (header === undefined) return false;
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, ''))
    .includes(tag);
}

/** One HTML document, its content policy, and the file time it was read at. */
type DocumentPolicy = { readonly policy: string; readonly mtimeMs: number };

/**
 * Content policies of the documents that have been served.
 *
 * Building one means reading the file and hashing its inline scripts, so the
 * result is kept until the file changes.
 */
const documentPolicies = new Map<string, DocumentPolicy>();

/**
 * The content policy of one HTML document.
 *
 * `index.html` is the application shell. Every other document of the build is
 * a framed one; the diagram preview is the only such document today.
 */
export function documentContentPolicy(
  filePath: string,
  relativePath: string,
  stats: Stats,
): string {
  const cached = documentPolicies.get(filePath);
  if (cached !== undefined && cached.mtimeMs === stats.mtimeMs)
    return cached.policy;
  const policy =
    relativePath === 'index.html'
      ? appShellContentPolicy(
          inlineScriptHashes(readFileSync(filePath, 'utf8')),
        )
      : framedDocumentContentPolicy;
  documentPolicies.set(filePath, { policy, mtimeMs: stats.mtimeMs });
  return policy;
}

/** What `sendStaticFile` needs about the file it is asked to send. */
export type StaticFileRequest = {
  /** Absolute path of the identity representation. */
  readonly filePath: string;
  /** Path of the same file inside the built directory, with `/` separators. */
  readonly relativePath: string;
};

/**
 * Answers one request for a built file.
 *
 * The reply is returned rather than awaited, so the caller can return it from
 * a Fastify handler in the usual way.
 */
export function sendStaticFile(
  request: FastifyRequest,
  reply: FastifyReply,
  target: StaticFileRequest,
): FastifyReply {
  const contentType = mimeTypeFor(target.filePath);
  const identity = statSync(target.filePath);

  let bodyPath = target.filePath;
  let bodyStats = identity;
  let encoding: StaticEncoding | null = null;
  for (const candidate of acceptedEncodings(
    typeof request.headers['accept-encoding'] === 'string'
      ? request.headers['accept-encoding']
      : undefined,
  )) {
    const variant = `${target.filePath}${encodingSuffix[candidate]}`;
    const stats = statFile(variant);
    // A stale variant is ignored. The build writes it after the file it
    // compresses, so an older one cannot describe the current bytes.
    if (stats === null || stats.mtimeMs < identity.mtimeMs) continue;
    bodyPath = variant;
    bodyStats = stats;
    encoding = candidate;
    break;
  }

  const tag = entityTag(bodyStats);
  reply
    .header('content-type', contentType)
    .header('cache-control', cacheControlFor(target.filePath))
    .header('etag', tag)
    .header('vary', 'Accept-Encoding');
  if (encoding !== null) reply.header('content-encoding', encoding);
  if (contentType.startsWith('text/html'))
    reply.header(
      'content-security-policy',
      documentContentPolicy(target.filePath, target.relativePath, identity),
    );
  if (
    target.relativePath !== 'index.html' &&
    contentType.startsWith('text/html')
  )
    reply.header('x-frame-options', 'SAMEORIGIN');

  if (matchesEntityTag(request.headers['if-none-match'], tag))
    return reply.status(304).send();
  return reply
    .status(200)
    .header('content-length', String(bodyStats.size))
    .send(createReadStream(bodyPath));
}

/** The stats of a file, or null when it is missing or is not a file. */
export function statFile(filePath: string): Stats | null {
  try {
    const stats = statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}
