/**
 * Domain services for revision history, checkpoints, and conflict branches.
 *
 * This module coordinates history pagination, checkpoint creation, branch
 * persistence, branch resolution, and revision restoration.
 */
import { authorize, type Actor } from '../identity/actor.ts';
import { contentDigest } from '../files/digest.ts';
import { validateGraph } from '../files/graph.ts';
import {
  fail,
  ok,
  type AcceptedChangeset,
  type AcceptedRevision,
  type ChangesetInput,
  type ContentRef,
  type Result,
  type RevisionInput,
} from '../files/model.ts';
import { normalizePath, type PathKind } from '../files/path.ts';
import type {
  AcceptedBranch,
  BranchFilter,
  BranchRecord,
  HistoryPage,
  SubmitBranchInput,
  WorkspaceStore,
} from '../files/ports.ts';
import { maxFilesPerChangeset } from '../files/commit.ts';

/** Default limit for history queries. */
export const defaultHistoryLimit = 50;

/** Maximum limit for history queries. */
export const maxHistoryLimit = 100;

/** Normalizes a requested limit value. */
function historyLimit(limit?: number | null): number {
  if (limit === null || limit === undefined || !Number.isFinite(limit)) {
    return defaultHistoryLimit;
  }
  return Math.min(Math.max(1, Math.trunc(limit)), maxHistoryLimit);
}

/** Path kind derived from content kind. */
function pathKind(content: ContentRef): PathKind {
  return content.kind === 'markdown' ? 'note' : 'attachment';
}

/** Reads history revisions for one file with cursor pagination. */
export async function listHistory(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  fileId: string,
  options?: { readonly cursor?: string | null; readonly limit?: number },
): Promise<Result<HistoryPage>> {
  return store.transact<Result<HistoryPage>>(actor, workspaceId, async (tx) => {
    const role = await tx.role(actor.accountId);
    if (role === null) return fail('forbidden');
    const permitted = authorize(actor, workspaceId, role, 'read');
    if (!permitted.ok) return fail('forbidden');

    const purged = await tx.purgedFiles([fileId]);
    if (purged.length > 0) return fail('purged', [fileId]);

    const file = await tx.file(fileId);
    if (file === null) return fail('not_found', [fileId]);

    const limit = historyLimit(options?.limit);
    const page = await tx.listHistory(fileId, {
      cursor: options?.cursor ?? null,
      limit,
    });
    return ok(page);
  });
}

/** Input for creating a named checkpoint. */
export type CreateCheckpointInput = {
  readonly workspaceId: string;
  readonly fileId: string;
  readonly revisionId: string;
  readonly expectedHead: string;
  readonly name: string;
  readonly ids: {
    readonly mutationId: string;
    readonly deviceId: string;
    readonly clientTime: string;
  };
  readonly path?: string;
  readonly content?: ContentRef;
};

/**
 * Creates a named checkpoint revision.
 *
 * It creates an immutable revision that preserves the content of the current
 * head or supplied draft.
 */
export async function createCheckpoint(
  store: WorkspaceStore,
  actor: Actor,
  input: CreateCheckpointInput,
  digest: string,
): Promise<Result<AcceptedChangeset>> {
  if (!input.name || input.name.trim() === '') {
    return fail('invalid_content', [input.fileId]);
  }

  return store.transact<Result<AcceptedChangeset>>(
    actor,
    input.workspaceId,
    async (tx) => {
      const role = await tx.role(actor.accountId);
      if (role === null) return fail('forbidden');
      const permitted = authorize(actor, input.workspaceId, role, 'write');
      if (!permitted.ok) return fail('forbidden');

      const receipt = await tx.receipt(input.ids.mutationId, actor.accountId);
      if (receipt !== null) {
        if (receipt.digest === digest) return ok(receipt.outcome);
        return fail('mutation_reused', [input.fileId]);
      }

      const purged = await tx.purgedFiles([input.fileId]);
      if (purged.length > 0) return fail('purged', [input.fileId]);

      const heads = await tx.heads([input.fileId]);
      const currentHead = heads.get(input.fileId) ?? null;
      if (currentHead !== input.expectedHead) {
        return fail('stale_head', [input.fileId]);
      }

      const currentRev = await tx.revision(input.expectedHead);
      if (currentRev === null || currentRev.fileId !== input.fileId) {
        return fail('invalid_graph', [input.fileId]);
      }
      if (currentRev.deleted) {
        return fail('not_found', [input.fileId]);
      }

      const chosenPath = input.path ?? currentRev.path;
      let chosenContent = input.content;
      if (!chosenContent) {
        if (currentRev.kind === 'note') {
          chosenContent = {
            kind: 'markdown',
            digest: currentRev.digest,
            text: currentRev.text ?? '',
          };
        } else {
          if (currentRev.objectId === null) {
            return fail('invalid_graph', [input.fileId]);
          }
          chosenContent = {
            kind: 'attachment',
            digest: currentRev.digest,
            objectId: currentRev.objectId,
          };
        }
      }

      const normalized = normalizePath(chosenPath, pathKind(chosenContent));
      if (!normalized.ok) return fail('invalid_path', [input.fileId]);

      if (chosenContent.kind === 'markdown') {
        if (!chosenContent.text.isWellFormed()) {
          return fail('invalid_content', [input.fileId]);
        }
        const calcDigest = await contentDigest(chosenContent.text);
        if (calcDigest !== chosenContent.digest.toLowerCase()) {
          return fail('invalid_content', [input.fileId]);
        }
      }

      const revision: RevisionInput = {
        id: input.revisionId,
        fileId: input.fileId,
        parents: [input.expectedHead],
        path: normalized.value,
        deleted: false,
        content: chosenContent,
        clientTime: input.ids.clientTime,
        message: input.name,
        restoredFrom: null,
      };

      const known = await tx.parents([input.expectedHead]);
      const graph = validateGraph([revision], known);
      if (!graph.ok) return graph;

      const changeset: ChangesetInput = {
        workspaceId: input.workspaceId,
        mutationId: input.ids.mutationId,
        deviceId: input.ids.deviceId,
        expectedHeads: { [input.fileId]: input.expectedHead },
        revisions: [revision],
      };

      return tx.accept(actor, changeset, digest);
    },
  );
}

/** Lists divergent branches with optional filtering. */
export async function listBranches(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  filter?: BranchFilter,
): Promise<Result<readonly BranchRecord[]>> {
  return store.transact<Result<readonly BranchRecord[]>>(
    actor,
    workspaceId,
    async (tx) => {
      const role = await tx.role(actor.accountId);
      if (role === null) return fail('forbidden');
      const permitted = authorize(actor, workspaceId, role, 'read');
      if (!permitted.ok) return fail('forbidden');

      const branches = await tx.listBranches(filter);
      return ok(branches);
    },
  );
}

/**
 * Submits a divergent branch atomically.
 *
 * It stores branch revisions and records the branch without advancing accepted
 * heads.
 */
export async function submitBranch(
  store: WorkspaceStore,
  actor: Actor,
  input: SubmitBranchInput,
  digest: string,
): Promise<Result<AcceptedBranch>> {
  if (input.revisions.length === 0) return fail('invalid_graph');
  const fileIds = [
    ...new Set(input.revisions.map((revision) => revision.fileId)),
  ].sort();
  if (fileIds.length > maxFilesPerChangeset) {
    return fail('invalid_graph', fileIds);
  }

  return store.transact<Result<AcceptedBranch>>(
    actor,
    input.workspaceId,
    async (tx) => {
      const role = await tx.role(actor.accountId);
      if (role === null) return fail('forbidden');
      const permitted = authorize(actor, input.workspaceId, role, 'write');
      if (!permitted.ok) return fail('forbidden');

      const receipt = await tx.receipt<AcceptedBranch>(
        input.mutationId,
        actor.accountId,
      );
      if (receipt !== null) {
        if (receipt.digest === digest) return ok(receipt.outcome);
        return fail('mutation_reused', fileIds);
      }

      const purged = await tx.purgedFiles(fileIds);
      if (purged.length > 0) return fail('purged', purged);

      // Normalize paths
      const normalizedRevisions: RevisionInput[] = [];
      for (const revision of input.revisions) {
        const normalized = normalizePath(
          revision.path,
          pathKind(revision.content),
        );
        if (!normalized.ok) return fail('invalid_path', [revision.fileId]);
        normalizedRevisions.push({
          ...revision,
          path: normalized.value,
        });
      }

      // Check graph validity
      const submitted = new Set(input.revisions.map((r) => r.id));
      const wantedParents = new Set<string>();
      for (const revision of input.revisions) {
        for (const parent of revision.parents) {
          if (!submitted.has(parent)) wantedParents.add(parent);
        }
      }
      for (const head of Object.values(input.expectedHeads)) {
        if (head !== null && !submitted.has(head)) wantedParents.add(head);
      }
      const known =
        wantedParents.size === 0
          ? new Map<string, string>()
          : await tx.parents([...wantedParents]);

      const graph = validateGraph(normalizedRevisions, known);
      if (!graph.ok) return graph;

      // Verify content
      for (const rev of normalizedRevisions) {
        if (rev.content.kind === 'markdown') {
          if (!rev.content.text.isWellFormed()) {
            return fail('invalid_content', [rev.fileId]);
          }
          if (rev.deleted && rev.content.text !== '') {
            return fail('invalid_content', [rev.fileId]);
          }
          const calcDigest = await contentDigest(rev.content.text);
          if (calcDigest !== rev.content.digest.toLowerCase()) {
            return fail('invalid_content', [rev.fileId]);
          }
        }
      }

      const normalizedInput: SubmitBranchInput = {
        ...input,
        revisions: normalizedRevisions,
      };

      return tx.acceptBranch(actor, normalizedInput, digest);
    },
  );
}

/** One resolution item for a file in a conflict group. */
export type BranchResolution = {
  readonly fileId: string;
  readonly expectedHead: string | null;
  readonly branchTip: string;
  readonly revisionId: string;
  readonly path: string;
  readonly content: ContentRef;
  readonly deleted: boolean;
  readonly message?: string | null;
};

/** Input payload for resolving branches. */
export type ResolveBranchesInput = {
  readonly workspaceId: string;
  readonly mutationId: string;
  readonly deviceId: string;
  readonly clientTime: string;
  readonly conflictGroupId?: string;
  readonly resolutions: readonly BranchResolution[];
};

/** Stored outcome of a branch resolution. */
export type AcceptedBranchResolution = {
  readonly mutationId: string;
  readonly revisions: readonly AcceptedRevision[];
  readonly resolvedBranchIds: readonly string[];
};

/**
 * Resolves divergent branches explicitly.
 *
 * A resolution revision carries two parents: the expected accepted head and
 * the branch tip. It advances accepted heads and marks branches as resolved.
 * If a race occurs on the expected head, the transaction fails and the open
 * branches remain preserved.
 */
export async function resolveBranches(
  store: WorkspaceStore,
  actor: Actor,
  input: ResolveBranchesInput,
  digest: string,
): Promise<Result<AcceptedBranchResolution>> {
  if (input.resolutions.length === 0) return fail('invalid_graph');
  const fileIds = [
    ...new Set(input.resolutions.map((res) => res.fileId)),
  ].sort();
  if (fileIds.length > maxFilesPerChangeset) {
    return fail('invalid_graph', fileIds);
  }

  return store.transact<Result<AcceptedBranchResolution>>(
    actor,
    input.workspaceId,
    async (tx) => {
      const role = await tx.role(actor.accountId);
      if (role === null) return fail('forbidden');
      const permitted = authorize(actor, input.workspaceId, role, 'write');
      if (!permitted.ok) return fail('forbidden');

      const receipt = await tx.receipt<AcceptedBranchResolution>(
        input.mutationId,
        actor.accountId,
      );
      if (receipt !== null) {
        if (receipt.digest === digest) return ok(receipt.outcome);
        return fail('mutation_reused', fileIds);
      }

      const purged = await tx.purgedFiles(fileIds);
      if (purged.length > 0) return fail('purged', purged);

      // Verify expected heads
      const currentHeads = await tx.heads(fileIds);
      for (const res of input.resolutions) {
        const head = currentHeads.get(res.fileId) ?? null;
        if (head !== res.expectedHead) {
          return fail('stale_head', [res.fileId]);
        }
      }

      // Verify that branch tips exist and belong to the respective files
      const branchTips = input.resolutions.map((res) => res.branchTip);
      const tipOwners = await tx.parents(branchTips);
      for (const res of input.resolutions) {
        const owner = tipOwners.get(res.branchTip);
        if (owner !== res.fileId) {
          return fail('invalid_graph', [res.fileId]);
        }
      }

      // Verify open branches exist for these branch tips
      const existingBranches = await tx.listBranches(
        input.conflictGroupId
          ? { conflictGroupId: input.conflictGroupId }
          : undefined,
      );
      const openTipSet = new Set(
        existingBranches
          .filter((b) => b.state === 'unresolved')
          .map((b) => b.tipRevisionId),
      );
      for (const res of input.resolutions) {
        if (!openTipSet.has(res.branchTip)) {
          return fail('invalid_graph', [res.fileId]);
        }
      }

      // Build merge revisions with two parents: [expectedHead, branchTip]
      const mergeRevisions: RevisionInput[] = [];
      const expectedHeadsMap: Record<string, string | null> = {};

      for (const res of input.resolutions) {
        expectedHeadsMap[res.fileId] = res.expectedHead;
        const normalized = normalizePath(res.path, pathKind(res.content));
        if (!normalized.ok) return fail('invalid_path', [res.fileId]);

        const parents =
          res.expectedHead === null
            ? [res.branchTip]
            : [res.expectedHead, res.branchTip];

        mergeRevisions.push({
          id: res.revisionId,
          fileId: res.fileId,
          parents,
          path: normalized.value,
          deleted: res.deleted,
          content: res.content,
          clientTime: input.clientTime,
          message: res.message ?? 'Resolved conflict branch',
          restoredFrom: null,
        });
      }

      // Validate graph
      const known = await tx.parents([
        ...branchTips,
        ...Object.values(expectedHeadsMap).filter(
          (h): h is string => h !== null,
        ),
      ]);
      const graph = validateGraph(mergeRevisions, known);
      if (!graph.ok) return graph;

      // Validate content
      for (const rev of mergeRevisions) {
        if (rev.content.kind === 'markdown') {
          if (!rev.content.text.isWellFormed()) {
            return fail('invalid_content', [rev.fileId]);
          }
          if (rev.deleted && rev.content.text !== '') {
            return fail('invalid_content', [rev.fileId]);
          }
          const calcDigest = await contentDigest(rev.content.text);
          if (calcDigest !== rev.content.digest.toLowerCase()) {
            return fail('invalid_content', [rev.fileId]);
          }
        }
      }

      const changeset: ChangesetInput = {
        workspaceId: input.workspaceId,
        mutationId: input.mutationId,
        deviceId: input.deviceId,
        expectedHeads: expectedHeadsMap,
        revisions: mergeRevisions,
      };

      const accepted = await tx.accept(actor, changeset, digest);
      if (!accepted.ok) return accepted;

      const resolvedBranchIds = await tx.markBranchesResolved(branchTips);

      // Handle file deletions
      const deletedFiles = mergeRevisions
        .filter((r) => r.deleted)
        .map((r) => r.fileId);
      if (deletedFiles.length > 0) {
        await tx.onFilesDeleted(deletedFiles);
      }

      const outcome: AcceptedBranchResolution = {
        mutationId: input.mutationId,
        revisions: accepted.value.revisions,
        resolvedBranchIds,
      };

      return ok(outcome);
    },
  );
}

/** Input payload for restoring a revision. */
export type RestoreRevisionInput = {
  readonly workspaceId: string;
  readonly fileId: string;
  readonly targetRevisionId: string;
  readonly expectedHead: string | null;
  readonly revisionId: string;
  readonly ids: {
    readonly mutationId: string;
    readonly deviceId: string;
    readonly clientTime: string;
  };
  readonly path?: string;
  readonly message?: string | null;
};

/**
 * Restores a file to an earlier historic revision.
 *
 * It appends a new revision as a child of the current head, referencing the
 * target revision via `restoredFrom`. It reuses existing content without
 * rewinding history or republishing content blobs.
 */
export async function restoreRevision(
  store: WorkspaceStore,
  actor: Actor,
  input: RestoreRevisionInput,
  digest: string,
): Promise<Result<AcceptedChangeset>> {
  return store.transact<Result<AcceptedChangeset>>(
    actor,
    input.workspaceId,
    async (tx) => {
      const role = await tx.role(actor.accountId);
      if (role === null) return fail('forbidden');
      const permitted = authorize(actor, input.workspaceId, role, 'write');
      if (!permitted.ok) return fail('forbidden');

      const receipt = await tx.receipt(input.ids.mutationId, actor.accountId);
      if (receipt !== null) {
        if (receipt.digest === digest) return ok(receipt.outcome);
        return fail('mutation_reused', [input.fileId]);
      }

      const purged = await tx.purgedFiles([input.fileId]);
      if (purged.length > 0) return fail('purged', [input.fileId]);

      const heads = await tx.heads([input.fileId]);
      const currentHead = heads.get(input.fileId) ?? null;
      if (currentHead !== input.expectedHead) {
        return fail('stale_head', [input.fileId]);
      }

      const targetRev = await tx.revision(input.targetRevisionId);
      if (targetRev === null || targetRev.fileId !== input.fileId) {
        return fail('invalid_graph', [input.fileId]);
      }

      const chosenPath = input.path ?? targetRev.path;
      let chosenContent: ContentRef;
      if (targetRev.kind === 'note') {
        chosenContent = {
          kind: 'markdown',
          digest: targetRev.digest,
          text: targetRev.text ?? '',
        };
      } else {
        if (targetRev.objectId === null) {
          return fail('invalid_graph', [input.fileId]);
        }
        chosenContent = {
          kind: 'attachment',
          digest: targetRev.digest,
          objectId: targetRev.objectId,
        };
      }

      const normalized = normalizePath(chosenPath, pathKind(chosenContent));
      if (!normalized.ok) return fail('invalid_path', [input.fileId]);

      const parents = input.expectedHead === null ? [] : [input.expectedHead];

      const revision: RevisionInput = {
        id: input.revisionId,
        fileId: input.fileId,
        parents,
        path: normalized.value,
        deleted: false,
        content: chosenContent,
        clientTime: input.ids.clientTime,
        message:
          input.message ?? `Restored from revision ${input.targetRevisionId}`,
        restoredFrom: input.targetRevisionId,
      };

      const known =
        parents.length === 0
          ? new Map<string, string>()
          : await tx.parents(parents);
      const graph = validateGraph([revision], known);
      if (!graph.ok) return graph;

      const changeset: ChangesetInput = {
        workspaceId: input.workspaceId,
        mutationId: input.ids.mutationId,
        deviceId: input.ids.deviceId,
        expectedHeads: { [input.fileId]: input.expectedHead },
        revisions: [revision],
      };

      return tx.accept(actor, changeset, digest);
    },
  );
}
