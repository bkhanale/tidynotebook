/**
 * The use cases of the trash: list what was deleted, and put one back.
 *
 * Deleting a note writes a tombstone revision, so the note leaves the file
 * tree but keeps its identifier and its whole history. The trash is the
 * listing of exactly those files, and a restore is one more revision on top of
 * the tombstone that carries the content again.
 *
 * A restore is not a new file. The file keeps its identifier, so every link to
 * it stays valid and its history stays one line. Permanent deletion is a
 * different operation: it is `purgeFiles`, which removes the revisions as
 * well, and after it a restore is no longer possible.
 */
import { authorize, type Actor } from '../identity/actor.ts';
import { commitChangeset } from './commit.ts';
import {
  fail,
  ok,
  type AcceptedChangeset,
  type ContentRef,
  type Result,
} from './model.ts';
import type { SubmissionIds } from './operations.ts';
import { workspaceText } from './operations.ts';
import { normalizePath } from './path.ts';
import type {
  DeletedFilePage,
  FilePageRequest,
  WorkspaceStore,
  WorkspaceTransaction,
} from './ports.ts';
import { pageSize } from './read.ts';

/** The suffix of a Markdown path. */
const markdownSuffix = '.md';

/**
 * How many free names a restore looks for before it gives up.
 *
 * A restore whose path is taken lands beside the live file under the same name
 * plus `(restored)`. When that name is taken as well, a number is added. The
 * limit keeps the one lookup that finds a free name bounded.
 */
const maxRestoreCandidates = 20;

/**
 * The candidate paths of a restore, in the order they are preferred.
 *
 * The first candidate is the path that the file held when it was deleted. The
 * others keep the folder and the suffix and change only the name, so a
 * restored note stays where the user left it.
 */
export function restoreCandidates(path: string): readonly string[] {
  const cut = path.lastIndexOf('/');
  const folder = cut === -1 ? '' : path.slice(0, cut + 1);
  const name = cut === -1 ? path : path.slice(cut + 1);
  const suffix = name.endsWith(markdownSuffix) ? markdownSuffix : '';
  const stem = name.slice(0, name.length - suffix.length);
  const candidates = [path];
  for (let attempt = 1; attempt < maxRestoreCandidates; attempt += 1) {
    const label = attempt === 1 ? '(restored)' : `(restored ${attempt})`;
    candidates.push(`${folder}${stem} ${label}${suffix}`);
  }
  return candidates;
}

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

/** One page of the deleted files of a workspace. */
export function listDeletedFiles(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  page: FilePageRequest,
): Promise<Result<DeletedFilePage>> {
  return store.transact<Result<DeletedFilePage>>(
    actor,
    workspaceId,
    async (tx) => {
      const permitted = await permitRead(tx, actor, workspaceId);
      if (!permitted.ok) return permitted;
      return ok(
        await tx.listDeletedFiles({
          cursor: page.cursor,
          limit: pageSize(page.limit),
          sort: page.sort,
        }),
      );
    },
    { readOnly: true },
  );
}

/** What a restore of one deleted file carries. */
export type RestoreFileInput = {
  readonly workspaceId: string;
  readonly fileId: string;
  /** The identifier that the client assigns to the un-deleting revision. */
  readonly revisionId: string;
  readonly ids: SubmissionIds;
};

/** The content and the free path that a restore writes. */
type RestorePlan = {
  readonly tombstoneId: string;
  readonly path: string;
  readonly content: ContentRef;
};

/**
 * Reads what the restore of one deleted file has to write.
 *
 * The read runs in its own read-only transaction, and the changeset states the
 * tombstone as the expected head, so `commitChangeset` compares that head
 * again under the workspace lock. A change that arrives in between is
 * therefore caught by the commit and not by this read.
 */
async function planRestore(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
  fileId: string,
): Promise<Result<RestorePlan>> {
  return store.transact<Result<RestorePlan>>(
    actor,
    workspaceId,
    async (tx) => {
      const role = await tx.role(actor.accountId);
      if (role === null) return fail('forbidden');
      const permitted = authorize(actor, workspaceId, role, 'write');
      if (!permitted.ok) return fail('forbidden');

      const purged = await tx.purgedFiles([fileId]);
      if (purged.length > 0) return fail('purged', [fileId]);

      const file = await tx.file(fileId);
      // A file that is live has nothing to restore, and a file with no
      // accepted revision was never in the tree. Both are `not_found`, so the
      // answer does not describe a state the caller may not act on.
      if (file === null || !file.deleted || file.headRevisionId === null)
        return fail('not_found', [fileId]);

      const tombstone = await tx.revision(file.headRevisionId);
      if (tombstone === null || !tombstone.deleted)
        return fail('not_found', [fileId]);

      // The content comes from the last revision before the tombstone, because
      // a tombstone carries no note text of its own.
      const parentId = tombstone.parents[0];
      if (parentId === undefined) return fail('not_found', [fileId]);
      const parent = await tx.revision(parentId);
      if (parent === null) return fail('not_found', [fileId]);
      let content: ContentRef;
      if (parent.kind === 'attachment') {
        // An attachment revision names its bytes only through its object, so a
        // stored revision without one is a broken graph rather than a restore
        // that the caller can repeat.
        if (parent.objectId === null) return fail('invalid_graph', [fileId]);
        content = {
          kind: 'attachment',
          digest: parent.digest,
          objectId: parent.objectId,
        };
      } else {
        // A restore edits the document of the note, which the tombstone kept,
        // so the note keeps its identities and its history (record 0084). The
        // epoch comes from the document that the workspace holds.
        const documents = await tx.documents([fileId]);
        const epoch = documents.get(fileId)?.epoch ?? 1;
        content = workspaceText(parent.text ?? '', epoch);
      }

      const candidates = restoreCandidates(tombstone.path);
      const taken = new Set(await tx.takenPaths(candidates));
      const free = candidates.find((candidate) => !taken.has(candidate));
      if (free === undefined) return fail('path_conflict', [fileId]);
      const normalized = normalizePath(
        free,
        content.kind === 'markdown' ? 'note' : 'attachment',
      );
      if (!normalized.ok) return fail('invalid_path', [fileId]);

      return ok({
        tombstoneId: tombstone.revisionId,
        path: normalized.value,
        content,
      });
    },
    { readOnly: true },
  );
}

/**
 * Brings one deleted file back into the file tree.
 *
 * The change is one revision whose only parent is the tombstone, so history
 * stays one line and the deletion stays visible in it. The expected head is
 * that tombstone: a write that reached the file after the deletion makes the
 * commit answer `stale_head` and nothing is written.
 *
 * The file goes back to the path it held before the deletion. When a live file
 * already holds that path, the restore lands beside it under the same name
 * plus `(restored)` in the same folder, so a restore never replaces live work.
 */
export async function restoreFile(
  store: WorkspaceStore,
  actor: Actor,
  input: RestoreFileInput,
  digest: string,
): Promise<Result<AcceptedChangeset>> {
  const plan = await planRestore(store, actor, input.workspaceId, input.fileId);
  if (!plan.ok) return plan;
  return commitChangeset(
    store,
    actor,
    {
      workspaceId: input.workspaceId,
      mutationId: input.ids.mutationId,
      deviceId: input.ids.deviceId,
      expectedHeads: { [input.fileId]: plan.value.tombstoneId },
      revisions: [
        {
          id: input.revisionId,
          fileId: input.fileId,
          parents: [plan.value.tombstoneId],
          path: plan.value.path,
          deleted: false,
          content: plan.value.content,
          clientTime: input.ids.clientTime,
          message: null,
          restoredFrom: null,
        },
      ],
    },
    digest,
  );
}
