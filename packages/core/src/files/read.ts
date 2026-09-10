/**
 * The read use cases of accepted workspace content.
 *
 * A read passes the same two checks as a write: the current role in the
 * workspace, and the verified grants of the transport. Both must permit the
 * `read` action, so a transport that does not carry it cannot list the files
 * of a workspace.
 *
 * A record that the actor may not see is reported as `not_found`, never as
 * `forbidden`, so an answer does not disclose that it exists.
 */
import { authorize, type Actor } from '../identity/actor.ts';
import { fail, ok, type Result } from './model.ts';
import type {
  FilePage,
  FilePageRequest,
  FileRecord,
  FileSort,
  MutationReceipt,
  RevisionRecord,
  WorkspaceStore,
  WorkspaceTransaction,
} from './ports.ts';

/** The largest page that one list call returns. */
export const maxPageSize = 500;

/** The page size of a list call that asks for none. */
export const defaultPageSize = 100;

/** One file together with the content of its accepted head. */
export type FileWithHead = {
  readonly file: FileRecord;
  /** The head revision, or `null` for a file with no accepted revision. */
  readonly head: RevisionRecord | null;
};

/** Checks that the actor may read this workspace. */
async function permitRead(
  tx: WorkspaceTransaction,
  actor: Actor,
  workspaceId: string,
): Promise<Result<void>> {
  const role = await tx.role(actor.accountId);
  if (role === null) return fail('forbidden');
  return authorize(actor, workspaceId, role, 'read');
}

/** The sort of a file listing that names none. */
export const defaultFileSort: FileSort = 'updated';

/** The requested file sort, or the default when the request names none. */
export function fileSort(value: unknown): FileSort {
  return value === 'path' ? 'path' : defaultFileSort;
}

/** Keeps a requested page size inside the served range. */
export function pageSize(limit: number | null): number {
  if (limit === null || !Number.isFinite(limit)) return defaultPageSize;
  return Math.min(Math.max(1, Math.trunc(limit)), maxPageSize);
}

/** One page of the live files of a workspace. */
export function listFiles(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  page: FilePageRequest,
): Promise<Result<FilePage>> {
  return store.transact<Result<FilePage>>(actor, workspaceId, async (tx) => {
    const permitted = await permitRead(tx, actor, workspaceId);
    if (!permitted.ok) return permitted;
    return ok(
      await tx.listFiles({
        cursor: page.cursor,
        limit: pageSize(page.limit),
        sort: page.sort,
      }),
    );
  });
}

/**
 * One file and the content of its accepted head.
 *
 * A deleted file is reported as `not_found`: it holds no place in the file
 * tree any more. Its revisions, including the tombstone, stay readable through
 * `readRevision`.
 */
export function readFile(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  fileId: string,
): Promise<Result<FileWithHead>> {
  return store.transact<Result<FileWithHead>>(
    actor,
    workspaceId,
    async (tx) => {
      const permitted = await permitRead(tx, actor, workspaceId);
      if (!permitted.ok) return permitted;
      const purged = await tx.purgedFiles([fileId]);
      if (purged.length > 0) return fail('purged', [fileId]);
      const file = await tx.file(fileId);
      if (file === null || file.deleted) return fail('not_found', [fileId]);
      const head =
        file.headRevisionId === null
          ? null
          : await tx.revision(file.headRevisionId);
      return ok({ file, head });
    },
  );
}

/**
 * The accepted head of a file, for the operation that is about to change it.
 *
 * This is part of the write path, so it checks the `write` action rather than
 * `read`. A caller that may write a file may base its revision on the head of
 * that file: it needs the head identifier as the parent of its revision, and
 * it needs the stored path and content when its request changes only one of
 * them. The value never reaches a write answer, so this call discloses no
 * content to an actor that may not read the workspace.
 *
 * A file that does not exist, one that has no accepted revision, and one that
 * was deleted are all `not_found`. Restoring a deleted file is an explicit
 * operation of its own.
 *
 * The answer can be out of date the moment it is returned. That is safe: the
 * changeset states the head it saw, and `commitChangeset` compares it again
 * under the workspace lock, so a change in between is a `stale_head`.
 */
export function readHeadForWrite(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  fileId: string,
): Promise<Result<RevisionRecord>> {
  return store.transact<Result<RevisionRecord>>(
    actor,
    workspaceId,
    async (tx) => {
      const role = await tx.role(actor.accountId);
      if (role === null) return fail('forbidden');
      const permitted = authorize(actor, workspaceId, role, 'write');
      if (!permitted.ok) return permitted;
      const purged = await tx.purgedFiles([fileId]);
      if (purged.length > 0) return fail('purged', [fileId]);
      const file = await tx.file(fileId);
      if (file === null || file.deleted || file.headRevisionId === null)
        return fail('not_found', [fileId]);
      const head = await tx.revision(file.headRevisionId);
      if (head === null) return fail('not_found', [fileId]);
      return ok(head);
    },
  );
}

/**
 * The receipt of an earlier mutation of this actor, or `null`.
 *
 * This is part of the write path, so it checks the `write` action. A transport
 * uses it to answer a retry the way the first attempt was answered, before it
 * reads the current head: an accepted mutation must be replayable after the
 * head has moved on, and a reused mutation identity must be reported as such
 * rather than as a failed precondition. `commitChangeset` applies the same
 * order inside its transaction, so a race only sends the request down the
 * normal path, where the receipt is found again.
 */
export function readMutationReceipt(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  mutationId: string,
): Promise<Result<MutationReceipt | null>> {
  return store.transact<Result<MutationReceipt | null>>(
    actor,
    workspaceId,
    async (tx) => {
      const role = await tx.role(actor.accountId);
      if (role === null) return fail('forbidden');
      const permitted = authorize(actor, workspaceId, role, 'write');
      if (!permitted.ok) return permitted;
      return ok(await tx.receipt(mutationId, actor.accountId));
    },
  );
}

/** One immutable revision of a workspace. */
export function readRevision(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  revisionId: string,
): Promise<Result<RevisionRecord>> {
  return store.transact<Result<RevisionRecord>>(
    actor,
    workspaceId,
    async (tx) => {
      const permitted = await permitRead(tx, actor, workspaceId);
      if (!permitted.ok) return permitted;
      const revision = await tx.revision(revisionId);
      if (revision === null) return fail('not_found');
      return ok(revision);
    },
  );
}
