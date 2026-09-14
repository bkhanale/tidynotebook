/**
 * The whole-file actions of the local store: move and trash.
 *
 * The path and the deletion state of a note live on every working copy of that
 * note: the accepted row, each checkpoint, and each draft carry both. An action
 * that wrote only one of them would be undone by the next save of any other
 * working copy, so each action is one operation of the port rather than a draft
 * that a screen composes. See decision record 0032.
 *
 * One transaction covers every named file. Each file gets one checkpoint that
 * states its new path or its tombstone, and every stored draft of that file is
 * brought to the same state, keeping its text and its sequence. Either the
 * whole set is written or nothing is.
 */
import { contentDigest } from '@notesapp/core';
import type { ChangesetInput } from '@notesapp/core';
import {
  LocalStorageError,
  type FileMove,
  type LocalStore,
  type QueueEntry,
} from '@notesapp/sync';
import { guard, type CheckpointRow, type FileRow } from '../database.ts';
import { validateAcceptedFile, validateCheckpoint } from '../migrations.ts';
import {
  byteLength,
  bodyOfDigest,
  draftLeads,
  draftsOfFile,
  nextCheckpointSequence,
  nextQueueSequence,
  type LocalStoreContext,
} from './shared.ts';

type FileActionsSlice = Pick<LocalStore, 'moveFiles' | 'trashFiles'>;

/** What one file reads as on this device right now. */
type FileState = {
  readonly fileId: string;
  readonly path: string;
  /**
   * The text the note reads with, or `null` when this device does not hold
   * the body. A tombstone carries none, so a deletion needs no body and a
   * move does.
   */
  readonly text: string | null;
  readonly deleted: boolean;
  /** The tip this device holds, which the next revision names as its parent. */
  readonly parentId: string | null;
  /** The accepted head this device knows, which the submission names. */
  readonly expectedHead: string | null;
  /** The working copy this state came from. */
  readonly workingCopyId: string;
};

/** One checkpoint that a whole-file action writes. */
type PlannedAction = {
  readonly state: FileState;
  readonly toPath: string;
  readonly deleted: boolean;
  /** The text of the new revision. A tombstone carries none. */
  readonly text: string;
  /** The digest of that text, computed outside the transaction. */
  readonly digest: string;
  readonly revisionId: string;
  readonly mutationId: string;
};

export function createFileActionsSlice(
  ctx: LocalStoreContext,
): FileActionsSlice {
  const { serverOrigin, deviceId, db, tables, nowIso, newId, publish } = ctx;

  /**
   * The state that one file acts from.
   *
   * The newest working copy that still describes the file wins, so an action
   * never reverts text the person typed and has not turned into a version yet.
   * A file with no such working copy acts from its local head, and a draft left
   * over from an older head is not promoted to a version by an action: it keeps
   * its text and follows the action with every other copy.
   *
   * Returns `null` when this device holds no file to act on at all. A file
   * whose body is not cached still has a state: `text` is `null`, a deletion
   * proceeds because a tombstone carries no text, and a move refuses because
   * it would have to guess the content of the version it writes.
   */
  const readState = async (
    accountId: string,
    workspaceId: string,
    fileId: string,
  ): Promise<FileState | null> => {
    const stored: unknown = await tables.acceptedFiles.get([
      serverOrigin,
      accountId,
      workspaceId,
      fileId,
    ]);
    const file: FileRow | null =
      stored === undefined ? null : validateAcceptedFile(stored);
    // An attachment has no editor and no name a person chose, so no whole-file
    // action of this port applies to it.
    if (file !== null && file.kind !== 'note') return null;
    const head = file?.localHeadRevisionId ?? file?.acceptedHeadRevisionId;
    const drafts = await draftsOfFile(ctx, accountId, workspaceId, fileId);
    const leading = drafts.find((draft) => draftLeads(file, draft)) ?? null;

    if (leading !== null)
      return {
        fileId,
        path: leading.path,
        text: leading.deleted ? '' : leading.text,
        deleted: leading.deleted,
        parentId: leading.lastCheckpointId ?? leading.baseRevisionId,
        expectedHead: file?.acceptedHeadRevisionId ?? null,
        workingCopyId: leading.workingCopyId,
      };
    if (file === null) return null;
    if (file.deleted)
      return {
        fileId,
        path: file.path,
        text: '',
        deleted: true,
        parentId: head ?? null,
        expectedHead: file.acceptedHeadRevisionId,
        workingCopyId: newId(),
      };

    const local = file.localHeadRevisionId;
    if (local !== null && local !== file.acceptedHeadRevisionId) {
      const row: unknown = await tables.checkpoints.get([
        serverOrigin,
        accountId,
        workspaceId,
        local,
      ]);
      if (row === undefined) return null;
      const checkpoint = validateCheckpoint(row);
      const body = checkpoint.deleted
        ? ''
        : await bodyOfDigest(ctx, accountId, workspaceId, checkpoint.digest);
      return {
        fileId,
        path: checkpoint.path,
        text: body,
        deleted: checkpoint.deleted,
        parentId: checkpoint.revisionId,
        expectedHead: file.acceptedHeadRevisionId,
        workingCopyId: checkpoint.workingCopyId,
      };
    }
    // A file the server never accepted and this device holds no working copy
    // of is not a file to act on: there is no tip to name as a parent.
    if (file.acceptedHeadRevisionId === null) return null;
    const body =
      file.acceptedHeadDigest === null
        ? null
        : await bodyOfDigest(
            ctx,
            accountId,
            workspaceId,
            file.acceptedHeadDigest,
          );
    return {
      fileId,
      path: file.path,
      text: body,
      deleted: false,
      parentId: file.acceptedHeadRevisionId,
      expectedHead: file.acceptedHeadRevisionId,
      workingCopyId: newId(),
    };
  };

  /** Reads the state of each named file in its own read transaction. */
  const readStates = async (
    accountId: string,
    workspaceId: string,
    fileIds: readonly string[],
  ): Promise<readonly FileState[]> => {
    const seen = new Set<string>();
    const states: FileState[] = [];
    for (const fileId of fileIds) {
      if (seen.has(fileId))
        throw new LocalStorageError(
          'aborted',
          'one action names the same file twice',
        );
      seen.add(fileId);
      const state = await guard('reading a file', () =>
        db.transaction(
          'r',
          [
            tables.acceptedFiles,
            tables.drafts,
            tables.checkpoints,
            tables.contents,
          ],
          () => readState(accountId, workspaceId, fileId),
        ),
      );
      if (state === null)
        throw new LocalStorageError(
          'stale',
          'a file of this action is not readable on this device',
        );
      states.push(state);
    }
    return states;
  };

  /**
   * Writes every planned checkpoint and brings every working copy with it.
   *
   * The states were read in their own transactions, so each file is checked
   * again here. A file whose accepted head moved is refused with the whole
   * set, because writing over newer work would lose it.
   */
  const commit = (
    accountId: string,
    workspaceId: string,
    planned: readonly PlannedAction[],
    label: string,
  ): Promise<readonly QueueEntry[]> => {
    const clientTime = nowIso();
    return guard(label, () =>
      db.transaction(
        'rw',
        [
          tables.drafts,
          tables.checkpoints,
          tables.contents,
          tables.acceptedFiles,
          tables.queue,
        ],
        async (): Promise<readonly QueueEntry[]> => {
          const entries: QueueEntry[] = [];
          for (const action of planned) {
            const { state, revisionId, mutationId } = action;
            const stored: unknown = await tables.acceptedFiles.get([
              serverOrigin,
              accountId,
              workspaceId,
              state.fileId,
            ]);
            const file: FileRow | null =
              stored === undefined ? null : validateAcceptedFile(stored);
            if ((file?.acceptedHeadRevisionId ?? null) !== state.expectedHead)
              throw new LocalStorageError(
                'stale',
                'a file of this action changed while it was read',
              );

            await tables.contents.put({
              serverOrigin,
              accountId,
              workspaceId,
              digest: action.digest,
              text: action.text,
              bytes: null,
              size: byteLength(action.text),
            });
            const checkpoint: CheckpointRow = {
              serverOrigin,
              accountId,
              workspaceId,
              revisionId,
              fileId: state.fileId,
              workingCopyId: state.workingCopyId,
              parents: state.parentId === null ? [] : [state.parentId],
              path: action.toPath,
              deleted: action.deleted,
              digest: action.digest,
              // A move and a deletion are not named versions. Each history row
              // reads as the automatic version that it is.
              message: null,
              clientTime,
              mutationId,
              accepted: false,
              sequence: await nextCheckpointSequence(
                ctx,
                accountId,
                workspaceId,
              ),
            };
            await tables.checkpoints.add(checkpoint);
            await tables.acceptedFiles.put({
              serverOrigin,
              accountId,
              workspaceId,
              fileId: state.fileId,
              kind: file?.kind ?? 'note',
              path: action.toPath,
              deleted: action.deleted,
              acceptedHeadRevisionId: file?.acceptedHeadRevisionId ?? null,
              acceptedHeadDigest: file?.acceptedHeadDigest ?? null,
              localHeadRevisionId: revisionId,
              updatedAt: clientTime,
            });

            // Every working copy of this file follows the action. Without this
            // an open editor would keep the old path, or keep the note live,
            // and write the action back on its next save.
            for (const draft of await draftsOfFile(
              ctx,
              accountId,
              workspaceId,
              state.fileId,
            )) {
              if (
                draft.path === action.toPath &&
                draft.deleted === action.deleted
              )
                continue;
              await tables.drafts.put({
                ...draft,
                path: action.toPath,
                deleted: action.deleted,
                // The text, the sequence, and the save time stay. An action is
                // not a save by this working copy, so a draft the person is
                // still typing into is not replaced, its next save is not
                // refused as older than the stored one, and the order of the
                // working copies does not change.
                lastCheckpointId:
                  draft.workingCopyId === state.workingCopyId
                    ? revisionId
                    : draft.lastCheckpointId,
              });
            }

            const input: ChangesetInput = {
              workspaceId,
              mutationId,
              deviceId,
              expectedHeads: {
                [state.fileId]: file?.acceptedHeadRevisionId ?? null,
              },
              revisions: [
                {
                  id: revisionId,
                  fileId: state.fileId,
                  parents: state.parentId === null ? [] : [state.parentId],
                  path: action.toPath,
                  deleted: action.deleted,
                  content: {
                    kind: 'markdown',
                    digest: action.digest,
                    text: action.text,
                  },
                  clientTime,
                  message: null,
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
            entries.push({
              accountId,
              input,
              state: 'pending',
              digest: null,
              errorCode: null,
            });
          }
          return entries;
        },
      ),
    );
  };

  /** Announces one written action to every reader of this device. */
  const announce = (
    accountId: string,
    workspaceId: string,
    planned: readonly PlannedAction[],
  ): void => {
    for (const action of planned)
      for (const kind of ['file', 'draft', 'queue'] as const)
        publish({ accountId, workspaceId, fileId: action.state.fileId, kind });
  };

  return {
    async moveFiles(
      accountId: string,
      workspaceId: string,
      moves: readonly FileMove[],
    ): Promise<readonly QueueEntry[]> {
      if (moves.length === 0) return [];
      const states = await readStates(
        accountId,
        workspaceId,
        moves.map((move) => move.fileId),
      );
      const planned: PlannedAction[] = [];
      for (const [index, state] of states.entries()) {
        const move = moves[index];
        if (move === undefined) continue;
        // A note on its way to Trash has no place to move to. Stating it live
        // at a new path would undo the deletion.
        if (state.deleted)
          throw new LocalStorageError(
            'stale',
            'a file of this move is in Trash',
          );
        if (state.path === move.toPath) continue;
        // A move writes a version that keeps the text, so this device must
        // hold the body. Without it the move would have to guess the content.
        const text = state.text;
        if (text === null)
          throw new LocalStorageError(
            'stale',
            'the body of a file of this move is not on this device',
          );
        // The digest is computed before the transaction. WebCrypto is not a
        // database promise, so a digest awaited inside a Dexie transaction
        // would leave the transaction zone and the transaction would be gone.
        const digest = await guard('moving a note', () => contentDigest(text));
        planned.push({
          state,
          toPath: move.toPath,
          deleted: false,
          text,
          digest,
          revisionId: newId(),
          mutationId: newId(),
        });
      }
      if (planned.length === 0) return [];
      const queued = await commit(
        accountId,
        workspaceId,
        planned,
        'moving a note',
      );
      announce(accountId, workspaceId, planned);
      return queued;
    },

    async trashFiles(
      accountId: string,
      workspaceId: string,
      fileIds: readonly string[],
    ): Promise<readonly QueueEntry[]> {
      if (fileIds.length === 0) return [];
      const states = await readStates(accountId, workspaceId, fileIds);
      // A tombstone carries no text. The revision before it still holds the
      // content of the note, and a deletion that submitted Markdown would add
      // content while it claims to remove a file, which the server refuses.
      const digest = await guard('deleting a note', () => contentDigest(''));
      const planned: PlannedAction[] = states
        .filter((state) => !state.deleted)
        .map((state) => ({
          state,
          toPath: state.path,
          deleted: true,
          text: '',
          digest,
          revisionId: newId(),
          mutationId: newId(),
        }));
      if (planned.length === 0) return [];
      const queued = await commit(
        accountId,
        workspaceId,
        planned,
        'deleting a note',
      );
      announce(accountId, workspaceId, planned);
      return queued;
    },
  };
}
