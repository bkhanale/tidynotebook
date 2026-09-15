/**
 * The trash repository: the deleted and permanently purged files of the open
 * workspace.
 *
 * It is the trash slice of the port. It reads the purged file markers, lists
 * the deleted files, previews a permanent deletion, and runs the permanent
 * deletion under the workspace lock. The deleted listing shares the keyset
 * paging in `listing.ts` with the live listing.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  fail,
  maxPageSize,
  ok,
  OperationalError,
  type Actor,
  type BlockingReference,
  type DeletedFilePage,
  type FilePageRequest,
  type PurgePreview,
  type PurgedFilesResult,
  type Result,
  type WorkspaceTransaction,
} from '@notesapp/core';
import { files, mutationReceipts, purgeMarkers } from '../schema.ts';
import { emitSyncRows } from '../snapshots.ts';
import { assertUuid, operational, postgresFailure } from './errors.ts';
import {
  listingBound,
  listingCursor,
  listingInstant,
  listingOrder,
  nextListingCursor,
} from './listing.ts';
import type { RepositoryContext } from './context.ts';

/** Builds the trash slice of the port over one open transaction. */
export function trashRepository(
  context: RepositoryContext,
): Pick<
  WorkspaceTransaction,
  'purgedFiles' | 'listDeletedFiles' | 'previewPurge' | 'purgeFiles'
> {
  const { client, db, workspaceId } = context;
  return {
    async purgedFiles(fileIds: readonly string[]): Promise<readonly string[]> {
      if (fileIds.length === 0) return [];
      for (const fileId of fileIds) assertUuid(fileId, 'a file');
      const rows = await db
        .select({ fileId: purgeMarkers.fileId })
        .from(purgeMarkers)
        .where(
          and(
            eq(purgeMarkers.workspaceId, workspaceId),
            inArray(purgeMarkers.fileId, [...fileIds]),
          ),
        );
      return rows.map((row) => row.fileId);
    },

    async listDeletedFiles(page: FilePageRequest): Promise<DeletedFilePage> {
      // The complement of `listFiles`, and the same paging: one row more than
      // the page is read, so the answer knows whether a next page exists
      // without a second count query. The two keyset indexes on `files`
      // cover the filter and both sort orders.
      const limit = Math.min(Math.max(1, Math.trunc(page.limit)), maxPageSize);
      const from = listingCursor(page);
      const rows = await db
        .select({
          id: files.id,
          path: files.path,
          kind: files.kind,
          head: files.headRevisionId,
          createdAt: files.createdAt,
          updatedAt: files.updatedAt,
          updatedKey: listingInstant,
        })
        .from(files)
        .where(
          and(
            eq(files.workspaceId, workspaceId),
            eq(files.deleted, true),
            isNotNull(files.headRevisionId),
            listingBound(from),
          ),
        )
        .orderBy(...listingOrder(page.sort))
        .limit(limit + 1);
      const wanted = rows.slice(0, limit);
      return {
        files: wanted.flatMap((row) =>
          row.head === null
            ? []
            : [
                {
                  fileId: row.id,
                  path: row.path,
                  kind: row.kind,
                  headRevisionId: row.head,
                  createdAt: row.createdAt.toISOString(),
                  // The last accepted change of a deleted file is its
                  // tombstone, so this instant is the deletion time.
                  deletedAt: row.updatedAt.toISOString(),
                },
              ],
        ),
        nextCursor:
          rows.length > limit
            ? nextListingCursor(page.sort, wanted.at(-1))
            : null,
      };
    },

    async previewPurge(
      fileIds: readonly string[],
    ): Promise<Result<PurgePreview>> {
      if (fileIds.length === 0) {
        return ok({
          fileIds: [],
          revisionIds: [],
          contentDigests: [],
          attachmentObjectIds: [],
          blockingReferences: [],
          dependentRevisionCount: 0,
          reclaimableBytes: 0,
          canPurge: true,
        });
      }
      for (const fileId of fileIds) assertUuid(fileId, 'the file');
      const result = await client.query<{
        file_ids: string[];
        revision_ids: string[];
        content_digests: string[];
        attachment_object_ids: string[];
        blocking_kind: string[];
        blocking_target_id: string[];
        blocking_referrer_id: string[];
        blocking_description: string[];
      }>('SELECT * FROM public.notesapp_preview_purge($1, $2)', [
        workspaceId,
        [...fileIds],
      ]);
      const row = result.rows[0];
      if (!row) {
        return ok({
          fileIds: [],
          revisionIds: [],
          contentDigests: [],
          attachmentObjectIds: [],
          blockingReferences: [],
          dependentRevisionCount: 0,
          reclaimableBytes: 0,
          canPurge: true,
        });
      }
      const blockingReferences: BlockingReference[] = [];
      const count = row.blocking_kind?.length ?? 0;
      for (let i = 0; i < count; i++) {
        // The SQL function returns the kind as text. A purge preview names
        // one kind of blocking reference, so any other text is a defect of
        // the function and not an answer that a caller can act on.
        const kind = row.blocking_kind[i];
        if (kind !== 'revision')
          throw new OperationalError(
            'unexpected',
            'notesapp: a purge preview names a blocking reference of an unknown kind.',
          );
        blockingReferences.push({
          kind,
          targetId: row.blocking_target_id[i] ?? '',
          referrerId: row.blocking_referrer_id[i] ?? '',
          description: row.blocking_description[i] ?? '',
        });
      }

      let reclaimableBytes = (row.file_ids?.length ?? 0) * 512;
      if (row.content_digests && row.content_digests.length > 0) {
        const reclaimResult = await client.query<{ bytes: string }>(
          `SELECT coalesce(sum(size), 0) as bytes
           FROM public.contents c
           WHERE c.workspace_id = $1
             AND c.digest = ANY($2::text[])
             AND NOT EXISTS (
               SELECT 1 FROM public.revisions r
               WHERE r.workspace_id = $1
                 AND r.content_digest = c.digest
                 AND NOT (r.file_id = ANY($3::uuid[]))
             )`,
          [workspaceId, row.content_digests, row.file_ids ?? []],
        );
        reclaimableBytes += Number(reclaimResult.rows[0]?.bytes ?? 0);
      }

      return ok({
        fileIds: row.file_ids ?? [],
        revisionIds: row.revision_ids ?? [],
        contentDigests: row.content_digests ?? [],
        attachmentObjectIds: row.attachment_object_ids ?? [],
        blockingReferences,
        dependentRevisionCount: row.revision_ids?.length ?? 0,
        reclaimableBytes,
        canPurge: blockingReferences.length === 0,
      });
    },

    async purgeFiles(
      purger: Actor,
      mutationId: string,
      fileIds: readonly string[],
      digest: string,
    ): Promise<Result<PurgedFilesResult>> {
      assertUuid(mutationId, 'the mutation');
      for (const fileId of fileIds) assertUuid(fileId, 'the file');

      const existingReceipt = await client.query<{
        request_digest: string;
        outcome: PurgedFilesResult;
      }>(
        'SELECT request_digest, outcome FROM mutation_receipts WHERE workspace_id = $1 AND actor_account_id = $2 AND mutation_id = $3',
        [workspaceId, purger.accountId, mutationId],
      );
      const existing = existingReceipt.rows[0];
      if (existing !== undefined) {
        if (existing.request_digest === digest) {
          return ok(existing.outcome);
        }
        return fail('mutation_reused', fileIds);
      }

      try {
        // `notesapp_purge_files` removes the snapshot items that pin a purged
        // revision itself, so no caller has to prepare the foreign key first.
        const res = await client.query<{
          purged_file_ids: string[];
          purged_revision_ids: string[];
          reclaimed_bytes: string;
          unreferenced_object_ids: string[];
        }>('SELECT * FROM public.notesapp_purge_files($1, $2)', [
          workspaceId,
          [...fileIds],
        ]);
        const row = res.rows[0];
        const purgedFileIds = row?.purged_file_ids ?? [];
        const purgedRevisionIds = row?.purged_revision_ids ?? [];
        const reclaimedBytes = Number(row?.reclaimed_bytes ?? 0);

        // The permanent deletion joins the ordered sync stream under the
        // workspace lock, so a sync client learns to drop the file.
        if (purgedFileIds.length > 0) {
          await emitSyncRows(client, {
            workspaceId,
            entries: purgedFileIds.map((fileId) => ({
              entityKind: 'file' as const,
              entityId: fileId,
              revisionId: null,
              deleted: true,
            })),
          });
        }

        const outcome: PurgedFilesResult = {
          mutationId,
          purgedFileIds,
          purgedRevisionIds,
          reclaimedBytes,
        };

        await db.insert(mutationReceipts).values({
          workspaceId,
          actorAccountId: purger.accountId,
          mutationId,
          requestDigest: digest,
          outcome,
        });

        return ok(outcome);
      } catch (error) {
        const failure = postgresFailure(error);
        if (failure?.code === '23503') {
          return fail('invalid_content', fileIds);
        }
        if (failure?.code === '42501') {
          return fail('forbidden');
        }
        throw operational(error);
      }
    },
  };
}
