/**
 * The snapshot area of the local store.
 *
 * It owns the offline snapshot lifecycle (stage, store, activate) and the
 * reads over the cached mirror of server state: the accepted files, the local
 * files with the draft overlay, the save state of one file, the search bodies,
 * and content presence. `applyRemoteChanges` folds the change feed into the
 * mirror without overwriting unsubmitted local work.
 */
import {
  LocalStorageError,
  type LocalStore,
  type RemoteChange,
  type SnapshotRevision,
} from '@notesapp/sync';
import {
  guard,
  type DraftRow,
  type FileRow,
  type SnapshotItemRow,
} from '../database.ts';
import {
  validateAcceptedFile,
  validateContent,
  validateCursor,
  validateDraft,
  validateSnapshot,
  validateSnapshotItem,
} from '../migrations.ts';
import {
  bodyOfDigest,
  byteLength,
  draftsOfFile,
  matchesPartition,
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
   * Forgets the cached metadata and working copies of one permanently deleted
   * file.
   *
   * The listing of the server can only say which files exist, so a cache
   * entry that the server dropped stays until something removes it. A purge
   * marker in the ordered change feed is that signal. The working copy goes
   * with the metadata, because a draft carries the path and the deletion state
   * of the file and would otherwise keep the note in the file tree.
   *
   * The call runs inside the transaction of its caller, which must cover the
   * accepted files and the drafts.
   */
  const forgetFile = async (
    accountId: string,
    workspaceId: string,
    fileId: string,
  ): Promise<void> => {
    await tables.acceptedFiles.delete([
      serverOrigin,
      accountId,
      workspaceId,
      fileId,
    ]);
    for (const row of await tables.drafts.toArray()) {
      const parsed = validateDraft(row);
      if (
        matchesPartition(ctx, parsed, accountId, workspaceId) &&
        parsed.fileId === fileId
      )
        await tables.drafts.delete([
          parsed.serverOrigin,
          parsed.accountId,
          parsed.workspaceId,
          parsed.workingCopyId,
        ]);
    }
  };

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
              fileIds: [...byFile.keys()],
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
              if (file.text !== null) {
                await tables.contents.put({
                  serverOrigin,
                  accountId,
                  workspaceId,
                  digest: file.digest,
                  text: file.text,
                  bytes: null,
                  size: byteLength(file.text),
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
                  file.text ??
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
                // A live file that this device holds a tombstone draft for was
                // restored. That draft says nothing the file does not already
                // say, and it would shadow every later edit of the note, so it
                // goes with the deletion it recorded.
                if (!file.deleted) {
                  const stale = await draftsOfFile(
                    ctx,
                    accountId,
                    workspaceId,
                    file.fileId,
                  );
                  for (const draft of stale) {
                    if (!draft.deleted) continue;
                    await tables.drafts.delete([
                      serverOrigin,
                      accountId,
                      workspaceId,
                      draft.workingCopyId,
                    ]);
                  }
                }
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
          kind: fileId === null ? 'cursor' : 'file',
        });
      }
    },
  };
}
