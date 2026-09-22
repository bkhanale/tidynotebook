/**
 * The snapshot area of the local store.
 *
 * It owns the offline snapshot lifecycle (stage, store, activate) and the
 * reads over the cached mirror of server state: the accepted files, the local
 * files with the draft overlay, the save state of one file, the search bodies,
 * and content presence. `applyRemoteChanges` folds the change feed into the
 * mirror without overwriting unsubmitted local work.
 */
import { applyServerWork } from './documents.ts';
import {
  LocalStorageError,
  type LocalStore,
  type RemoteChange,
  type ServerNote,
  type SnapshotRevision,
} from '@notesapp/sync';
import {
  guard,
  partitionRange,
  type DraftRow,
  type FileRow,
  type SnapshotItemRow,
} from '../database.ts';
import {
  validateAcceptedFile,
  validateContent,
  validateCursor,
  validateQueueRow,
  validateSnapshot,
  validateSnapshotItem,
} from '../migrations.ts';
import {
  bodyOfDigest,
  byteLength,
  draftsOfFile,
  forgetFileRows,
  type HeadState,
  type LocalStoreContext,
} from './shared.ts';

type SnapshotSlice = Pick<
  LocalStore,
  | 'stageSnapshot'
  | 'storeSnapshotRevision'
  | 'activateSnapshot'
  | 'readCursor'
  | 'applyRemoteChanges'
  | 'forgetPurgedFiles'
  | 'cacheServerNote'
>;

export function createSnapshotSlice(ctx: LocalStoreContext): SnapshotSlice {
  const { serverOrigin, db, tables, nowIso, publish } = ctx;

  /**
   * Whether one draft says something that neither head says.
   *
   * A tombstone carries no text, so a deleted draft and a deleted head at the
   * same path say the same thing whatever text the draft still holds. Reading
   * the text of a deleted draft as work would keep the tombstone shadowing
   * the file for ever, and a restore on the server would never reach the
   * device.
   */
  const draftIsUnsentWork = (
    draft: DraftRow,
    heads: readonly HeadState[],
  ): boolean =>
    !heads.some(
      (head) =>
        draft.path === head.path &&
        draft.deleted === head.deleted &&
        (draft.deleted || (head.text !== null && draft.text === head.text)),
    );

  /**
   * Whether a draft of one file holds work that no head of it holds.
   *
   * This is the second half of the dirty test. A local head that is ahead of
   * the accepted head is unsubmitted work, and so is a draft whose text, path
   * or deletion state neither the current accepted head nor the arriving one
   * contains. Without the draft half, an arriving head moves the local head
   * while the draft keeps shadowing it, and the person then edits stale text
   * with no notice.
   *
   * A draft that one of the two heads already contains is not work: the
   * arriving head either states it or supersedes it, so the file follows the
   * server and `readCachedNote` removes the draft on the next open.
   */
  const hasDivergentDraft = async (
    accountId: string,
    workspaceId: string,
    fileId: string,
    heads: readonly HeadState[],
  ): Promise<boolean> => {
    const drafts = await draftsOfFile(ctx, accountId, workspaceId, fileId);
    return drafts.some((draft) => draftIsUnsentWork(draft, heads));
  };

  /**
   * Removes every working copy of one file that holds no unsent work.
   *
   * A draft is recovery data for work that has not reached the server. A head
   * that arrives and already states what a draft says leaves that draft with
   * nothing to recover, and a draft that stays goes on shadowing the newer
   * head: `readCachedNote` opens its text, the person edits a version that
   * somebody else replaced, and a restore has no visible effect on the device
   * that asked for it (record 0073).
   *
   * The caller runs this only where the accepted head follows the server, so
   * every surviving draft is one the dirty test named as real work.
   */
  const dropSettledDrafts = async (
    accountId: string,
    workspaceId: string,
    fileId: string,
    heads: readonly HeadState[],
  ): Promise<void> => {
    for (const draft of await draftsOfFile(ctx, accountId, workspaceId, fileId))
      if (!draftIsUnsentWork(draft, heads))
        await tables.drafts.delete([
          serverOrigin,
          accountId,
          workspaceId,
          draft.workingCopyId,
        ]);
  };

  /** The accepted state of one file as a comparable head. */
  const acceptedHeadState = async (
    accountId: string,
    workspaceId: string,
    file: FileRow | null,
  ): Promise<HeadState | null> => {
    if (file === null || file.acceptedHeadDigest === null) return null;
    return {
      path: file.path,
      deleted: file.deleted,
      text: await bodyOfDigest(
        ctx,
        accountId,
        workspaceId,
        file.acceptedHeadDigest,
      ),
    };
  };

  /**
   * Forgets every local trace of one permanently deleted file.
   *
   * The listing of the server can only say which files exist, so a cache entry
   * that the server dropped stays until something removes it. A purge marker in
   * the ordered change feed, and a full snapshot that leaves the file out, are
   * the two signals. The forget covers the accepted row, the drafts, the
   * checkpoints, the queued mutations, and the recovery copies, so no read,
   * re-send, or later snapshot can revive the note.
   *
   * The call runs inside the transaction of its caller, which must cover the
   * accepted files, the drafts, the checkpoints, the queue, and the recovery
   * tables.
   */
  const forgetFile = (
    accountId: string,
    workspaceId: string,
    fileId: string,
  ): Promise<void> => forgetFileRows(ctx, accountId, workspaceId, fileId);

  return {
    stageSnapshot(
      accountId: string,
      workspaceId: string,
      token: string,
      revisionIds: readonly string[],
      cursor: string,
    ): Promise<void> {
      return guard('staging a snapshot', () =>
        db.transaction(
          'rw',
          [tables.stagedSnapshots, tables.snapshotItems],
          async () => {
            await tables.stagedSnapshots.put({
              serverOrigin,
              accountId,
              workspaceId,
              token,
              revisionIds: [...revisionIds],
              cursor,
              state: 'staging',
              createdAt: nowIso(),
            });
            // A restarted download under the same token drops the items of
            // the previous attempt before new ones arrive.
            await tables.snapshotItems
              .where('[serverOrigin+accountId+workspaceId+token]')
              .equals([serverOrigin, accountId, workspaceId, token])
              .delete();
          },
        ),
      );
    },

    storeSnapshotRevision(
      accountId: string,
      workspaceId: string,
      revision: SnapshotRevision,
    ): Promise<void> {
      return guard('storing a snapshot revision', () =>
        db.transaction(
          'rw',
          [tables.contents, tables.snapshotItems],
          async () => {
            if (revision.text !== null) {
              await tables.contents.put({
                serverOrigin,
                accountId,
                workspaceId,
                digest: revision.digest,
                text: revision.text,
                bytes: null,
                size: byteLength(revision.text),
              });
            }
            const item: SnapshotItemRow = {
              serverOrigin,
              accountId,
              workspaceId,
              token: revision.token,
              revisionId: revision.revisionId,
              fileId: revision.fileId,
              path: revision.path,
              kind: revision.kind,
              deleted: revision.deleted,
              digest: revision.digest,
              storedAt: nowIso(),
              document: revision.document,
              epoch: revision.epoch,
            };
            await tables.snapshotItems.put(item);
          },
        ),
      );
    },

    async activateSnapshot(token: string): Promise<void> {
      const activated = await guard('activating a snapshot', () =>
        db.transaction(
          'rw',
          [
            tables.stagedSnapshots,
            tables.snapshotItems,
            tables.contents,
            tables.acceptedFiles,
            tables.cursors,
            tables.drafts,
            tables.queue,
            tables.checkpoints,
            tables.recovery,
            tables.documents,
          ],
          async () => {
            const plans: unknown[] = await tables.stagedSnapshots.toArray();
            const plan =
              plans
                .map((row: unknown) => validateSnapshot(row))
                .find((row) => row.token === token) ?? null;
            if (plan === null)
              throw new LocalStorageError(
                'corrupt',
                'no staged snapshot carries this token',
              );
            if (plan.state === 'active') return null;
            const { accountId, workspaceId } = plan;
            const stored: unknown[] = await tables.snapshotItems
              .where('[serverOrigin+accountId+workspaceId+token]')
              .equals([serverOrigin, accountId, workspaceId, token])
              .toArray();
            const byRevision = new Map(
              stored.map((row: unknown) => {
                const item = validateSnapshotItem(row);
                return [item.revisionId, item] as const;
              }),
            );
            for (const revisionId of plan.revisionIds) {
              const item = byRevision.get(revisionId);
              if (item === undefined)
                throw new LocalStorageError(
                  'aborted',
                  'the staged snapshot is incomplete',
                );
              if (!item.deleted && item.kind === 'note') {
                const body: unknown = await tables.contents.get([
                  serverOrigin,
                  accountId,
                  workspaceId,
                  item.digest,
                ]);
                if (body === undefined || validateContent(body).text === null)
                  throw new LocalStorageError(
                    'aborted',
                    'the staged snapshot is incomplete',
                  );
              }
            }
            const byFile = new Map<string, SnapshotItemRow>();
            for (const item of byRevision.values())
              byFile.set(item.fileId, item);
            for (const item of byFile.values()) {
              // A snapshot is the whole state of the workspace at its cursor,
              // so it carries the whole document of every note. The device
              // starts from that document, which is what keeps its first save
              // a merge of one text rather than two (record 0081).
              if (item.document !== null && item.epoch !== null) {
                const applied = await applyServerWork(
                  tables,
                  {
                    serverOrigin,
                    accountId,
                    workspaceId,
                    fileId: item.fileId,
                  },
                  item.epoch,
                  { kind: 'document', document: item.document },
                );
                await tables.documents.put(applied.row);
              }
              const known: unknown = await tables.acceptedFiles.get([
                serverOrigin,
                accountId,
                workspaceId,
                item.fileId,
              ]);
              const file =
                known === undefined ? null : validateAcceptedFile(known);
              // Same dirty test as the change feed: a local head ahead of
              // the accepted head, or a draft that neither head contains.
              const heads: HeadState[] = [];
              const knownHead = await acceptedHeadState(
                accountId,
                workspaceId,
                file,
              );
              if (knownHead !== null) heads.push(knownHead);
              heads.push({
                path: item.path,
                deleted: item.deleted,
                text: await bodyOfDigest(
                  ctx,
                  accountId,
                  workspaceId,
                  item.digest,
                ),
              });
              const dirty =
                file !== null &&
                ((file.localHeadRevisionId !== null &&
                  file.localHeadRevisionId !== file.acceptedHeadRevisionId) ||
                  (await hasDivergentDraft(
                    accountId,
                    workspaceId,
                    item.fileId,
                    heads,
                  )));
              if (!dirty) {
                await tables.acceptedFiles.put({
                  serverOrigin,
                  accountId,
                  workspaceId,
                  fileId: item.fileId,
                  kind: item.kind,
                  path: item.path,
                  deleted: item.deleted,
                  acceptedHeadRevisionId: item.revisionId,
                  acceptedHeadDigest: item.digest,
                  localHeadRevisionId: item.revisionId,
                  updatedAt: nowIso(),
                });
                await dropSettledDrafts(
                  accountId,
                  workspaceId,
                  item.fileId,
                  heads,
                );
              } else if (file !== null) {
                // The accepted head follows the snapshot, but the path, the
                // deletion state, and the local head keep whatever local
                // work set. A remote head never replaces a dirty copy.
                await tables.acceptedFiles.put({
                  ...file,
                  acceptedHeadRevisionId: item.revisionId,
                  acceptedHeadDigest: item.digest,
                  updatedAt: nowIso(),
                });
              }
            }
            // A full snapshot is the whole server state at its cursor. Any
            // file this device still holds that the snapshot leaves out was
            // removed on the server, so it is forgotten. A file with queued
            // local work is kept: it is either an unsent new note that the
            // server has not seen yet, or a change on its way up.
            const range = partitionRange(serverOrigin, accountId, workspaceId);
            const queuedFiles = new Set<string>();
            for (const row of await tables.queue
              .where('[serverOrigin+accountId+workspaceId+sequence]')
              .between(range.lower, range.upper, true, true)
              .toArray())
              for (const revision of validateQueueRow(row).input.revisions)
                queuedFiles.add(revision.fileId);
            const forgotten: string[] = [];
            for (const row of await tables.acceptedFiles
              .where('[serverOrigin+accountId+workspaceId+fileId]')
              .between(range.lower, range.upper, true, true)
              .toArray()) {
              const file = validateAcceptedFile(row);
              if (byFile.has(file.fileId) || queuedFiles.has(file.fileId))
                continue;
              await forgetFile(accountId, workspaceId, file.fileId);
              forgotten.push(file.fileId);
            }
            await tables.cursors.put({
              serverOrigin,
              accountId,
              workspaceId,
              cursor: plan.cursor,
              updatedAt: nowIso(),
            });
            await tables.stagedSnapshots.put({ ...plan, state: 'active' });
            return {
              accountId,
              workspaceId,
              fileIds: [...byFile.keys(), ...forgotten],
            };
          },
        ),
      );
      if (activated === null) return;
      for (const fileId of activated.fileIds)
        publish({
          accountId: activated.accountId,
          workspaceId: activated.workspaceId,
          fileId,
          kind: 'file',
        });
      publish({
        accountId: activated.accountId,
        workspaceId: activated.workspaceId,
        fileId: null,
        kind: 'cursor',
      });
    },

    async cacheServerNote(
      accountId: string,
      workspaceId: string,
      note: ServerNote,
    ): Promise<void> {
      const written = await guard('keeping a note of the server', () =>
        db.transaction(
          'rw',
          [tables.acceptedFiles, tables.contents],
          async (): Promise<boolean> => {
            const known: unknown = await tables.acceptedFiles.get([
              serverOrigin,
              accountId,
              workspaceId,
              note.fileId,
            ]);
            // A file this device already holds keeps what it holds. This read
            // of the server is only for a note that reached the screen before
            // the ordered feed reached the store.
            if (known !== undefined) return false;
            await tables.contents.put({
              serverOrigin,
              accountId,
              workspaceId,
              digest: note.digest,
              text: note.text,
              bytes: null,
              size: byteLength(note.text),
            });
            await tables.acceptedFiles.put({
              serverOrigin,
              accountId,
              workspaceId,
              fileId: note.fileId,
              kind: note.kind,
              path: note.path,
              deleted: false,
              acceptedHeadRevisionId: note.revisionId,
              acceptedHeadDigest: note.digest,
              localHeadRevisionId: note.revisionId,
              updatedAt: nowIso(),
            });
            return true;
          },
        ),
      );
      if (!written) return;
      publish({ accountId, workspaceId, fileId: note.fileId, kind: 'file' });
    },

    readCursor(accountId: string, workspaceId: string): Promise<string | null> {
      return guard('reading the sync cursor', () =>
        db.transaction('r', tables.cursors, async () => {
          const stored: unknown = await tables.cursors.get([
            serverOrigin,
            accountId,
            workspaceId,
          ]);
          return stored === undefined ? null : validateCursor(stored).cursor;
        }),
      );
    },

    async applyRemoteChanges(
      accountId: string,
      workspaceId: string,
      changes: readonly RemoteChange[],
      nextCursor: string,
    ): Promise<void> {
      await guard('applying remote changes', () =>
        db.transaction(
          'rw',
          [
            tables.contents,
            tables.acceptedFiles,
            tables.drafts,
            tables.cursors,
            tables.queue,
            tables.checkpoints,
            tables.recovery,
            tables.documents,
          ],
          async () => {
            for (const change of changes) {
              const file = change.file;
              if (file === null) {
                // A permanent deletion leaves nothing to restore, so the
                // cached metadata and the cached working copy of that file go
                // with it. Without this the note would stay in the file tree
                // for as long as the cache lives, because the listing of the
                // server can only say which files exist, not which vanished.
                if (change.purgedFileId !== null)
                  await forgetFile(accountId, workspaceId, change.purgedFileId);
                continue;
              }
              // The accepted work of a note applies to the document that this
              // device holds, and the text that a reader sees comes from the
              // result (record 0085). A device that cannot apply the work
              // keeps what it has; the next snapshot repairs it.
              let acceptedText = file.text;
              if (file.document !== null) {
                const applied = await applyServerWork(
                  tables,
                  { serverOrigin, accountId, workspaceId, fileId: file.fileId },
                  file.document.epoch,
                  file.document.kind === 'document'
                    ? { kind: 'document', document: file.document.bytes }
                    : { kind: 'update', update: file.document.bytes },
                );
                await tables.documents.put(applied.row);
                acceptedText = applied.text;
              }
              if (acceptedText !== null) {
                await tables.contents.put({
                  serverOrigin,
                  accountId,
                  workspaceId,
                  digest: file.digest,
                  text: acceptedText,
                  bytes: null,
                  size: byteLength(acceptedText),
                });
              }
              const known: unknown = await tables.acceptedFiles.get([
                serverOrigin,
                accountId,
                workspaceId,
                file.fileId,
              ]);
              const current =
                known === undefined ? null : validateAcceptedFile(known);
              // Unsubmitted work is a local head ahead of the accepted head,
              // and it is also a draft that neither the accepted head nor
              // the arriving one contains. Without the draft half this write
              // moves the local head while the draft keeps shadowing it.
              const heads: HeadState[] = [];
              const knownHead = await acceptedHeadState(
                accountId,
                workspaceId,
                current,
              );
              if (knownHead !== null) heads.push(knownHead);
              heads.push({
                path: file.path,
                deleted: file.deleted,
                text:
                  acceptedText ??
                  (await bodyOfDigest(
                    ctx,
                    accountId,
                    workspaceId,
                    file.digest,
                  )),
              });
              const dirty =
                current !== null &&
                ((current.localHeadRevisionId !== null &&
                  current.localHeadRevisionId !==
                    current.acceptedHeadRevisionId) ||
                  (await hasDivergentDraft(
                    accountId,
                    workspaceId,
                    file.fileId,
                    heads,
                  )));
              if (current === null || !dirty) {
                await tables.acceptedFiles.put({
                  serverOrigin,
                  accountId,
                  workspaceId,
                  fileId: file.fileId,
                  kind: file.fileKind,
                  path: file.path,
                  deleted: file.deleted,
                  acceptedHeadRevisionId: file.revisionId,
                  acceptedHeadDigest: file.digest,
                  localHeadRevisionId: file.revisionId,
                  updatedAt: nowIso(),
                });
                // Every working copy of this file that holds no unsent work
                // goes with the head it described. A tombstone draft of a note
                // the server restored, and a draft of the version that another
                // device just replaced, both land here.
                await dropSettledDrafts(
                  accountId,
                  workspaceId,
                  file.fileId,
                  heads,
                );
              } else {
                await tables.acceptedFiles.put({
                  ...current,
                  acceptedHeadRevisionId: file.revisionId,
                  acceptedHeadDigest: file.digest,
                  updatedAt: nowIso(),
                });
              }
            }
            await tables.cursors.put({
              serverOrigin,
              accountId,
              workspaceId,
              cursor: nextCursor,
              updatedAt: nowIso(),
            });
          },
        ),
      );
      for (const change of changes) {
        const fileId = change.file?.fileId ?? change.purgedFileId;
        publish({
          accountId,
          workspaceId,
          fileId,
          kind:
            change.purgedFileId !== null
              ? 'purge'
              : fileId === null
                ? 'cursor'
                : 'file',
        });
      }
    },

    async forgetPurgedFiles(
      accountId: string,
      workspaceId: string,
      fileIds: readonly string[],
    ): Promise<void> {
      if (fileIds.length === 0) return;
      await guard('forgetting purged files', () =>
        db.transaction(
          'rw',
          [
            tables.acceptedFiles,
            tables.drafts,
            tables.checkpoints,
            tables.queue,
            tables.recovery,
          ],
          async () => {
            for (const fileId of fileIds)
              await forgetFile(accountId, workspaceId, fileId);
          },
        ),
      );
      for (const fileId of fileIds)
        publish({ accountId, workspaceId, fileId, kind: 'purge' });
    },
  };
}
