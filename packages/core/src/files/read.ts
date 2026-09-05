/**
 * The read use cases of accepted workspace content.
 *
 * A read passes the same two checks as a write: the current role in the
 * workspace, and the verified grants of the transport. Both must permit the
 * `read` action, so an agent token that carries only `write` cannot list the
 * files of a workspace.
 *
 * A record that the actor may not see is reported as `not_found`, never as
 * `forbidden`, so an answer does not disclose that it exists.
 */
import { authorize, type Actor } from '../identity/actor.ts';
import { fail, ok, type Result } from './model.ts';
import type {
  FilePage,
  FileRecord,
  PageRequest,
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
  page: PageRequest,
): Promise<Result<FilePage>> {
  return store.transact<Result<FilePage>>(actor, workspaceId, async (tx) => {
    const permitted = await permitRead(tx, actor, workspaceId);
    if (!permitted.ok) return permitted;
    return ok(
      await tx.listFiles({
        cursor: page.cursor,
        limit: pageSize(page.limit),
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
