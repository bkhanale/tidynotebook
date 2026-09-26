/**
 * The reads over the cached mirror of server state.
 *
 * These queries read the accepted files, the drafts overlay, and the stored
 * content that the snapshot area maintains. They never write, so they hold no
 * transaction boundary of their own beyond the read transaction each opens:
 * the local files with the draft overlay, the save state of one file, the
 * search bodies, and content presence.
 */
import type {
  FileSaveSnapshot,
  LocalAcceptedFile,
  LocalFileSummary,
  LocalStore,
} from '@notesapp/sync';
import {
  guard,
  partitionRange,
  type DraftRow,
  type FileRow,
} from '../database.ts';
import {
  validateAcceptedFile,
  validateContent,
  validateDraft,
  validateQueueRow,
} from '../migrations.ts';
import {
  draftHoldsWork,
  draftLeads,
  matchesPartition,
  type LocalStoreContext,
} from './shared.ts';

type FilesSlice = Pick<
  LocalStore,
  | 'listAcceptedFiles'
  | 'listLocalFiles'
  | 'readFileSaveSnapshot'
  | 'listSearchFiles'
  | 'hasContent'
>;

export function createFilesSlice(ctx: LocalStoreContext): FilesSlice {
  const { serverOrigin, db, tables } = ctx;

  return {
    listAcceptedFiles(
      accountId: string,
      workspaceId: string,
    ): Promise<readonly LocalAcceptedFile[]> {
      return guard('reading accepted files', () =>
        db.transaction('r', tables.acceptedFiles, async () => {
          const range = partitionRange(serverOrigin, accountId, workspaceId);
          const rows: unknown[] = await tables.acceptedFiles
            .where('[serverOrigin+accountId+workspaceId+fileId]')
            .between(range.lower, range.upper, true, true)
            .toArray();
          return rows
            .map((row: unknown) => validateAcceptedFile(row))
            .sort((left, right) => (left.path < right.path ? -1 : 1));
        }),
      );
    },

    listLocalFiles(
      accountId: string,
      workspaceId: string,
    ): Promise<readonly LocalFileSummary[]> {
      return guard('reading local files', () =>
        db.transaction('r', [tables.acceptedFiles, tables.drafts], async () => {
          const range = partitionRange(serverOrigin, accountId, workspaceId);
          const acceptedRows: unknown[] = await tables.acceptedFiles
            .where('[serverOrigin+accountId+workspaceId+fileId]')
            .between(range.lower, range.upper, true, true)
            .toArray();
          const draftRows: unknown[] = await tables.drafts.toArray();
          const result = new Map<string, LocalFileSummary>();
          const accepted = new Map<string, FileRow>();
          for (const raw of acceptedRows) {
            const file = validateAcceptedFile(raw);
            accepted.set(file.fileId, file);
            result.set(file.fileId, {
              fileId: file.fileId,
              path: file.path,
              kind: file.kind,
              deleted: file.deleted,
              updatedAt: file.updatedAt,
              acceptedHeadRevisionId: file.acceptedHeadRevisionId,
              localHeadRevisionId: file.localHeadRevisionId,
              localOnly: file.acceptedHeadRevisionId === null,
            });
          }
          const newestDrafts = new Map<string, DraftRow>();
          for (const raw of draftRows) {
            const draft = validateDraft(raw);
            if (!matchesPartition(ctx, draft, accountId, workspaceId)) continue;
            const previous = newestDrafts.get(draft.fileId);
            if (
              previous === undefined ||
              draft.savedAt > previous.savedAt ||
              (draft.savedAt === previous.savedAt &&
                draft.sequence > previous.sequence)
            )
              newestDrafts.set(draft.fileId, draft);
          }
          for (const draft of newestDrafts.values()) {
            const known = result.get(draft.fileId);
            if (!draftLeads(accepted.get(draft.fileId), draft)) continue;
            result.set(draft.fileId, {
              fileId: draft.fileId,
              path: draft.path,
              kind: known?.kind ?? 'note',
              deleted: draft.deleted,
              updatedAt: draft.savedAt,
              acceptedHeadRevisionId: known?.acceptedHeadRevisionId ?? null,
              localHeadRevisionId:
                known?.localHeadRevisionId ?? draft.lastCheckpointId,
              localOnly: known?.acceptedHeadRevisionId == null,
            });
          }
          return [...result.values()].sort((left, right) =>
            left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
          );
        }),
      );
    },

    readFileSaveSnapshot(
      accountId: string,
      workspaceId: string,
      fileId: string,
    ): Promise<FileSaveSnapshot> {
      return guard('reading file save state', () =>
        db.transaction(
          'r',
          [
            tables.acceptedFiles,
            tables.drafts,
            tables.checkpoints,
            tables.contents,
            tables.queue,
          ],
          async () => {
            const draftRows: unknown[] = await tables.drafts
              .where('[serverOrigin+accountId+workspaceId+fileId]')
              .equals([serverOrigin, accountId, workspaceId, fileId])
              .toArray();
            const draft = draftRows
              .map((row: unknown) => validateDraft(row))
              .sort((left, right) =>
                left.savedAt < right.savedAt
                  ? 1
                  : left.savedAt > right.savedAt
                    ? -1
                    : right.sequence - left.sequence,
              )[0];
            const queueRows: unknown[] = await tables.queue
              .where('[serverOrigin+accountId+workspaceId+sequence]')
              .between(
                partitionRange(serverOrigin, accountId, workspaceId).lower,
                partitionRange(serverOrigin, accountId, workspaceId).upper,
                true,
                true,
              )
              .toArray();
            const queue = queueRows
              .map((row: unknown) => validateQueueRow(row))
              .filter((row) =>
                row.input.revisions.some(
                  (revision) => revision.fileId === fileId,
                ),
              )
              .at(-1);
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
            const hasUncheckpointedDraft =
              draft !== undefined && (await draftHoldsWork(ctx, draft, file));
            // The newest statement of this device: the leading working copy,
            // else the file row. The open editor reads both, so a path or a
            // deletion that another surface wrote reaches it.
            const leading =
              draft !== undefined && draftLeads(file, draft) ? draft : null;
            return {
              fileId,
              path: leading?.path ?? file?.path ?? null,
              deleted: leading?.deleted ?? file?.deleted ?? false,
              latestDraftSequence: draft?.sequence ?? null,
              latestMutationId: queue?.mutationId ?? null,
              queueState: queue?.state ?? null,
              acceptedHeadRevisionId: file?.acceptedHeadRevisionId ?? null,
              localHeadRevisionId: file?.localHeadRevisionId ?? null,
              hasUncheckpointedDraft,
            };
          },
        ),
      );
    },

    listSearchFiles(accountId: string, workspaceId: string) {
      return guard('reading local search content', () =>
        db.transaction(
          'r',
          [tables.acceptedFiles, tables.contents, tables.drafts],
          async () => {
            const range = partitionRange(serverOrigin, accountId, workspaceId);
            const acceptedRows: unknown[] = await tables.acceptedFiles
              .where('[serverOrigin+accountId+workspaceId+fileId]')
              .between(range.lower, range.upper, true, true)
              .toArray();
            const result = new Map<
              string,
              {
                fileId: string;
                path: string;
                revisionId: string;
                text: string;
              }
            >();
            const accepted = new Map<string, FileRow>();
            for (const raw of acceptedRows) {
              const file = validateAcceptedFile(raw);
              accepted.set(file.fileId, file);
              if (
                file.deleted ||
                file.kind !== 'note' ||
                file.acceptedHeadRevisionId === null ||
                file.acceptedHeadDigest === null
              )
                continue;
              const body: unknown = await tables.contents.get([
                serverOrigin,
                accountId,
                workspaceId,
                file.acceptedHeadDigest,
              ]);
              if (body === undefined) continue;
              const content = validateContent(body);
              if (content.text === null) continue;
              result.set(file.fileId, {
                fileId: file.fileId,
                path: file.path,
                revisionId: file.acceptedHeadRevisionId,
                text: content.text,
              });
            }

            const drafts: unknown[] = await tables.drafts.toArray();
            const latest = new Map<string, DraftRow>();
            for (const raw of drafts) {
              const draft = validateDraft(raw);
              if (!matchesPartition(ctx, draft, accountId, workspaceId))
                continue;
              const seen = latest.get(draft.fileId);
              if (seen === undefined || seen.sequence < draft.sequence)
                latest.set(draft.fileId, draft);
            }
            for (const draft of latest.values()) {
              if (!draftLeads(accepted.get(draft.fileId), draft)) continue;
              if (draft.deleted) {
                result.delete(draft.fileId);
                continue;
              }
              result.set(draft.fileId, {
                fileId: draft.fileId,
                path: draft.path,
                revisionId:
                  draft.lastCheckpointId ??
                  draft.baseRevisionId ??
                  draft.workingCopyId,
                text: draft.text,
              });
            }
            return [...result.values()].sort((left, right) =>
              left.path < right.path ? -1 : 1,
            );
          },
        ),
      );
    },

    hasContent(
      accountId: string,
      workspaceId: string,
      digest: string,
    ): Promise<boolean> {
      return guard('reading stored content', () =>
        db.transaction('r', tables.contents, async () => {
          const stored: unknown = await tables.contents.get([
            serverOrigin,
            accountId,
            workspaceId,
            digest,
          ]);
          return stored !== undefined;
        }),
      );
    },
  };
}
