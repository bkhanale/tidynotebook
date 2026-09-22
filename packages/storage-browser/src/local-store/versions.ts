/**
 * The versions area of the local store.
 *
 * A checkpoint is one transaction that writes the content, the immutable
 * checkpoint with its parent, the local head, and the queue entry. Either all
 * of them exist or none does, so a queued mutation always has the bytes it
 * refers to and a stored checkpoint always has a parent. `listCheckpoints`
 * reads the local history of one file.
 */
import { deletionSave, foldTextIntoDocument } from './documents.ts';
import { contentDigest } from '@notesapp/core';
import type { ChangesetInput } from '@notesapp/core';
import {
  LocalStorageError,
  shouldCheckpoint,
  type CheckpointRecord,
  type Draft,
  type LocalStore,
  type QueueEntry,
} from '@notesapp/sync';
import { guard, type CheckpointRow, type FileRow } from '../database.ts';
import {
  validateAcceptedFile,
  validateCheckpoint,
  validateContent,
  validateDraft,
} from '../migrations.ts';
import {
  byteLength,
  draftRow,
  expectedHeadOfParent,
  nextCheckpointSequence,
  nextQueueSequence,
  type LocalStoreContext,
} from './shared.ts';

type VersionsSlice = Pick<
  LocalStore,
  'checkpoint' | 'listCheckpoints' | 'readRevisionText'
>;

export function createVersionsSlice(ctx: LocalStoreContext): VersionsSlice {
  const { serverOrigin, deviceId, db, tables, nowIso, newId, publish } = ctx;

  /** The public view of a stored checkpoint. */
  const checkpointOf = (row: CheckpointRow): CheckpointRecord => ({
    serverOrigin: row.serverOrigin,
    accountId: row.accountId,
    workspaceId: row.workspaceId,
    revisionId: row.revisionId,
    fileId: row.fileId,
    workingCopyId: row.workingCopyId,
    parents: row.parents,
    path: row.path,
    deleted: row.deleted,
    digest: row.digest,
    message: row.message,
    clientTime: row.clientTime,
    mutationId: row.mutationId,
    accepted: row.accepted,
  });

  return {
    /**
     * The text of one local revision, or null (record 0085).
     *
     * A save carries work, so the text that a refused save kept comes from
     * the checkpoint that froze it and the content row it named.
     */
    readRevisionText(
      accountId: string,
      workspaceId: string,
      revisionId: string,
    ): Promise<string | null> {
      return guard('reading the text of a revision', () =>
        db.transaction('r', [tables.checkpoints, tables.contents], async () => {
          const stored: unknown = await tables.checkpoints.get([
            serverOrigin,
            accountId,
            workspaceId,
            revisionId,
          ]);
          if (stored === undefined) return null;
          const checkpoint = validateCheckpoint(stored);
          const content: unknown = await tables.contents.get([
            serverOrigin,
            accountId,
            workspaceId,
            checkpoint.digest,
          ]);
          return content === undefined ? null : validateContent(content).text;
        }),
      );
    },

    async checkpoint(
      draft: Draft,
      message: string | null,
    ): Promise<QueueEntry | null> {
      // A tombstone carries no text. The revision before it still holds the
      // content of the note, and a deletion that submitted Markdown would add
      // content while it claims to remove a file, which the server refuses.
      const revisionText = draft.deleted ? '' : draft.text;
      // The digest is computed before the transaction. WebCrypto is not a
      // database promise, so awaiting it inside a Dexie transaction would
      // leave the transaction zone and the transaction would already be gone.
      // A browser without WebCrypto cannot address content, so the caller
      // receives the same typed failure as for a refused write.
      const digest = await guard('creating a checkpoint', () =>
        contentDigest(revisionText),
      );
      const clientTime = nowIso();
      const revisionId = newId();
      const mutationId = newId();
      const created = await guard('creating a checkpoint', () =>
        db.transaction(
          'rw',
          [
            tables.drafts,
            tables.checkpoints,
            tables.contents,
            tables.acceptedFiles,
            tables.queue,
            tables.documents,
          ],
          async (): Promise<QueueEntry | null> => {
            const { accountId, workspaceId, fileId } = draft;
            const storedDraft: unknown = await tables.drafts.get([
              serverOrigin,
              accountId,
              workspaceId,
              draft.workingCopyId,
            ]);
            const current =
              storedDraft === undefined ? null : validateDraft(storedDraft);
            // A caller that supplies an older buffer than the stored draft
            // would commit older text as an immutable version. The write is
            // refused, so the newer draft stays intact and the caller can
            // flush it and try again.
            if (current !== null && current.sequence > draft.sequence)
              throw new LocalStorageError(
                'stale',
                'a newer draft of this working copy is stored',
              );
            const storedFile: unknown = await tables.acceptedFiles.get([
              serverOrigin,
              accountId,
              workspaceId,
              fileId,
            ]);
            const file =
              storedFile === undefined
                ? null
                : validateAcceptedFile(storedFile);

            // A note that reached Trash comes back only through a restore,
            // which the server owns. A live revision over a tombstone would
            // undo the deletion, so it is refused and nothing is written. The
            // screen that asked cannot know better than the store: the
            // deletion may have arrived from another tab, another device, or
            // the sidebar while this editor was still open (record 0032).
            if (!draft.deleted && file?.deleted === true)
              throw new LocalStorageError(
                'stale',
                'this file is in Trash, so it takes no new version',
              );

            const lastCheckpointId = current?.lastCheckpointId ?? null;
            let previous: {
              digest: string;
              path: string;
              deleted: boolean;
            } | null = null;
            if (lastCheckpointId !== null) {
              const stored: unknown = await tables.checkpoints.get([
                serverOrigin,
                accountId,
                workspaceId,
                lastCheckpointId,
              ]);
              if (stored !== undefined) previous = validateCheckpoint(stored);
            }
            // A working copy that has not checkpointed yet is compared with
            // the accepted head it started from, so opening a file and leaving
            // it writes nothing.
            if (
              previous === null &&
              file !== null &&
              file.acceptedHeadDigest !== null &&
              file.acceptedHeadRevisionId ===
                (lastCheckpointId ?? draft.baseRevisionId)
            )
              previous = {
                digest: file.acceptedHeadDigest,
                path: file.path,
                deleted: file.deleted,
              };

            if (
              !shouldCheckpoint(
                previous,
                { digest, path: draft.path, deleted: draft.deleted },
                message,
              )
            )
              return null;

            // The text of this save becomes work on the document of the
            // note, inside this transaction, so a second tab that wrote first
            // keeps its work (records 0081, 0085).
            const key = { serverOrigin, accountId, workspaceId, fileId };
            const folded = draft.deleted
              ? { row: null, save: await deletionSave(tables, key) }
              : await foldTextIntoDocument(tables, key, revisionText);
            if (folded.row !== null) await tables.documents.put(folded.row);

            const parentId = lastCheckpointId ?? draft.baseRevisionId;
            const parents = parentId === null ? [] : [parentId];
            await tables.contents.put({
              serverOrigin,
              accountId,
              workspaceId,
              digest,
              text: revisionText,
              bytes: null,
              size: byteLength(revisionText),
            });
            const checkpoint: CheckpointRow = {
              serverOrigin,
              accountId,
              workspaceId,
              revisionId,
              fileId,
              workingCopyId: draft.workingCopyId,
              parents,
              path: draft.path,
              deleted: draft.deleted,
              digest,
              message,
              clientTime,
              mutationId,
              accepted: false,
              sequence: await nextCheckpointSequence(
                ctx,
                accountId,
                workspaceId,
              ),
            };
            // `add` and not `put`: a checkpoint is immutable, so writing over
            // an existing identifier is a defect, not an update.
            await tables.checkpoints.add(checkpoint);

            const nextFile: FileRow = {
              serverOrigin,
              accountId,
              workspaceId,
              fileId,
              kind: file?.kind ?? 'note',
              path: draft.path,
              deleted: draft.deleted,
              acceptedHeadRevisionId: file?.acceptedHeadRevisionId ?? null,
              acceptedHeadDigest: file?.acceptedHeadDigest ?? null,
              localHeadRevisionId: revisionId,
              updatedAt: clientTime,
            };
            await tables.acceptedFiles.put(nextFile);
            const input: ChangesetInput = {
              workspaceId,
              mutationId,
              deviceId,
              // The accepted revision this content descends from, read from
              // the parent chain and never from the mirror. The mirror moves
              // when the ordered feed brings a version of another device, and
              // a precondition taken from it would tell the server that this
              // save had seen that version (record 0073).
              expectedHeads: {
                [fileId]: await expectedHeadOfParent(
                  ctx,
                  accountId,
                  workspaceId,
                  parentId,
                ),
              },
              revisions: [
                {
                  id: revisionId,
                  fileId,
                  parents,
                  path: draft.path,
                  deleted: draft.deleted,
                  content: { kind: 'markdown', document: folded.save },
                  clientTime,
                  message,
                  restoredFrom: null,
                },
              ],
            };
            await tables.queue.add({
              serverOrigin,
              accountId,
              workspaceId,
              mutationId,
              sequence: await nextQueueSequence(ctx, accountId, workspaceId),
              input,
              state: 'pending',
              digest: null,
              errorCode: null,
              createdAt: clientTime,
            });

            await tables.drafts.put({
              ...draftRow(ctx, draft, lastCheckpointId),
              lastCheckpointId: revisionId,
              savedAt: clientTime,
            });
            return {
              accountId,
              input,
              state: 'pending',
              digest: null,
              errorCode: null,
            };
          },
        ),
      );
      if (created !== null)
        publish({
          accountId: draft.accountId,
          workspaceId: draft.workspaceId,
          fileId: draft.fileId,
          kind: 'queue',
        });
      return created;
    },

    listCheckpoints(
      accountId: string,
      workspaceId: string,
      fileId: string,
    ): Promise<readonly CheckpointRecord[]> {
      return guard('reading local history', () =>
        db.transaction('r', tables.checkpoints, async () => {
          const rows: unknown[] = await tables.checkpoints
            .where('[serverOrigin+accountId+workspaceId+fileId]')
            .equals([serverOrigin, accountId, workspaceId, fileId])
            .toArray();
          return rows
            .map((row: unknown) => validateCheckpoint(row))
            .sort((left, right) => left.sequence - right.sequence)
            .map(checkpointOf);
        }),
      );
    },
  };
}
