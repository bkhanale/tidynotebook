/**
 * Handlers for history, checkpoint, branch, restore, and purge operations.
 *
 * This module connects the HTTP operations to the core domain services for
 * revisions, branches, and permanent deletion.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  BranchFilter,
  BranchResolution,
  BranchState,
  Result,
  WorkspaceStore,
} from '@notesapp/core';
import {
  createCheckpoint,
  listBranches,
  listHistory,
  previewPurge,
  purgeFiles,
  requestDigest,
  resolveBranches,
  restoreRevision,
  submitBranch,
} from '@notesapp/core';
import { requireActor } from '../auth/actor.ts';
import { readProperty } from '../values.ts';
import type { HandlerMap, HandlerResult } from './register.ts';
import { DomainProblemError } from './problem.ts';
import {
  acceptedBody,
  acceptedRevisionBody,
  header,
  parseTag,
  readOptionalText,
  readText,
  requiredTags,
  revisionTag,
  submittedContent,
  submittedHeads,
  submittedRevisions,
} from './files.ts';

const jsonMediaType = 'application/json';

/** Unwraps a domain result or throws the mapped domain problem error. */
function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new DomainProblemError(result.error);
}

/** Builds the history, branch, checkpoint, restore, and purge handlers. */
export function createHistoryHandlers(store: WorkspaceStore): HandlerMap {
  return {
    listHistory: async (request: FastifyRequest): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const fileId = readText(request.params, 'fileId');
      const cursor = readOptionalText(request.query, 'cursor');
      const limitRaw = readProperty(request.query, 'limit');
      const limit = typeof limitRaw === 'number' ? limitRaw : undefined;

      const page = unwrap(
        await listHistory(store, actor, workspaceId, fileId, {
          cursor,
          ...(limit !== undefined ? { limit } : {}),
        }),
      );

      return {
        status: 200,
        mediaType: jsonMediaType,
        body: {
          revisions: page.revisions.map((r) => ({
            revisionId: r.revisionId,
            fileId: r.fileId,
            path: r.path,
            deleted: r.deleted,
            parents: [...r.parents],
            digest: r.digest,
            size: r.size,
            actorAccountId: r.actorAccountId,
            clientTime: r.clientTime,
            serverTime: r.serverTime,
            message: r.message ?? null,
            isCheckpoint: r.isCheckpoint ?? false,
            checkpointName: r.checkpointName ?? null,
            restoredFrom: r.restoredFrom ?? null,
            text: r.text ?? null,
            objectId: r.objectId ?? null,
          })),
          nextCursor: page.nextCursor ?? null,
        },
      };
    },

    createCheckpoint: async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const fileId = readText(request.params, 'fileId');
      const tags = requiredTags(request);
      const expectedHead = tags[0];
      if (expectedHead === undefined) {
        throw new DomainProblemError({ code: 'stale_head', fileIds: [fileId] });
      }

      const body = request.body;
      const mutationId = readText(body, 'mutationId');
      const deviceId = readText(body, 'deviceId');
      const clientTime = readText(body, 'clientTime');
      const name = readText(body, 'name');
      const revisionId = readOptionalText(body, 'revisionId') ?? randomUUID();
      const path = readOptionalText(body, 'path') ?? undefined;
      const contentRaw = readProperty(body, 'content');
      const content =
        contentRaw !== undefined && contentRaw !== null
          ? submittedContent(body, fileId)
          : undefined;

      const digest = await requestDigest(
        'createCheckpoint',
        { workspaceId, fileId, ifMatch: tags },
        body,
      );

      const outcome = unwrap(
        await createCheckpoint(
          store,
          actor,
          {
            workspaceId,
            fileId,
            revisionId,
            expectedHead,
            name,
            ids: { mutationId, deviceId, clientTime },
            ...(path !== undefined ? { path } : {}),
            ...(content !== undefined ? { content } : {}),
          },
          digest,
        ),
      );

      reply.header('etag', revisionTag(revisionId));
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: acceptedBody(outcome),
      };
    },

    listBranches: async (request: FastifyRequest): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const fileId = readOptionalText(request.query, 'fileId') ?? undefined;
      const conflictGroupId =
        readOptionalText(request.query, 'conflictGroupId') ?? undefined;
      const stateRaw = readOptionalText(request.query, 'state') ?? undefined;
      const state =
        stateRaw === 'unresolved' || stateRaw === 'resolved'
          ? (stateRaw as BranchState)
          : undefined;

      const filter: BranchFilter = {
        ...(fileId ? { fileId } : {}),
        ...(conflictGroupId ? { conflictGroupId } : {}),
        ...(state ? { state } : {}),
      };

      const branches = unwrap(
        await listBranches(store, actor, workspaceId, filter),
      );

      return {
        status: 200,
        mediaType: jsonMediaType,
        body: {
          branches: branches.map((b) => ({
            id: b.id,
            workspaceId: b.workspaceId,
            fileId: b.fileId,
            baseRevisionId: b.baseRevisionId,
            tipRevisionId: b.tipRevisionId,
            conflictGroupId: b.conflictGroupId,
            state: b.state,
            createdAt: b.createdAt,
          })),
        },
      };
    },

    submitBranch: async (request: FastifyRequest): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const body = request.body;

      const mutationId = readText(body, 'mutationId');
      const deviceId = readText(body, 'deviceId');
      const conflictGroupId = readText(body, 'conflictGroupId');

      const digest = await requestDigest(
        'submitBranch',
        { workspaceId, conflictGroupId },
        body,
      );

      const revisions = submittedRevisions(body);
      const expectedHeads = submittedHeads(body);

      const outcome = unwrap(
        await submitBranch(
          store,
          actor,
          {
            workspaceId,
            mutationId,
            deviceId,
            conflictGroupId,
            expectedHeads,
            revisions,
          },
          digest,
        ),
      );

      return {
        status: 200,
        mediaType: jsonMediaType,
        body: {
          mutationId: outcome.mutationId,
          conflictGroupId: outcome.conflictGroupId,
          revisionIds: [...outcome.revisionIds],
          branches: outcome.branches.map((b) => ({
            id: b.id,
            workspaceId: b.workspaceId,
            fileId: b.fileId,
            baseRevisionId: b.baseRevisionId,
            tipRevisionId: b.tipRevisionId,
            conflictGroupId: b.conflictGroupId,
            state: b.state,
            createdAt: b.createdAt,
          })),
        },
      };
    },

    resolveBranches: async (
      request: FastifyRequest,
    ): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const body = request.body;

      const mutationId = readText(body, 'mutationId');
      const deviceId = readText(body, 'deviceId');
      const clientTime = readText(body, 'clientTime');
      const conflictGroupId =
        readOptionalText(body, 'conflictGroupId') ?? undefined;

      const digest = await requestDigest(
        'resolveBranches',
        { workspaceId },
        body,
      );

      const rawResolutions = readProperty(body, 'resolutions');
      if (!Array.isArray(rawResolutions)) {
        throw new Error('notesapp: the validated body has no resolutions.');
      }

      const resolutions: BranchResolution[] = rawResolutions.map(
        (res: unknown) => {
          const fileId = readText(res, 'fileId');
          return {
            fileId,
            expectedHead: readOptionalText(res, 'expectedHead'),
            branchTip: readText(res, 'branchTip'),
            revisionId: readText(res, 'revisionId'),
            path: readText(res, 'path'),
            content: submittedContent(res, fileId),
            deleted: readProperty(res, 'deleted') === true,
            message: readOptionalText(res, 'message'),
          };
        },
      );

      const outcome = unwrap(
        await resolveBranches(
          store,
          actor,
          {
            workspaceId,
            mutationId,
            deviceId,
            clientTime,
            ...(conflictGroupId ? { conflictGroupId } : {}),
            resolutions,
          },
          digest,
        ),
      );

      return {
        status: 200,
        mediaType: jsonMediaType,
        body: {
          mutationId: outcome.mutationId,
          revisions: outcome.revisions.map(acceptedRevisionBody),
          resolvedBranchIds: [...outcome.resolvedBranchIds],
        },
      };
    },

    restoreRevision: async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const fileId = readText(request.params, 'fileId');
      const body = request.body;

      const mutationId = readText(body, 'mutationId');
      const deviceId = readText(body, 'deviceId');
      const clientTime = readText(body, 'clientTime');
      const targetRevisionId = readText(body, 'targetRevisionId');
      const revisionId = readText(body, 'revisionId');
      const path = readOptionalText(body, 'path') ?? undefined;
      const message = readOptionalText(body, 'message') ?? undefined;

      // Check header or body for expectedHead
      let expectedHead = readOptionalText(body, 'expectedHead');
      const ifMatchHeader = header(request, 'if-match');
      if (ifMatchHeader !== undefined) {
        const parsed = parseTag(ifMatchHeader);
        if (parsed !== null) expectedHead = parsed;
      }

      const digest = await requestDigest(
        'restoreRevision',
        { workspaceId, fileId },
        body,
      );

      const outcome = unwrap(
        await restoreRevision(
          store,
          actor,
          {
            workspaceId,
            fileId,
            targetRevisionId,
            expectedHead,
            revisionId,
            ids: { mutationId, deviceId, clientTime },
            ...(path !== undefined ? { path } : {}),
            ...(message !== undefined ? { message } : {}),
          },
          digest,
        ),
      );

      reply.header('etag', revisionTag(revisionId));
      return {
        status: 200,
        mediaType: jsonMediaType,
        body: acceptedBody(outcome),
      };
    },

    previewPurge: async (request: FastifyRequest): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const body = request.body;
      const fileIdsRaw = readProperty(body, 'fileIds');
      if (!Array.isArray(fileIdsRaw)) {
        throw new Error('notesapp: the validated body has no fileIds.');
      }
      const fileIds = fileIdsRaw.map((id: unknown) => {
        if (typeof id !== 'string') throw new Error('invalid fileId in array');
        return id;
      });

      const preview = unwrap(
        await previewPurge(store, actor, workspaceId, fileIds),
      );

      return {
        status: 200,
        mediaType: jsonMediaType,
        body: {
          fileIds: [...preview.fileIds],
          revisionIds: [...preview.revisionIds],
          contentDigests: [...preview.contentDigests],
          attachmentObjectIds: [...preview.attachmentObjectIds],
          blockingReferences: preview.blockingReferences.map((r) => ({
            kind: r.kind,
            targetId: r.targetId,
            referrerId: r.referrerId,
            description: r.description,
          })),
          dependentRevisionCount: preview.dependentRevisionCount,
          reclaimableBytes: preview.reclaimableBytes,
          canPurge: preview.canPurge,
        },
      };
    },

    purgeFiles: async (request: FastifyRequest): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const body = request.body;
      const mutationId = readText(body, 'mutationId');
      const fileIdsRaw = readProperty(body, 'fileIds');
      if (!Array.isArray(fileIdsRaw)) {
        throw new Error('notesapp: the validated body has no fileIds.');
      }
      const fileIds = fileIdsRaw.map((id: unknown) => {
        if (typeof id !== 'string') throw new Error('invalid fileId in array');
        return id;
      });

      const digest = await requestDigest('purgeFiles', { workspaceId }, body);

      const outcome = unwrap(
        await purgeFiles(
          store,
          actor,
          workspaceId,
          fileIds,
          mutationId,
          digest,
        ),
      );

      return {
        status: 200,
        mediaType: jsonMediaType,
        body: {
          mutationId: outcome.mutationId,
          purgedFileIds: [...outcome.purgedFileIds],
          purgedRevisionIds: [...outcome.purgedRevisionIds],
          reclaimedBytes: outcome.reclaimedBytes,
        },
      };
    },
  };
}
