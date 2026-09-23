/**
 * The Review area of the local store (record 0087).
 *
 * A Review waits on this device when a save of this device joined work it had
 * not seen, or when the upgrade kept earlier work aside because it could not
 * join the note. The event names the exact checkpoint or the exact kept text,
 * so a later draft or a later save can never become its base.
 *
 * The writers are not here. `acknowledge` records a merge in the transaction
 * that applies the answer, and placement records a recovery in the
 * transaction that keeps the text, so an event exists exactly when its cause
 * does. Removing kept text or forgetting a purged file removes its events in
 * the same transaction, through the helpers below.
 */
import type { LocalStore, ReviewCause, ReviewRecord } from '@notesapp/sync';
import { guard, type CheckpointRow, type ReviewRow } from '../database.ts';
import {
  validateCheckpoint,
  validateContent,
  validateRecovery,
  validateReview,
} from '../migrations.ts';
import type { LocalStoreContext } from './shared.ts';

type ReviewsSlice = Pick<LocalStore, 'listReviews' | 'clearReview'>;

/** The stored Reviews of one note. The caller opens the transaction. */
const reviewsOfFile = async (
  ctx: LocalStoreContext,
  accountId: string,
  workspaceId: string,
  fileId: string,
): Promise<ReviewRow[]> => {
  const rows: unknown[] = await ctx.tables.reviews
    .where('[serverOrigin+accountId+workspaceId+fileId]')
    .equals([ctx.serverOrigin, accountId, workspaceId, fileId])
    .toArray();
  return rows.map((row: unknown) => validateReview(row));
};

/**
 * Records that one accepted save of this device merged.
 *
 * `checkpoint` is the newest checkpoint of the acknowledged mutation for the
 * note, which is the text that the device sent. The answers of one commit
 * share its cursor, so a later mutation of the same commit moves the base of
 * that one event to its own checkpoint, and a batch makes one Review. A
 * merge of another commit is a new event. The caller opens the transaction
 * over the Review table and publishes the change.
 */
export const recordMergeReview = async (
  ctx: LocalStoreContext,
  accountId: string,
  workspaceId: string,
  checkpoint: CheckpointRow,
  cursor: string,
): Promise<void> => {
  const { serverOrigin, tables, newId, nowIso } = ctx;
  const sameCommit = (
    await reviewsOfFile(ctx, accountId, workspaceId, checkpoint.fileId)
  ).find((row) => row.cause === 'merge' && row.cursor === cursor);
  await tables.reviews.put({
    serverOrigin,
    accountId,
    workspaceId,
    reviewId: sameCommit?.reviewId ?? newId(),
    fileId: checkpoint.fileId,
    cause: 'merge',
    sourceId: checkpoint.revisionId,
    cursor,
    createdAt: sameCommit?.createdAt ?? nowIso(),
  });
};

/**
 * Records that the upgrade kept one text of a note aside.
 *
 * The event takes the identity of the kept text, so keeping a later text in
 * the same record keeps one event. The caller opens the transaction over the
 * Review table and publishes the change.
 */
export const recordRecoveryReview = async (
  ctx: LocalStoreContext,
  accountId: string,
  workspaceId: string,
  fileId: string,
  recoveryId: string,
): Promise<void> => {
  const { serverOrigin, tables, nowIso } = ctx;
  const stored: unknown = await tables.reviews.get([
    serverOrigin,
    accountId,
    workspaceId,
    recoveryId,
  ]);
  await tables.reviews.put({
    serverOrigin,
    accountId,
    workspaceId,
    reviewId: recoveryId,
    fileId,
    cause: 'recovery',
    sourceId: recoveryId,
    cursor: null,
    createdAt:
      stored === undefined ? nowIso() : validateReview(stored).createdAt,
  });
};

/**
 * Removes the Reviews of one note, or only those that name one kept text.
 *
 * The caller opens the transaction over the Review table.
 */
export const forgetReviews = async (
  ctx: LocalStoreContext,
  accountId: string,
  workspaceId: string,
  fileId: string,
  onlyRecoveryId: string | null = null,
): Promise<void> => {
  const { serverOrigin, tables } = ctx;
  for (const row of await reviewsOfFile(ctx, accountId, workspaceId, fileId)) {
    if (
      onlyRecoveryId !== null &&
      (row.cause !== 'recovery' || row.sourceId !== onlyRecoveryId)
    )
      continue;
    await tables.reviews.delete([
      serverOrigin,
      accountId,
      workspaceId,
      row.reviewId,
    ]);
  }
};

export function createReviewsSlice(ctx: LocalStoreContext): ReviewsSlice {
  const { serverOrigin, db, tables, publish } = ctx;

  /** The text that one event keeps, or `null` when it is gone. */
  const textOf = async (
    accountId: string,
    workspaceId: string,
    row: ReviewRow,
  ): Promise<string | null> => {
    if (row.cause === 'recovery') {
      const stored: unknown = await tables.recovery.get([
        serverOrigin,
        accountId,
        workspaceId,
        row.sourceId,
      ]);
      return stored === undefined ? null : validateRecovery(stored).text;
    }
    const stored: unknown = await tables.checkpoints.get([
      serverOrigin,
      accountId,
      workspaceId,
      row.sourceId,
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
  };

  return {
    listReviews(
      accountId: string,
      workspaceId: string,
      fileId: string,
    ): Promise<readonly ReviewRecord[]> {
      return guard('reading the reviews of a note', () =>
        db.transaction(
          'r',
          [
            tables.reviews,
            tables.checkpoints,
            tables.contents,
            tables.recovery,
          ],
          async () => {
            const rows = await reviewsOfFile(
              ctx,
              accountId,
              workspaceId,
              fileId,
            );
            rows.sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.reviewId.localeCompare(right.reviewId),
            );
            const records: ReviewRecord[] = [];
            for (const row of rows) {
              const cause: ReviewCause =
                row.cause === 'merge'
                  ? { kind: 'merge', revisionId: row.sourceId }
                  : { kind: 'recovery', recoveryId: row.sourceId };
              records.push({
                reviewId: row.reviewId,
                fileId: row.fileId,
                cause,
                text: await textOf(accountId, workspaceId, row),
                createdAt: row.createdAt,
              });
            }
            return records;
          },
        ),
      );
    },

    async clearReview(
      accountId: string,
      workspaceId: string,
      reviewId: string,
    ): Promise<void> {
      const cleared = await guard('clearing a review', () =>
        db.transaction('rw', tables.reviews, async () => {
          const stored: unknown = await tables.reviews.get([
            serverOrigin,
            accountId,
            workspaceId,
            reviewId,
          ]);
          if (stored === undefined) return null;
          const row = validateReview(stored);
          await tables.reviews.delete([
            serverOrigin,
            accountId,
            workspaceId,
            reviewId,
          ]);
          return row.fileId;
        }),
      );
      if (cleared === null) return;
      publish({ accountId, workspaceId, fileId: cleared, kind: 'review' });
    },
  };
}
