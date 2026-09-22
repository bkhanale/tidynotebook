/**
 * The notes repository: the files of the open workspace.
 *
 * It is the notes slice of the port. It reads accepted heads, the live file
 * listing, the taken paths, and a single file record. The trash listing lives
 * in the trash repository, and both share the keyset paging in `listing.ts`.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  maxPageSize,
  type FilePage,
  type FilePageRequest,
  type FileRecord,
  type HeadState,
  type WorkspaceTransaction,
  type StoredDocument,
} from '@notesapp/core';
import { files, livePaths, noteDocuments } from '../schema.ts';
import { assertUuid } from './errors.ts';
import {
  listingBound,
  listingCursor,
  listingInstant,
  listingOrder,
  nextListingCursor,
} from './listing.ts';
import type { RepositoryContext } from './context.ts';

/** Builds the notes slice of the port over one open transaction. */
export function notesRepository(
  context: RepositoryContext,
): Pick<
  WorkspaceTransaction,
  'documents' | 'heads' | 'headStates' | 'listFiles' | 'takenPaths' | 'file'
> {
  const { db, workspaceId } = context;
  return {
    async documents(
      fileIds: readonly string[],
    ): Promise<ReadonlyMap<string, StoredDocument>> {
      if (fileIds.length === 0) return new Map();
      for (const fileId of fileIds) assertUuid(fileId, 'a file');
      const rows = await db
        .select({
          fileId: noteDocuments.fileId,
          bytes: noteDocuments.bytes,
          epoch: noteDocuments.epoch,
        })
        .from(noteDocuments)
        .where(
          and(
            eq(noteDocuments.workspaceId, workspaceId),
            inArray(noteDocuments.fileId, [...fileIds]),
          ),
        );
      return new Map(
        rows.map((row) => [row.fileId, { bytes: row.bytes, epoch: row.epoch }]),
      );
    },

    async heads(
      fileIds: readonly string[],
    ): Promise<ReadonlyMap<string, string | null>> {
      const result = new Map<string, string | null>();
      for (const fileId of fileIds) {
        assertUuid(fileId, 'a file');
        result.set(fileId, null);
      }
      if (result.size === 0) return result;
      const rows = await db
        .select({ id: files.id, head: files.headRevisionId })
        .from(files)
        .where(
          and(
            eq(files.workspaceId, workspaceId),
            inArray(files.id, [...result.keys()]),
          ),
        );
      for (const row of rows) result.set(row.id, row.head);
      return result;
    },

    async headStates(
      fileIds: readonly string[],
    ): Promise<ReadonlyMap<string, HeadState>> {
      const wanted = new Set<string>();
      for (const fileId of fileIds) {
        assertUuid(fileId, 'a file');
        wanted.add(fileId);
      }
      const result = new Map<string, HeadState>();
      if (wanted.size === 0) return result;
      const rows = await db
        .select({
          id: files.id,
          head: files.headRevisionId,
          path: files.path,
          deleted: files.deleted,
        })
        .from(files)
        .where(
          and(
            eq(files.workspaceId, workspaceId),
            inArray(files.id, [...wanted]),
          ),
        );
      for (const row of rows) {
        // A file row without a head holds no accepted revision, so it has no
        // head state and stays absent from the answer.
        if (row.head === null) continue;
        result.set(row.id, {
          revisionId: row.head,
          path: row.path,
          deleted: row.deleted,
        });
      }
      return result;
    },

    async listFiles(page: FilePageRequest): Promise<FilePage> {
      // One row more than the page is read, so the answer knows whether a next
      // page exists without a second count query.
      const limit = Math.min(Math.max(1, Math.trunc(page.limit)), maxPageSize);
      const from = listingCursor(page);
      const rows = await db
        .select({
          id: files.id,
          path: files.path,
          kind: files.kind,
          head: files.headRevisionId,
          deleted: files.deleted,
          createdAt: files.createdAt,
          updatedAt: files.updatedAt,
          updatedKey: listingInstant,
        })
        .from(files)
        .where(
          and(
            eq(files.workspaceId, workspaceId),
            eq(files.deleted, false),
            isNotNull(files.headRevisionId),
            listingBound(from),
          ),
        )
        .orderBy(...listingOrder(page.sort))
        .limit(limit + 1);
      const wanted = rows.slice(0, limit);
      return {
        files: wanted.map((row) => ({
          fileId: row.id,
          path: row.path,
          kind: row.kind,
          headRevisionId: row.head,
          deleted: row.deleted,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        nextCursor:
          rows.length > limit
            ? nextListingCursor(page.sort, wanted.at(-1))
            : null,
      };
    },

    async takenPaths(paths: readonly string[]): Promise<readonly string[]> {
      if (paths.length === 0) return [];
      const rows = await db
        .select({ path: livePaths.path })
        .from(livePaths)
        .where(
          and(
            eq(livePaths.workspaceId, workspaceId),
            inArray(livePaths.path, [...paths]),
          ),
        );
      return rows.map((row) => row.path);
    },

    async file(fileId: string): Promise<FileRecord | null> {
      assertUuid(fileId, 'the file');
      const rows = await db
        .select({
          id: files.id,
          path: files.path,
          kind: files.kind,
          head: files.headRevisionId,
          deleted: files.deleted,
          createdAt: files.createdAt,
          updatedAt: files.updatedAt,
        })
        .from(files)
        .where(and(eq(files.workspaceId, workspaceId), eq(files.id, fileId)));
      const row = rows[0];
      if (row === undefined) return null;
      return {
        fileId: row.id,
        path: row.path,
        kind: row.kind,
        headRevisionId: row.head,
        deleted: row.deleted,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
  };
}
