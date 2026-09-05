/**
 * Handlers of the file, revision, and changeset operations.
 *
 * Every write here builds a changeset and hands it to one use case, so the
 * single file operations and the batch operation of the sync engine follow the
 * same rules and the same transaction order. A handler performs no permission
 * check of its own: the identity hook proves who the actor is, and the use
 * case decides what the current role and the verified grants permit.
 *
 * The conditional request rules follow RFC 9110. A write of an existing file
 * needs a strong `If-Match` entity tag, which names the accepted head that the
 * client read. A missing tag answers 428, and a tag that no longer names the
 * head answers 412 with the files that moved on.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  AcceptedChangeset,
  ChangesetInput,
  ContentRef,
  Result,
  RevisionInput,
  RevisionRecord,
  WorkspaceStore,
} from '@notesapp/core';
import {
  commitChangeset,
  createFileChangeset,
  defaultPageSize,
  listFiles,
  markdownContent,
  readFile,
  readRevision,
  requestDigest,
  tombstoneContent,
  updateFileChangeset,
} from '@notesapp/core';
import { requireActor } from '../auth/actor.ts';
import { readProperty } from '../values.ts';
import type { HandlerMap, HandlerResult } from './register.ts';
import { noContent } from './register.ts';
import { DomainProblemError, PreconditionRequiredError } from './problem.ts';

/** Media type of every answer in this module. */
const jsonMediaType = 'application/json';

/**
 * A strong entity tag that names one revision.
 *
 * The tag is the revision identifier, because a revision is immutable: one tag
 * therefore names exactly one state of the file for as long as the workspace
 * exists.
 */
export function revisionTag(revisionId: string): string {
  return `"${revisionId}"`;
}

/**
 * A strong entity tag of the shape this server issues.
 *
 * The value inside the quotes must be a revision identifier. A tag of any
 * other shape names no revision of this workspace, so it is refused here
 * rather than passed on to storage.
 */
const strongTag =
  /^"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"$/i;

/**
 * The revision that an entity tag names, or `null`.
 *
 * A weak tag is not accepted. RFC 9110 requires strong comparison for
 * `If-Match`, and a weak tag would let a client write over a state it has not
 * seen.
 */
export function parseTag(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = strongTag.exec(value.trim());
  const revisionId = match?.[1];
  return revisionId === undefined ? null : revisionId.toLowerCase();
}

/** One header value, or undefined when the request carries none. */
function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/** A validated string member of a request body. */
function readText(value: unknown, key: string): string {
  const member = readProperty(value, key);
  if (typeof member !== 'string')
    throw new Error(`notesapp: the validated body has no ${key}.`);
  return member;
}

/** An optional string member, or `null` when it is absent or null. */
function readOptionalText(value: unknown, key: string): string | null {
  const member = readProperty(value, key);
  return typeof member === 'string' ? member : null;
}

/** Turns a domain result into its value, or into a problem response. */
function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new DomainProblemError(result.error);
}

/** Fails with the domain code and the files that the failure refers to. */
function refuse(
  code: 'stale_head' | 'invalid_content' | 'invalid_graph' | 'not_found',
  fileIds: readonly string[] = [],
): never {
  throw new DomainProblemError({ code, fileIds: [...fileIds] });
}

/** The accepted head that the request states, or a 428 answer. */
function requiredExpectedHead(request: FastifyRequest, fileId: string): string {
  const value = header(request, 'if-match');
  if (value === undefined)
    throw new PreconditionRequiredError(
      'This operation needs the If-Match entity tag of the head that was read.',
    );
  const revisionId = parseTag(value);
  // A tag that this server never issued cannot name the current head, so the
  // answer is the same as for a head that moved on.
  if (revisionId === null) refuse('stale_head', [fileId]);
  return revisionId;
}

/** Whether an `If-None-Match` value names the current entity tag. */
export function matchesNoneMatch(
  value: string | undefined,
  tag: string,
): boolean {
  if (value === undefined) return false;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .some((entry) => entry === '*' || entry === tag);
}

/** The public members of one revision. */
function revisionBody(revision: RevisionRecord): Record<string, unknown> {
  return {
    revisionId: revision.revisionId,
    fileId: revision.fileId,
    path: revision.path,
    kind: revision.kind,
    deleted: revision.deleted,
    parents: [...revision.parents],
    digest: revision.digest,
    size: revision.size,
    text: revision.text,
    attachmentObjectId: revision.objectId,
    message: revision.message,
    restoredFrom: revision.restoredFrom,
    clientTime: revision.clientTime,
    serverTime: revision.serverTime,
  };
}

/** The public members of one accepted changeset. */
function acceptedBody(outcome: AcceptedChangeset): Record<string, unknown> {
  return {
    mutationId: outcome.mutationId,
    revisionIds: [...outcome.revisionIds],
    cursor: outcome.cursor,
  };
}

/** The content reference of a stored revision, so a change can reuse it. */
function contentOf(revision: RevisionRecord): ContentRef {
  if (revision.text !== null)
    return { kind: 'markdown', digest: revision.digest, text: revision.text };
  if (revision.objectId !== null)
    return {
      kind: 'attachment',
      digest: revision.digest,
      objectId: revision.objectId,
    };
  throw new Error('notesapp: a stored revision names no content.');
}

/** The content that one submitted revision carries. */
function submittedContent(entry: unknown, fileId: string): ContentRef {
  const content = readProperty(entry, 'content');
  const kind = readText(content, 'kind');
  const digest = readText(content, 'digest');
  if (kind === 'markdown') {
    const text = readProperty(content, 'text');
    // The contract cannot state that Markdown carries text and an attachment
    // carries an object, so the handler checks the pair.
    if (typeof text !== 'string') refuse('invalid_content', [fileId]);
    return { kind: 'markdown', digest, text };
  }
  const objectId = readProperty(content, 'attachmentObjectId');
  if (typeof objectId !== 'string') refuse('invalid_content', [fileId]);
  return { kind: 'attachment', digest, objectId };
}

/** The submitted revisions of a changeset request. */
function submittedRevisions(body: unknown): readonly RevisionInput[] {
  const value = readProperty(body, 'revisions');
  if (!Array.isArray(value))
    throw new Error('notesapp: the validated body has no revisions.');
  return value.map((entry: unknown) => {
    const fileId = readText(entry, 'fileId');
    const parents = readProperty(entry, 'parents');
    if (!Array.isArray(parents)) refuse('invalid_graph', [fileId]);
    return {
      id: readText(entry, 'revisionId'),
      fileId,
      parents: parents.map((parent: unknown) => {
        if (typeof parent !== 'string') refuse('invalid_graph', [fileId]);
        return parent;
      }),
      path: readText(entry, 'path'),
      deleted: readProperty(entry, 'deleted') === true,
      content: submittedContent(entry, fileId),
      clientTime: readText(entry, 'clientTime'),
      message: readOptionalText(entry, 'message'),
      restoredFrom: readOptionalText(entry, 'restoredFrom'),
    };
  });
}

/** The expected heads of a changeset request. */
function submittedHeads(
  body: unknown,
): Readonly<Record<string, string | null>> {
  const value = readProperty(body, 'expectedHeads');
  if (value === null || typeof value !== 'object')
    throw new Error('notesapp: the validated body has no expected heads.');
  const heads: Record<string, string | null> = {};
  for (const [fileId, head] of Object.entries(value))
    heads[fileId] = typeof head === 'string' ? head : null;
  return heads;
}

/** The identifiers and the clock that a single file request carries. */
function submissionIds(body: unknown): {
  mutationId: string;
  deviceId: string;
  clientTime: string;
} {
  return {
    mutationId: readText(body, 'mutationId'),
    deviceId: readText(body, 'deviceId'),
    // A single file operation carries no client clock of its own, so the
    // acceptance time is also its informational client time.
    clientTime: new Date().toISOString(),
  };
}

/**
 * A store that the deployment did not supply.
 *
 * A test that checks the HTTP boundary only may leave it out. A file operation
 * then answers with a generic server error instead of pretending to work.
 */
export function missingWorkspaceStore(): WorkspaceStore {
  return {
    transact: () => {
      throw new Error(
        'notesapp: the server was built without a workspace store.',
      );
    },
  };
}

/** Builds the file, revision, and changeset handlers. */
export function createFileHandlers(store: WorkspaceStore): HandlerMap {
  /** Reads one revision, or answers that the expected head has moved on. */
  async function expectedRevision(
    request: FastifyRequest,
    workspaceId: string,
    fileId: string,
  ): Promise<RevisionRecord> {
    const expected = requiredExpectedHead(request, fileId);
    const actor = requireActor(request).actor;
    const found = await readRevision(store, actor, workspaceId, expected);
    // A revision that this workspace does not hold, and a revision of another
    // file, are both answers to a tag that cannot name this head.
    if (!found.ok || found.value.fileId !== fileId)
      refuse('stale_head', [fileId]);
    return found.value;
  }

  /** Commits one changeset and answers with the revision it accepted. */
  async function commitSingleFile(
    request: FastifyRequest,
    reply: FastifyReply,
    input: {
      readonly workspaceId: string;
      readonly changeset: ChangesetInput;
      readonly digest: string;
      readonly status: number;
    },
  ): Promise<HandlerResult> {
    const actor = requireActor(request).actor;
    const accepted = unwrap(
      await commitChangeset(store, actor, input.changeset, input.digest),
    );
    const revisionId = accepted.revisionIds[0];
    if (revisionId === undefined)
      throw new Error('notesapp: an accepted changeset named no revision.');
    const revision = unwrap(
      await readRevision(store, actor, input.workspaceId, revisionId),
    );
    // The tag names the revision that this operation accepted. A change from
    // somewhere else can make it stale, and the next conditional write then
    // answers 412, which is the documented way to notice it.
    reply.header('etag', revisionTag(revision.revisionId));
    return {
      status: input.status,
      mediaType: jsonMediaType,
      body: {
        revision: revisionBody(revision),
        accepted: acceptedBody(accepted),
      },
    };
  }

  return {
    listFiles: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const cursor = readProperty(request.query, 'cursor');
      const limit = readProperty(request.query, 'limit');
      const page = unwrap(
        await listFiles(store, actor, workspaceId, {
          cursor: typeof cursor === 'string' ? cursor : null,
          limit: typeof limit === 'number' ? limit : defaultPageSize,
        }),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: {
          files: page.files.map((file) => ({
            fileId: file.fileId,
            path: file.path,
            kind: file.kind,
            headRevisionId: file.headRevisionId,
            updatedAt: file.updatedAt,
          })),
          nextCursor: page.nextCursor,
        },
      };
    },

    getFile: async (request, reply): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const fileId = readText(request.params, 'fileId');
      const found = unwrap(await readFile(store, actor, workspaceId, fileId));
      const head = found.head;
      if (head !== null) {
        const tag = revisionTag(head.revisionId);
        reply.header('etag', tag);
        // A 304 keeps the entity tag, so the client can go on using it.
        if (matchesNoneMatch(header(request, 'if-none-match'), tag))
          return noContent(304);
      }
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: {
          fileId: found.file.fileId,
          path: found.file.path,
          kind: found.file.kind,
          headRevisionId: found.file.headRevisionId,
          updatedAt: found.file.updatedAt,
          head: head === null ? null : revisionBody(head),
        },
      };
    },

    getRevision: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const revisionId = readText(request.params, 'revisionId');
      const revision = unwrap(
        await readRevision(store, actor, workspaceId, revisionId),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: revisionBody(revision),
      };
    },

    createFile: async (request, reply): Promise<HandlerResult> => {
      const workspaceId = readText(request.params, 'workspaceId');
      const body = request.body;
      const fileId = readText(body, 'fileId');
      const changeset = createFileChangeset({
        workspaceId,
        fileId,
        revisionId: readText(body, 'revisionId'),
        path: readText(body, 'path'),
        content: await markdownContent(readText(body, 'text')),
        message: readOptionalText(body, 'message'),
        ids: submissionIds(body),
      });
      // A new file has no precondition header: the body states the file
      // identifier, and the changeset states that it must not exist yet.
      const digest = await requestDigest(
        'createFile',
        { workspaceId, fileId, ifMatch: null },
        body,
      );
      return commitSingleFile(request, reply, {
        workspaceId,
        changeset,
        digest,
        status: 201,
      });
    },

    updateFile: async (request, reply): Promise<HandlerResult> => {
      const workspaceId = readText(request.params, 'workspaceId');
      const fileId = readText(request.params, 'fileId');
      const head = await expectedRevision(request, workspaceId, fileId);
      const body = request.body;
      const text = readProperty(body, 'text');
      const path = readProperty(body, 'path');
      const changeset = updateFileChangeset({
        workspaceId,
        fileId,
        revisionId: readText(body, 'revisionId'),
        expectedHead: head.revisionId,
        // An absent member keeps the value of the expected head, so a rename
        // does not have to resend the text and an edit does not resend the
        // path.
        path: typeof path === 'string' ? path : head.path,
        content:
          typeof text === 'string'
            ? await markdownContent(text)
            : contentOf(head),
        deleted: false,
        message: readOptionalText(body, 'message'),
        ids: submissionIds(body),
      });
      const digest = await requestDigest(
        'updateFile',
        { workspaceId, fileId, ifMatch: head.revisionId },
        body,
      );
      return commitSingleFile(request, reply, {
        workspaceId,
        changeset,
        digest,
        status: 200,
      });
    },

    deleteFile: async (request, reply): Promise<HandlerResult> => {
      const workspaceId = readText(request.params, 'workspaceId');
      const fileId = readText(request.params, 'fileId');
      const head = await expectedRevision(request, workspaceId, fileId);
      const body = request.body;
      const changeset = updateFileChangeset({
        workspaceId,
        fileId,
        revisionId: readText(body, 'revisionId'),
        expectedHead: head.revisionId,
        path: head.path,
        // A tombstone stores no note text. The revision before it keeps the
        // content, so the deletion adds nothing to the stored bytes and a full
        // workspace can still be tidied.
        content: await tombstoneContent(contentOf(head)),
        deleted: true,
        message: readOptionalText(body, 'message'),
        ids: submissionIds(body),
      });
      const digest = await requestDigest(
        'deleteFile',
        { workspaceId, fileId, ifMatch: head.revisionId },
        body,
      );
      return commitSingleFile(request, reply, {
        workspaceId,
        changeset,
        digest,
        status: 200,
      });
    },

    commitChangeset: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const body = request.body;
      const changeset: ChangesetInput = {
        workspaceId,
        mutationId: readText(body, 'mutationId'),
        deviceId: readText(body, 'deviceId'),
        expectedHeads: submittedHeads(body),
        revisions: submittedRevisions(body),
      };
      // The batch operation carries its preconditions in the body, so the
      // digest covers the body alone.
      const digest = await requestDigest(
        'commitChangeset',
        { workspaceId },
        body,
      );
      const accepted = unwrap(
        await commitChangeset(store, actor, changeset, digest),
      );
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: acceptedBody(accepted),
      };
    },
  };
}
