import { createDocumentService } from '@notesapp/storage-server';
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
import {
  commitChangeset,
  createFileChangeset,
  decodeFileCursor,
  defaultPageSize,
  fileSort,
  listDeletedFiles,
  listFiles,
  markdownContent,
  readFile,
  readHeadForWrite,
  readMutationReceipt,
  readRevision,
  requestDigest,
  restoreFile,
  tombstoneContent,
  updateFileChangeset,
  workspaceText,
  type AcceptedChangeset,
  type AcceptedRevision,
  type ChangesetInput,
  type ContentRef,
  type DocumentSave,
  type FilePageRequest,
  type RevisionInput,
  type RevisionRecord,
  type WorkspaceStore,
} from '@notesapp/core';
import { requireActor } from '../auth/actor.ts';
import { readProperty } from '../values.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';
import { noContent } from '../plugins/register.ts';
import {
  DomainProblemError,
  PreconditionRequiredError,
  RequestContractError,
  unwrapDomain,
} from '../plugins/problem.ts';

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
export function header(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const value = request.headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/** A validated string member of a request body. */
export function readText(value: unknown, key: string): string {
  const member = readProperty(value, key);
  if (typeof member !== 'string')
    throw new Error(`notesapp: the validated body has no ${key}.`);
  return member;
}

/** An optional string member, or `null` when it is absent or null. */
export function readOptionalText(value: unknown, key: string): string | null {
  const member = readProperty(value, key);
  return typeof member === 'string' ? member : null;
}

/** Fails with the domain code and the files that the failure refers to. */
function refuse(
  code:
    | 'stale_head'
    | 'invalid_content'
    | 'invalid_graph'
    | 'mutation_reused'
    | 'not_found'
    | 'document_malformed',
  fileIds: readonly string[] = [],
): never {
  throw new DomainProblemError({ code, fileIds: [...fileIds] });
}

/**
 * The revisions that a conditional header names.
 *
 * `*` means any representation. A list is accepted, and any of its members may
 * match. A member that this server could never have issued is dropped, so it
 * matches nothing.
 */
export function parseTagList(value: string): {
  star: boolean;
  revisionIds: readonly string[];
} {
  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.includes('*')) return { star: true, revisionIds: [] };
  return {
    star: false,
    revisionIds: entries.flatMap((entry) => {
      const revisionId = parseTag(entry);
      return revisionId === null ? [] : [revisionId];
    }),
  };
}

/**
 * The revisions that an `If-Match` request accepts as the current head.
 *
 * A write needs a tag of a state that the client actually read. A request
 * without the header, and a request that carries `*`, both answer 428: `*`
 * would accept whatever the head is now, which is the lost update that this
 * precondition exists to prevent.
 */
export function requiredTags(request: FastifyRequest): readonly string[] {
  const value = header(request, 'if-match');
  if (value === undefined)
    throw new PreconditionRequiredError(
      'This operation needs the If-Match entity tag of the head that was read.',
    );
  const condition = parseTagList(value);
  if (condition.star)
    throw new PreconditionRequiredError(
      'This operation needs the entity tag of one state, so If-Match * is not enough.',
    );
  return condition.revisionIds;
}

/** Whether an `If-None-Match` value names the current entity tag. */
export function matchesNoneMatch(
  value: string | undefined,
  tag: string,
): boolean {
  if (value === undefined) return false;
  const condition = parseTagList(value);
  return (
    condition.star ||
    condition.revisionIds.some((revisionId) => revisionTag(revisionId) === tag)
  );
}

/** The public members of one revision. */
function revisionBody(
  revision: RevisionRecord,
  content: FileReadContent = 'full',
): Record<string, unknown> {
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
    epoch: revision.epoch,
    merged: revision.merged,
    // The document of the note, as base64, when this revision is its head.
    // A reader starts from it and merges its own work into it. A reader that
    // shows the text asks for it alone, and gets no document (record 0168).
    document:
      revision.document === null || content === 'text'
        ? null
        : Buffer.from(revision.document).toString('base64'),
  };
}

/** The parts of the head that a file read carries (record 0168). */
export type FileReadContent = 'text' | 'full';

/**
 * The parts of the head that one file read asks for.
 *
 * The boundary has checked the value against the contract, so anything but
 * `text` is the default `full`, which an earlier client reads by naming none.
 */
export function fileReadContent(request: FastifyRequest): FileReadContent {
  return readProperty(request.query, 'content') === 'text' ? 'text' : 'full';
}

/** The public members of one accepted revision. */
export function acceptedRevisionBody(
  revision: AcceptedRevision,
): Record<string, unknown> {
  return {
    revisionId: revision.revisionId,
    fileId: revision.fileId,
    parents: [...revision.parents],
    path: revision.path,
    deleted: revision.deleted,
    digest: revision.digest,
    size: revision.size,
    actorAccountId: revision.actorAccountId,
    serverTime: revision.serverTime,
    message: revision.message,
    epoch: revision.epoch,
    // The complete state of the accepted document, as base64. It states
    // identities and deletions and holds no note text (record 0081).
    acceptedState:
      revision.acceptedState === null
        ? null
        : Buffer.from(revision.acceptedState).toString('base64'),
    merged: revision.merged,
  };
}

/** The public members of one accepted changeset. */
export function acceptedBody(
  outcome: AcceptedChangeset,
): Record<string, unknown> {
  return {
    mutationId: outcome.mutationId,
    revisionIds: [...outcome.revisionIds],
    cursor: outcome.cursor,
    revisions: outcome.revisions.map(acceptedRevisionBody),
    superseded: outcome.superseded.map((entry) => ({
      fileId: entry.fileId,
      previousHeadRevisionId: entry.previousHeadRevisionId,
      acceptedRevisionId: entry.acceptedRevisionId,
    })),
  };
}

/** The content reference of a stored revision, so a change can reuse it. */
function contentOf(revision: RevisionRecord, epoch: number): ContentRef {
  // The workspace authors this text: it repeats what the head already holds,
  // so the document keeps every identity (record 0081).
  if (revision.text !== null) return workspaceText(revision.text, epoch);
  if (revision.objectId !== null)
    return {
      kind: 'attachment',
      digest: revision.digest,
      objectId: revision.objectId,
    };
  throw new Error('notesapp: a stored revision names no content.');
}

/** Decodes one base64 member of a save, or refuses the revision. */
function bytesOf(value: unknown, fileId: string): Uint8Array {
  if (typeof value !== 'string') refuse('invalid_content', [fileId]);
  try {
    return new Uint8Array(Buffer.from(value, 'base64'));
  } catch {
    return refuse('document_malformed', [fileId]);
  }
}

/**
 * The document work that one submitted note revision carries.
 *
 * A save states its work, its generation, and the complete state that the
 * device had seen. A save with no update states what it saw and nothing more,
 * which is how a deletion reaches the workspace (records 0081, 0083).
 */
export function submittedDocument(
  value: unknown,
  fileId: string,
): DocumentSave {
  const epoch = readProperty(value, 'epoch');
  if (typeof epoch !== 'number') refuse('invalid_content', [fileId]);
  const update = readProperty(value, 'update');
  return {
    work:
      update === null || update === undefined
        ? { kind: 'none' }
        : { kind: 'update', update: bytesOf(update, fileId) },
    epoch,
    observed: bytesOf(readProperty(value, 'observed'), fileId),
  };
}

/** The content that one submitted revision carries. */
export function submittedContent(entry: unknown, fileId: string): ContentRef {
  const content = readProperty(entry, 'content');
  const kind = readText(content, 'kind');
  if (kind === 'markdown') {
    const document = readProperty(content, 'document');
    // The contract cannot state that a note carries document work and an
    // attachment names an object, so the handler checks the pair.
    if (document === undefined || document === null)
      refuse('invalid_content', [fileId]);
    return { kind: 'markdown', document: submittedDocument(document, fileId) };
  }
  const digest = readText(content, 'digest');
  const objectId = readProperty(content, 'attachmentObjectId');
  if (typeof objectId !== 'string') refuse('invalid_content', [fileId]);
  return { kind: 'attachment', digest, objectId };
}

/** The submitted revisions of a changeset request. */
export function submittedRevisions(body: unknown): readonly RevisionInput[] {
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
export function submittedHeads(
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
 * The sort, the page size, and the position that a file listing asks for.
 *
 * The cursor is opaque to the client, so a value that does not name a
 * position of this sort is a malformed request rather than a server fault.
 * The check happens here, at the transport, where a request parameter is
 * validated, and not in the use case.
 */
export function listingRequest(request: FastifyRequest): FilePageRequest {
  const cursor = readProperty(request.query, 'cursor');
  const limit = readProperty(request.query, 'limit');
  const sort = fileSort(readProperty(request.query, 'sort'));
  const position = typeof cursor === 'string' ? cursor : null;
  if (position !== null && decodeFileCursor(position, sort) === null)
    throw new RequestContractError('query', [
      {
        path: '/cursor',
        message: 'The cursor does not name a position of this sort order.',
      },
    ]);
  return {
    cursor: position,
    limit: typeof limit === 'number' ? limit : defaultPageSize,
    sort,
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
    documents: createDocumentService(),
    transact: () => {
      throw new Error(
        'notesapp: the server was built without a workspace store.',
      );
    },
  };
}

/**
 * The answer of one single file write.
 *
 * The answer is built from the accepted write itself. A read back would need
 * the read permission, and an actor that may write but not read would then be
 * refused after its change was already stored.
 *
 * The entity tag names the revision that the operation accepted. A change from
 * somewhere else can make it stale, and the next conditional write then answers
 * 412, which is the documented way to notice it.
 */
export function answerAccepted(
  reply: FastifyReply,
  accepted: AcceptedChangeset,
  status: number,
): HandlerResult {
  const revision = accepted.revisions[0];
  if (revision === undefined)
    throw new Error('notesapp: an accepted changeset named no revision.');
  reply.header('etag', revisionTag(revision.revisionId));
  return {
    status,
    mediaType: jsonMediaType,
    body: {
      revision: acceptedRevisionBody(revision),
      accepted: acceptedBody(accepted),
    },
  };
}

/** Builds the file, revision, and changeset handlers. */
export function createFileHandlers(store: WorkspaceStore): HandlerMap {
  /**
   * The answer that a retry of an already accepted mutation receives.
   *
   * The receipt is read before the current head, exactly as the use case reads
   * it inside its transaction. An accepted mutation must stay replayable after
   * its head has moved on and after its file was deleted, and a mutation
   * identity that was used for another operation must be reported as reused
   * rather than as a failed precondition.
   */
  async function replayedAnswer(
    request: FastifyRequest,
    reply: FastifyReply,
    input: {
      readonly workspaceId: string;
      readonly fileId: string;
      readonly mutationId: string;
      readonly digest: string;
      readonly status: number;
    },
  ): Promise<HandlerResult | null> {
    const actor = requireActor(request).actor;
    const receipt = unwrapDomain(
      await readMutationReceipt(
        store,
        actor,
        input.workspaceId,
        input.mutationId,
      ),
    );
    if (receipt === null) return null;
    if (receipt.digest !== input.digest)
      refuse('mutation_reused', [input.fileId]);
    return answerAccepted(reply, receipt.outcome, input.status);
  }

  /**
   * The accepted head of the file that a conditional write names.
   *
   * The head comes from the write path, so it needs the `write` action and not
   * `read`: an actor that may change a file may base its revision on the state
   * it is replacing. A denied actor therefore answers 403, and a missing file
   * answers 404, instead of both looking like a failed precondition.
   *
   * The entity tags of the request are compared against that head. A head that
   * none of them names answers 412. The changeset states the same head again,
   * and the commit compares it under the workspace lock, so a change between
   * this read and the commit is also a 412.
   */
  async function conditionalHead(
    request: FastifyRequest,
    workspaceId: string,
    fileId: string,
    tags: readonly string[],
  ): Promise<RevisionRecord> {
    const actor = requireActor(request).actor;
    const head = unwrapDomain(
      await readHeadForWrite(store, actor, workspaceId, fileId),
    );
    if (!tags.includes(head.revisionId)) refuse('stale_head', [fileId]);
    return head;
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
      readonly preconditionMode?: 'strict';
    },
  ): Promise<HandlerResult> {
    const actor = requireActor(request).actor;
    const accepted = unwrapDomain(
      await commitChangeset(
        store,
        actor,
        input.changeset,
        input.digest,
        input.preconditionMode,
      ),
    );
    return answerAccepted(reply, accepted, input.status);
  }

  return {
    /**
     * What this workspace knows about one mutation identity (record 0086).
     *
     * A device reads it after it lost an answer, before it transforms work
     * that may already have committed. The answer repeats the stored outcome
     * of exactly the request that the device froze, and it carries no note
     * text, so an actor that may write and not read learns nothing.
     */
    getMutationReceipt: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const mutationId = readText(request.params, 'mutationId');
      const digest = readText(request.query, 'digest');
      const receipt = unwrapDomain(
        await readMutationReceipt(store, actor, workspaceId, mutationId),
      );
      const accepted = receipt !== null && receipt.digest === digest;
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: {
          mutationId,
          status:
            receipt === null
              ? 'absent'
              : accepted
                ? 'accepted'
                : 'other_request',
          accepted:
            accepted && receipt !== null ? acceptedBody(receipt.outcome) : null,
        },
      };
    },

    listFiles: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const page = unwrapDomain(
        await listFiles(store, actor, workspaceId, listingRequest(request)),
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
            createdAt: file.createdAt,
            updatedAt: file.updatedAt,
          })),
          nextCursor: page.nextCursor,
        },
      };
    },

    listDeletedFiles: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const page = unwrapDomain(
        await listDeletedFiles(
          store,
          actor,
          workspaceId,
          listingRequest(request),
        ),
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
            createdAt: file.createdAt,
            deletedAt: file.deletedAt,
          })),
          nextCursor: page.nextCursor,
        },
      };
    },

    restoreFile: async (request, reply): Promise<HandlerResult> => {
      const workspaceId = readText(request.params, 'workspaceId');
      const fileId = readText(request.params, 'fileId');
      const body = request.body;
      // A restore carries no precondition header: the expected head is the
      // tombstone that the use case reads, so the client does not have to know
      // which revision deleted the file.
      const digest = await requestDigest(
        'restoreFile',
        { workspaceId, fileId, ifMatch: null },
        body,
      );
      const replayed = await replayedAnswer(request, reply, {
        workspaceId,
        fileId,
        mutationId: readText(body, 'mutationId'),
        digest,
        status: 200,
      });
      if (replayed !== null) return replayed;
      const actor = requireActor(request).actor;
      const accepted = unwrapDomain(
        await restoreFile(
          store,
          actor,
          {
            workspaceId,
            fileId,
            revisionId: readText(body, 'revisionId'),
            ids: {
              mutationId: readText(body, 'mutationId'),
              deviceId: readText(body, 'deviceId'),
              clientTime: readText(body, 'clientTime'),
            },
          },
          digest,
        ),
      );
      return answerAccepted(reply, accepted, 200);
    },

    getFile: async (request, reply): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const fileId = readText(request.params, 'fileId');
      const found = unwrapDomain(
        await readFile(store, actor, workspaceId, fileId),
      );
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
          createdAt: found.file.createdAt,
          updatedAt: found.file.updatedAt,
          head:
            head === null ? null : revisionBody(head, fileReadContent(request)),
        },
      };
    },

    getRevision: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const revisionId = readText(request.params, 'revisionId');
      const revision = unwrapDomain(
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
        content: markdownContent(
          submittedDocument(readProperty(body, 'document'), fileId),
        ),
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
      const body = request.body;
      // The digest covers the tags that the request stated, not the head they
      // resolved to, so a retry of the same request reaches the same value
      // however the workspace has moved on since.
      const tags = requiredTags(request);
      const digest = await requestDigest(
        'updateFile',
        { workspaceId, fileId, ifMatch: tags },
        body,
      );
      const mutationId = readText(body, 'mutationId');
      const replayed = await replayedAnswer(request, reply, {
        workspaceId,
        fileId,
        mutationId,
        digest,
        status: 200,
      });
      if (replayed !== null) return replayed;
      const head = await conditionalHead(request, workspaceId, fileId, tags);
      const document = readProperty(body, 'document');
      const path = readProperty(body, 'path');
      // A rename keeps the text of the head, and the document that holds it
      // keeps its generation.
      const headEpoch = head.epoch ?? 1;
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
          document === undefined || document === null
            ? contentOf(head, headEpoch)
            : markdownContent(submittedDocument(document, fileId)),
        deleted: false,
        message: readOptionalText(body, 'message'),
        ids: submissionIds(body),
      });
      return commitSingleFile(request, reply, {
        workspaceId,
        changeset,
        digest,
        status: 200,
        preconditionMode: 'strict',
      });
    },

    deleteFile: async (request, reply): Promise<HandlerResult> => {
      const workspaceId = readText(request.params, 'workspaceId');
      const fileId = readText(request.params, 'fileId');
      const body = request.body;
      const tags = requiredTags(request);
      const digest = await requestDigest(
        'deleteFile',
        { workspaceId, fileId, ifMatch: tags },
        body,
      );
      const replayed = await replayedAnswer(request, reply, {
        workspaceId,
        fileId,
        mutationId: readText(body, 'mutationId'),
        digest,
        status: 200,
      });
      if (replayed !== null) return replayed;
      const head = await conditionalHead(request, workspaceId, fileId, tags);
      const changeset = updateFileChangeset({
        workspaceId,
        fileId,
        revisionId: readText(body, 'revisionId'),
        expectedHead: head.revisionId,
        path: head.path,
        // A tombstone stores no note text. The revision before it keeps the
        // content, so the deletion adds nothing to the stored bytes and a full
        // workspace can still be tidied.
        // A tombstone states what the device had seen, so the workspace can
        // refuse a deletion that would hide unseen text (record 0083).
        content: tombstoneContent(
          contentOf(head, head.epoch ?? 1),
          submittedDocument(readProperty(body, 'document'), fileId),
        ),
        deleted: true,
        message: readOptionalText(body, 'message'),
        ids: submissionIds(body),
      });
      return commitSingleFile(request, reply, {
        workspaceId,
        changeset,
        digest,
        status: 200,
        preconditionMode: 'strict',
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
      const accepted = unwrapDomain(
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
