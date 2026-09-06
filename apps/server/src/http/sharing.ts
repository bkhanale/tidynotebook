/** HTTP adapters for administrator-managed and anonymous public sharing. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import {
  createShare,
  listShares,
  revokeShare,
  updateShare,
  type Result,
  type ShareRecord,
  type SharingStore,
} from '@notesapp/core';
import type { AttachmentStore } from '@notesapp/storage-server';
import { requireActor } from '../auth/actor.ts';
import { readProperty } from '../values.ts';
import { readText } from './files.ts';
import type { HandlerMap, HandlerResult } from './register.ts';
import {
  createProblem,
  DomainProblemError,
  problemMediaType,
} from './problem.ts';
import { publicSharePage } from '../public/page.ts';

const jsonMediaType = 'application/json';
const htmlMediaType = 'text/html';
const publicHeaders = [
  ['cache-control', 'no-store'],
  ['x-robots-tag', 'noindex, nofollow, noarchive'],
  ['referrer-policy', 'no-referrer'],
  ['x-content-type-options', 'nosniff'],
  [
    'content-security-policy',
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  ],
] as const;

/** A generic missing answer that never repeats the secret token. */
function publicNotFound(request: FastifyRequest): HandlerResult {
  return {
    status: 404,
    mediaType: problemMediaType,
    body: createProblem({
      code: 'not_found',
      status: 404,
      detail: 'This public note is unavailable.',
      instance: '/s/redacted',
      requestId: request.id,
    }),
    headers: publicHeaders,
  };
}

/** Returns a domain value or maps its expected failure to Problem Details. */
function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new DomainProblemError(result.error);
}

/** Reads the nullable expiry from a validated JSON body. */
function expiresAt(body: unknown): string | null {
  const value = readProperty(body, 'expiresAt');
  return typeof value === 'string' ? value : null;
}

/** Hashes an opaque token before it reaches storage. */
export function publicTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Administrator response. Only creation can return the one-time URL. */
function shareBody(
  share: ShareRecord,
  origin: string,
  token?: string,
): Record<string, unknown> {
  return {
    shareId: share.id,
    fileId: share.fileId,
    pinnedRevisionId: share.pinnedRevisionId,
    creatorAccountId: share.creatorAccountId,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
    createdAt: share.createdAt,
    ...(token === undefined ? {} : { url: `${origin}/s/${token}` }),
  };
}

/** Builds every share operation from the same stores and public origin. */
export function createSharingHandlers(
  store: SharingStore,
  attachments: AttachmentStore,
  origin: string,
  now: () => Date = () => new Date(),
): HandlerMap {
  return {
    createShare: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const token = randomBytes(32).toString('base64url');
      const share = unwrap(
        await createShare(
          store,
          actor,
          workspaceId,
          {
            id: randomUUID(),
            fileId: readText(request.body, 'fileId'),
            pinnedRevisionId: readText(request.body, 'pinnedRevisionId'),
            tokenHash: publicTokenHash(token),
            expiresAt: expiresAt(request.body),
          },
          now(),
        ),
      );
      return {
        status: 201,
        mediaType: jsonMediaType,
        body: shareBody(share, origin, token),
      };
    },
    updateShare: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const share = unwrap(
        await updateShare(
          store,
          actor,
          workspaceId,
          {
            shareId: readText(request.params, 'shareId'),
            fileId: readText(request.body, 'fileId'),
            pinnedRevisionId: readText(request.body, 'pinnedRevisionId'),
            expiresAt: expiresAt(request.body),
          },
          now(),
        ),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: shareBody(share, origin),
      };
    },
    revokeShare: async (request): Promise<HandlerResult> => {
      const share = unwrap(
        await revokeShare(
          store,
          requireActor(request).actor,
          readText(request.params, 'workspaceId'),
          readText(request.params, 'shareId'),
        ),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: shareBody(share, origin),
      };
    },
    listShares: async (request): Promise<HandlerResult> => {
      const values = unwrap(
        await listShares(
          store,
          requireActor(request).actor,
          readText(request.params, 'workspaceId'),
        ),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: { shares: values.map((share) => shareBody(share, origin)) },
      };
    },
    getPublicShare: async (request): Promise<HandlerResult> => {
      const token = readText(request.params, 'token');
      const share = await store.readPublicShare(publicTokenHash(token));
      if (share === null) return publicNotFound(request);
      return {
        status: 200,
        mediaType: htmlMediaType,
        body: await publicSharePage(share, token),
        headers: publicHeaders,
      };
    },
    getPublicAttachment: async (
      request: FastifyRequest,
    ): Promise<HandlerResult> => {
      const token = readText(request.params, 'token');
      const content = await attachments.readPublicShareAttachment(
        publicTokenHash(token),
        readText(request.params, 'revisionId'),
      );
      if (content === null) return publicNotFound(request);
      return {
        status: 200,
        mediaType: content.mediaType,
        body: content.stream,
        headers: [
          ...publicHeaders,
          ['content-length', content.size.toString()],
          ['etag', `"sha256-${content.digest}"`],
        ],
      };
    },
  };
}
