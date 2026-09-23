/**
 * The placement area of the local store (record 0088).
 *
 * The upgrade from release 0.4 moves each queued save that holds text, and
 * marks each draft, because text becomes work only against the document that
 * the server holds. This area places that work when the document is here.
 *
 * Placement joins three texts with `recoverLegacyText` of
 * `@notesapp/note-document`: the text that the work started from, the text of
 * the work, and the text that the document holds now. The joined text becomes
 * work on the document, so an edit that another device made meanwhile stays.
 * A moved save keeps its identity, its revisions and its order, and returns
 * to the queue. Work that the three texts cannot place goes to the recovery
 * area in the same transaction that removes it, so nothing is lost and a
 * retry makes no copy (record 0084).
 */
import type { DocumentSave, RevisionInput } from '@notesapp/core';
import { readDocumentText, recoverLegacyText } from '@notesapp/note-document';
import type {
  LegacyReceipt,
  LegacySave,
  LocalChange,
  LocalStore,
} from '@notesapp/sync';
import {
  accountRange,
  guard,
  partitionRange,
  type CheckpointRow,
  type LegacySaveRow,
} from '../database.ts';
import {
  validateLegacyBase,
  validateLegacyDraft,
  validateLegacySave,
} from '../legacy-records.ts';
import {
  validateAcceptedFile,
  validateCheckpoint,
  validateContent,
  validateDraft,
  validateRecovery,
} from '../migrations.ts';
import {
  deletionSave,
  foldTextIntoDocument,
  readDocumentRow,
} from './documents.ts';
import { recordRecoveryReview } from './reviews.ts';
import {
  expectedHeadOfParent,
  forgetMutationWork,
  type LocalStoreContext,
} from './shared.ts';

type LegacySlice = Pick<
  LocalStore,
  'legacySaves' | 'settleLegacySave' | 'placeLegacyWork'
>;

/**
 * The code of kept work that placement could not join.
 *
 * The Needs attention list reads it as one sentence, like a refusal code of
 * the server.
 */
export const unplacedWorkCode = 'unplaced_work';

/**
 * The joined text of one piece of earlier work, or `null`.
 *
 * A base that this device no longer knows says nothing about where the work
 * belongs, so only work that already matches the document is joined then.
 */
function joinedText(
  base: string | null,
  local: string,
  accepted: string,
): string | null {
  if (base === null) return local === accepted ? local : null;
  const outcome = recoverLegacyText({ base, local, accepted });
  return outcome.kind === 'merged' ? outcome.text : null;
}

/** The record that last kept a text of one note in this placement run. */
type KeptText = {
  readonly revisionId: string | null;
  readonly recoveryId: string;
};

/** What placement decided for one moved save. */
type SavePlan =
  | { readonly kind: 'wait' }
  | { readonly kind: 'unplaced' }
  | {
      readonly kind: 'placed';
      /** The joined text of each revision, or `null` for no text. */
      readonly texts: readonly (string | null)[];
      /** Whether the server holds each note, by file. */
      readonly onServer: ReadonlyMap<string, boolean>;
    };

export function createLegacySlice(ctx: LocalStoreContext): LegacySlice {
  const { serverOrigin, db, tables, nowIso, newId, publish } = ctx;

  /** The moved saves of one partition, in their order. */
  const savesOf = async (
    accountId: string,
    workspaceId: string,
  ): Promise<LegacySaveRow[]> => {
    const range = partitionRange(serverOrigin, accountId, workspaceId);
    const rows: unknown[] = await tables.legacySaves
      .where('[serverOrigin+accountId+workspaceId+sequence]')
      .between(range.lower, range.upper, true, true)
      .toArray();
    return rows.map((row: unknown) => validateLegacySave(row));
  };

  /**
   * The text of the revision that a piece of work starts from, or `null`.
   *
   * A local checkpoint holds its own text, and the upgrade kept the text of
   * each server head that earlier work started from. A note that no revision
   * precedes starts from no text.
   */
  const baseTextOf = async (
    accountId: string,
    workspaceId: string,
    revisionId: string | null,
  ): Promise<string | null> => {
    if (revisionId === null) return '';
    const stored: unknown = await tables.checkpoints.get([
      serverOrigin,
      accountId,
      workspaceId,
      revisionId,
    ]);
    if (stored !== undefined) {
      const checkpoint = validateCheckpoint(stored);
      const content: unknown = await tables.contents.get([
        serverOrigin,
        accountId,
        workspaceId,
        checkpoint.digest,
      ]);
      return content === undefined ? null : validateContent(content).text;
    }
    const kept: unknown = await tables.legacyBases.get([
      serverOrigin,
      accountId,
      workspaceId,
      revisionId,
    ]);
    return kept === undefined ? null : validateLegacyBase(kept).text;
  };

  /** Whether the server holds one note, as the mirror of this device says. */
  const heldByServer = async (
    accountId: string,
    workspaceId: string,
    fileId: string,
  ): Promise<boolean> => {
    const stored: unknown = await tables.acceptedFiles.get([
      serverOrigin,
      accountId,
      workspaceId,
      fileId,
    ]);
    return (
      stored !== undefined &&
      validateAcceptedFile(stored).acceptedHeadRevisionId !== null
    );
  };

  /**
   * Keeps one text in the recovery area.
   *
   * A text that follows the text last kept for the same note, in the same
   * chain of saves, replaces it in the same record, because it holds that
   * earlier work too. A text of another working copy gets its own record, so
   * no kept text is lost. The note offers Review of the kept text, so one
   * action reaches it (record 0087).
   */
  const keep = async (
    kept: Map<string, KeptText>,
    changes: LocalChange[],
    accountId: string,
    workspaceId: string,
    entry: {
      readonly fileId: string;
      readonly path: string;
      readonly text: string;
      readonly code: string;
      readonly mutationId: string | null;
      /** The revision this text is, or `null` for a draft. */
      readonly revisionId: string | null;
      /** The revision this text follows, or `null`. */
      readonly follows: string | null;
    },
  ): Promise<void> => {
    const earlier = kept.get(entry.fileId);
    const recoveryId =
      earlier !== undefined &&
      earlier.revisionId !== null &&
      earlier.revisionId === entry.follows
        ? earlier.recoveryId
        : newId();
    kept.set(entry.fileId, { revisionId: entry.revisionId, recoveryId });
    await tables.recovery.put({
      serverOrigin,
      accountId,
      workspaceId,
      recoveryId,
      fileId: entry.fileId,
      path: entry.path,
      text: entry.text,
      reason: 'save_refused',
      code: entry.code,
      mutationId: entry.mutationId,
      createdAt: nowIso(),
    });
    await recordRecoveryReview(
      ctx,
      accountId,
      workspaceId,
      entry.fileId,
      recoveryId,
    );
    changes.push({
      accountId,
      workspaceId,
      fileId: entry.fileId,
      kind: 'review',
    });
  };

  /** Removes one moved save and the local work that only it held. */
  const removeSave = async (
    save: LegacySaveRow,
    changes: LocalChange[],
  ): Promise<void> => {
    await tables.legacySaves.delete([
      serverOrigin,
      save.accountId,
      save.workspaceId,
      save.mutationId,
    ]);
    changes.push(
      ...(await forgetMutationWork(
        ctx,
        save.accountId,
        save.workspaceId,
        save.mutationId,
        save.revisions,
      )),
    );
  };

  /** Keeps every text that one moved save changed, then removes the save. */
  const keepSave = async (
    kept: Map<string, KeptText>,
    save: LegacySaveRow,
    code: string,
    changes: LocalChange[],
  ): Promise<void> => {
    for (const revision of save.revisions) {
      if (revision.content.kind !== 'markdown' || revision.deleted) continue;
      await keep(kept, changes, save.accountId, save.workspaceId, {
        fileId: revision.fileId,
        path: revision.path,
        text: revision.content.text,
        code,
        mutationId: save.mutationId,
        revisionId: revision.id,
        follows: revision.parents[0] ?? null,
      });
    }
    await removeSave(save, changes);
    changes.push({
      accountId: save.accountId,
      workspaceId: save.workspaceId,
      fileId: save.revisions[0]?.fileId ?? null,
      kind: 'conflict',
    });
  };

  /**
   * Decides where the texts of one moved save belong, without a write.
   *
   * Each revision joins its base, its text, and the text of the document as
   * the earlier revisions of the same save leave it. A note that the server
   * holds and whose document is not here waits for the snapshot, and after
   * the snapshot it cannot be placed at all.
   */
  const planSave = async (
    save: LegacySaveRow,
    snapshotRead: boolean,
    unplaced: ReadonlySet<string>,
  ): Promise<SavePlan> => {
    const { accountId, workspaceId } = save;
    const documentText = new Map<string, string>();
    const onServer = new Map<string, boolean>();
    const texts: (string | null)[] = [];
    for (const revision of save.revisions) {
      if (revision.content.kind !== 'markdown') {
        texts.push(null);
        continue;
      }
      const { fileId } = revision;
      if (unplaced.has(fileId)) return { kind: 'unplaced' };
      if (!documentText.has(fileId)) {
        const row = await readDocumentRow(tables, {
          serverOrigin,
          accountId,
          workspaceId,
          fileId,
        });
        const held =
          (await heldByServer(accountId, workspaceId, fileId)) ||
          (save.expectedHeads[fileId] ?? null) !== null;
        if (row === null && held)
          return snapshotRead ? { kind: 'unplaced' } : { kind: 'wait' };
        documentText.set(
          fileId,
          row === null ? '' : readDocumentText(row.bytes),
        );
        onServer.set(fileId, held);
      }
      if (revision.deleted) {
        // A deletion states what the device had seen. The document holds work
        // that release 0.4 never saw when its text differs from the text that
        // the deletion was written over, and a deletion must not hide such
        // work (record 0083). The note then stays.
        const seen = await baseTextOf(
          accountId,
          workspaceId,
          revision.parents[0] ?? null,
        );
        if (seen === null || seen !== documentText.get(fileId))
          return { kind: 'unplaced' };
        texts.push(null);
        continue;
      }
      const joined = joinedText(
        await baseTextOf(accountId, workspaceId, revision.parents[0] ?? null),
        revision.content.text,
        documentText.get(fileId) ?? '',
      );
      if (joined === null) return { kind: 'unplaced' };
      documentText.set(fileId, joined);
      texts.push(joined);
    }
    return { kind: 'placed', texts, onServer };
  };

  /**
   * Writes the placed revisions of one moved save and queues it again.
   *
   * The save keeps its identity, its preconditions, and its order, so a later
   * save of the same note still follows it.
   */
  const queueSave = async (
    save: LegacySaveRow,
    plan: Extract<SavePlan, { kind: 'placed' }>,
  ): Promise<void> => {
    const { accountId, workspaceId } = save;
    const revisions: RevisionInput[] = [];
    for (const [index, revision] of save.revisions.entries()) {
      const moved = { ...revision, parents: [...revision.parents] };
      if (revision.content.kind === 'attachment') {
        revisions.push({ ...moved, content: revision.content });
        continue;
      }
      const key = {
        serverOrigin,
        accountId,
        workspaceId,
        fileId: revision.fileId,
      };
      const noteExists = plan.onServer.get(revision.fileId) ?? true;
      let document: DocumentSave;
      if (revision.deleted) {
        document = await deletionSave(tables, key, noteExists);
      } else {
        const folded = await foldTextIntoDocument(
          tables,
          key,
          plan.texts[index] ?? '',
          noteExists,
        );
        await tables.documents.put(folded.row);
        document = folded.save;
      }
      revisions.push({ ...moved, content: { kind: 'markdown', document } });
    }
    // Each precondition names the accepted revision that the parent chain of
    // the note descends from, as a new save does (record 0073). A moved save
    // whose parent the server accepted in the meantime names that parent.
    const expectedHeads: Record<string, string | null> = {};
    for (const revision of save.revisions)
      if (!(revision.fileId in expectedHeads))
        expectedHeads[revision.fileId] = await expectedHeadOfParent(
          ctx,
          accountId,
          workspaceId,
          revision.parents[0] ?? null,
        );
    await tables.queue.put({
      serverOrigin,
      accountId,
      workspaceId,
      mutationId: save.mutationId,
      sequence: save.sequence,
      input: {
        workspaceId,
        mutationId: save.mutationId,
        deviceId: save.deviceId,
        expectedHeads,
        revisions,
      },
      state: 'pending',
      digest: null,
      errorCode: null,
      createdAt: save.createdAt,
    });
    await tables.legacySaves.delete([
      serverOrigin,
      accountId,
      workspaceId,
      save.mutationId,
    ]);
  };

  /**
   * Places the moved saves of one partition, in their order.
   *
   * A save that release 0.4 may have sent waits for its receipt, and every
   * later save of the same note waits behind it. The answer counts the saves
   * that wait.
   */
  const placeSaves = async (
    accountId: string,
    workspaceId: string,
    state: {
      readonly snapshotRead: boolean;
      readonly blocked: Set<string>;
      readonly unplaced: Set<string>;
      readonly kept: Map<string, KeptText>;
      readonly changes: LocalChange[];
    },
  ): Promise<number> => {
    let waiting = 0;
    const range = partitionRange(serverOrigin, accountId, workspaceId);
    for (const save of await savesOf(accountId, workspaceId)) {
      const files = [
        ...new Set(save.revisions.map((revision) => revision.fileId)),
      ];
      // The server refused this save for good, and release 0.4 kept its text
      // in the recovery area when it did. It wrote the two in separate
      // transactions, so a copy that is not there is kept now.
      if (save.state === 'conflict') {
        const copies: unknown[] = await tables.recovery
          .where('[serverOrigin+accountId+workspaceId+recoveryId]')
          .between(range.lower, range.upper, true, true)
          .toArray();
        const copied = copies.some(
          (row: unknown) =>
            validateRecovery(row).mutationId === save.mutationId,
        );
        if (copied) await removeSave(save, state.changes);
        else
          await keepSave(
            state.kept,
            save,
            save.errorCode ?? unplacedWorkCode,
            state.changes,
          );
        continue;
      }
      const plan =
        save.state === 'sending' ||
        files.some((file) => state.blocked.has(file))
          ? ({ kind: 'wait' } as const)
          : await planSave(save, state.snapshotRead, state.unplaced);
      if (plan.kind === 'wait') {
        for (const file of files) state.blocked.add(file);
        waiting += 1;
        continue;
      }
      if (plan.kind === 'unplaced') {
        for (const file of files) state.unplaced.add(file);
        await keepSave(state.kept, save, unplacedWorkCode, state.changes);
        continue;
      }
      await queueSave(save, plan);
      state.changes.push({
        accountId,
        workspaceId,
        fileId: files[0] ?? null,
        kind: 'queue',
      });
    }
    return waiting;
  };

  /**
   * Places the marked drafts of one partition.
   *
   * A draft takes the text that joins it with the document, and the document
   * takes that text as unsent work of this device, so the two agree when the
   * editor opens. A draft that cannot be joined goes to the recovery area.
   * The answer counts the drafts that wait.
   */
  const placeDrafts = async (
    accountId: string,
    workspaceId: string,
    state: {
      readonly snapshotRead: boolean;
      readonly blocked: ReadonlySet<string>;
      readonly unplaced: ReadonlySet<string>;
      readonly kept: Map<string, KeptText>;
      readonly changes: LocalChange[];
    },
  ): Promise<number> => {
    let waiting = 0;
    const range = partitionRange(serverOrigin, accountId, workspaceId);
    const marks: unknown[] = await tables.legacyDrafts
      .where('[serverOrigin+accountId+workspaceId+workingCopyId]')
      .between(range.lower, range.upper, true, true)
      .toArray();
    for (const value of marks) {
      const mark = validateLegacyDraft(value);
      const key: [string, string, string, string] = [
        serverOrigin,
        accountId,
        workspaceId,
        mark.workingCopyId,
      ];
      const stored: unknown = await tables.drafts.get(key);
      const draft = stored === undefined ? null : validateDraft(stored);
      if (draft !== null && state.blocked.has(draft.fileId)) {
        waiting += 1;
        continue;
      }
      if (draft === null || draft.deleted) {
        await tables.legacyDrafts.delete(key);
        continue;
      }
      const documentKey = {
        serverOrigin,
        accountId,
        workspaceId,
        fileId: draft.fileId,
      };
      const row = await readDocumentRow(tables, documentKey);
      const held =
        (await heldByServer(accountId, workspaceId, draft.fileId)) ||
        draft.baseRevisionId !== null;
      if (row === null && held && !state.snapshotRead) {
        waiting += 1;
        continue;
      }
      // A note that no server holds starts its document with its first save.
      if (row === null && !held) {
        await tables.legacyDrafts.delete(key);
        continue;
      }
      const accepted = row === null ? null : readDocumentText(row.bytes);
      const joined =
        accepted === null
          ? null
          : state.unplaced.has(draft.fileId)
            ? joinedText(null, draft.text, accepted)
            : joinedText(
                await baseTextOf(
                  accountId,
                  workspaceId,
                  draft.lastCheckpointId ?? draft.baseRevisionId,
                ),
                draft.text,
                accepted,
              );
      if (joined === null) {
        await keep(state.kept, state.changes, accountId, workspaceId, {
          fileId: draft.fileId,
          path: draft.path,
          text: draft.text,
          code: unplacedWorkCode,
          mutationId: null,
          revisionId: null,
          follows: draft.lastCheckpointId ?? draft.baseRevisionId,
        });
        await tables.drafts.delete(key);
        state.changes.push({
          accountId,
          workspaceId,
          fileId: draft.fileId,
          kind: 'conflict',
        });
      } else {
        if (joined !== accepted) {
          const folded = await foldTextIntoDocument(
            tables,
            documentKey,
            joined,
            held,
          );
          await tables.documents.put(folded.row);
        }
        if (joined !== draft.text)
          await tables.drafts.put({ ...draft, text: joined });
      }
      await tables.legacyDrafts.delete(key);
      state.changes.push({
        accountId,
        workspaceId,
        fileId: draft.fileId,
        kind: 'file',
      });
    }
    return waiting;
  };

  return {
    legacySaves(
      accountId: string,
      workspaceId: string,
    ): Promise<readonly LegacySave[]> {
      return guard('reading the saves of an earlier version', () =>
        db.transaction('r', tables.legacySaves, async () =>
          (await savesOf(accountId, workspaceId)).map((save) => ({
            mutationId: save.mutationId,
            state: save.state,
            digest: save.digest,
          })),
        ),
      );
    },

    async settleLegacySave(
      accountId: string,
      mutationId: string,
      receipt: LegacyReceipt,
    ): Promise<void> {
      const changes: LocalChange[] = [];
      await guard('settling a save of an earlier version', () =>
        db.transaction(
          'rw',
          [
            tables.legacySaves,
            tables.checkpoints,
            tables.acceptedFiles,
            tables.drafts,
            tables.receipts,
            tables.recovery,
            tables.reviews,
          ],
          async () => {
            const stored: unknown = await tables.legacySaves
              .where('[serverOrigin+accountId+mutationId]')
              .equals([serverOrigin, accountId, mutationId])
              .first();
            if (stored === undefined) return;
            const save = validateLegacySave(stored);
            if (receipt.kind === 'absent') {
              await tables.legacySaves.put({
                ...save,
                state: 'pending',
                digest: null,
              });
              return;
            }
            if (receipt.kind === 'other-request') {
              await keepSave(new Map(), save, 'mutation_reused', changes);
              return;
            }
            // The server accepted this save before release 0.4 read the
            // answer. It is never sent again: its checkpoints become
            // accepted, and the snapshot after the upgrade brings the heads.
            // Release 0.4 sent a run of unsent saves as one request under the
            // first identity, so every moved save whose revisions the answer
            // names was accepted with it and settles too.
            const accepted = new Set(receipt.result.revisionIds);
            const covered = (await savesOf(accountId, save.workspaceId)).filter(
              (candidate) =>
                candidate.mutationId === mutationId ||
                (candidate.revisions.length > 0 &&
                  candidate.revisions.every((revision) =>
                    accepted.has(revision.id),
                  )),
            );
            const newest = new Map<string, CheckpointRow>();
            for (const moved of covered) {
              const rows: unknown[] = await tables.checkpoints
                .where('[serverOrigin+accountId+workspaceId+mutationId]')
                .equals([
                  serverOrigin,
                  accountId,
                  save.workspaceId,
                  moved.mutationId,
                ])
                .toArray();
              for (const row of rows) {
                const checkpoint = validateCheckpoint(row);
                if (!accepted.has(checkpoint.revisionId)) continue;
                await tables.checkpoints.put({ ...checkpoint, accepted: true });
                const seen = newest.get(checkpoint.fileId);
                if (seen === undefined || checkpoint.sequence > seen.sequence)
                  newest.set(checkpoint.fileId, checkpoint);
              }
              await tables.legacySaves.delete([
                serverOrigin,
                accountId,
                save.workspaceId,
                moved.mutationId,
              ]);
            }
            for (const [fileId, checkpoint] of newest) {
              const file: unknown = await tables.acceptedFiles.get([
                serverOrigin,
                accountId,
                save.workspaceId,
                fileId,
              ]);
              if (file !== undefined)
                await tables.acceptedFiles.put({
                  ...validateAcceptedFile(file),
                  acceptedHeadRevisionId: checkpoint.revisionId,
                  acceptedHeadDigest: checkpoint.digest,
                  updatedAt: nowIso(),
                });
              changes.push({
                accountId,
                workspaceId: save.workspaceId,
                fileId,
                kind: 'file',
              });
            }
            await tables.receipts.put({
              serverOrigin,
              accountId,
              workspaceId: save.workspaceId,
              mutationId,
              revisionIds: [...receipt.result.revisionIds],
              cursor: receipt.result.cursor,
              acknowledgedAt: nowIso(),
            });
          },
        ),
      );
      for (const change of changes) publish(change);
    },

    async placeLegacyWork(
      accountId: string,
      workspaceId: string,
    ): Promise<{ readonly waiting: number }> {
      // The engine asks on every cycle, and a store that never held release
      // 0.4 has nothing to place, so a read decides before any write opens.
      const range = partitionRange(serverOrigin, accountId, workspaceId);
      const held = await guard('reading the work of an earlier version', () =>
        db.transaction(
          'r',
          [tables.legacySaves, tables.legacyDrafts],
          async () =>
            (await tables.legacySaves
              .where('[serverOrigin+accountId+workspaceId+mutationId]')
              .between(range.lower, range.upper, true, true)
              .count()) +
            (await tables.legacyDrafts
              .where('[serverOrigin+accountId+workspaceId+workingCopyId]')
              .between(range.lower, range.upper, true, true)
              .count()),
        ),
      );
      if (held === 0) return { waiting: 0 };
      const changes: LocalChange[] = [];
      const waiting = await guard(
        'placing the work of an earlier version',
        () =>
          db.transaction(
            'rw',
            [
              tables.legacySaves,
              tables.legacyBases,
              tables.legacyDrafts,
              tables.queue,
              tables.checkpoints,
              tables.contents,
              tables.acceptedFiles,
              tables.drafts,
              tables.documents,
              tables.recovery,
              tables.reviews,
              tables.cursors,
            ],
            async (): Promise<number> => {
              // The upgrade removed every cursor, so a cursor here means that
              // a snapshot ran since then and brought every document it has.
              const cursor: unknown = await tables.cursors.get([
                serverOrigin,
                accountId,
                workspaceId,
              ]);
              const state = {
                snapshotRead: cursor !== undefined,
                blocked: new Set<string>(),
                unplaced: new Set<string>(),
                kept: new Map<string, KeptText>(),
                changes,
              };
              const saves = await placeSaves(accountId, workspaceId, state);
              const drafts = await placeDrafts(accountId, workspaceId, state);
              if (saves + drafts === 0) {
                await tables.legacyBases
                  .where('[serverOrigin+accountId+workspaceId+revisionId]')
                  .between(range.lower, range.upper, true, true)
                  .delete();
              }
              return saves + drafts;
            },
          ),
      );
      for (const change of changes) publish(change);
      return { waiting };
    },
  };
}

/** Every workspace of one account that still holds work to place. */
export async function legacyWorkspaces(
  ctx: LocalStoreContext,
  accountId: string,
): Promise<readonly string[]> {
  const range = accountRange(ctx.serverOrigin, accountId);
  const found = new Set<string>();
  const saves: unknown[] = await ctx.tables.legacySaves
    .where('[serverOrigin+accountId+mutationId]')
    .between(range.lower, range.upper, true, true)
    .toArray();
  for (const row of saves) found.add(validateLegacySave(row).workspaceId);
  const drafts: unknown[] = await ctx.tables.legacyDrafts
    .where('[serverOrigin+accountId+workspaceId+workingCopyId]')
    .between(range.lower, range.upper, true, true)
    .toArray();
  for (const row of drafts) found.add(validateLegacyDraft(row).workspaceId);
  return [...found];
}
