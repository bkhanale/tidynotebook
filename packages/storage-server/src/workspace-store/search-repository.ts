/**
 * The search repository: the accepted note index of the open workspace.
 *
 * It is the search slice of the port. It runs the membership checked search
 * function and clears the index rows of files that a changeset deleted. The
 * index holds the readable text of each note, so an excerpt is plain text
 * when it leaves the database (records 0162, 0167).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Backlink, SearchHit, WorkspaceTransaction } from '@notesapp/core';
import { noteLinks, searchIndex } from '../schema.ts';
import { splitExcerpt } from '../excerpt.ts';
import { assertUuid } from './errors.ts';
import type { RepositoryContext } from './context.ts';

/** Builds the search slice of the port over one open transaction. */
export function searchRepository(
  context: RepositoryContext,
): Pick<WorkspaceTransaction, 'search' | 'backlinks' | 'onFilesDeleted'> {
  const { client, db, workspaceId } = context;
  return {
    async search(query: string, limit: number): Promise<readonly SearchHit[]> {
      const result = await client.query<{
        file_id: string;
        path: string;
        revision_id: string;
        excerpt: string;
      }>(
        'select file_id, path, revision_id, excerpt from public.notesapp_search($1, $2, $3)',
        [workspaceId, query, limit],
      );
      return result.rows.map((row) => ({
        fileId: row.file_id,
        path: row.path,
        revisionId: row.revision_id,
        excerpt: splitExcerpt(row.excerpt),
      }));
    },

    async backlinks(
      targetPath: string,
      limit: number,
    ): Promise<readonly Backlink[]> {
      const rows = await db
        .select({
          fileId: noteLinks.sourceFileId,
          path: noteLinks.sourcePath,
          revisionId: noteLinks.sourceRevisionId,
        })
        .from(noteLinks)
        .where(
          and(
            eq(noteLinks.workspaceId, workspaceId),
            eq(noteLinks.targetPath, targetPath),
          ),
        )
        .orderBy(noteLinks.sourcePath)
        .limit(limit);
      return rows;
    },

    async onFilesDeleted(fileIds: readonly string[]): Promise<void> {
      if (fileIds.length === 0) return;
      for (const fileId of fileIds) assertUuid(fileId, 'a file');
      const ids = [...fileIds];
      // The file leaves the search index, so it disappears from search.
      await db
        .delete(searchIndex)
        .where(
          and(
            eq(searchIndex.workspaceId, workspaceId),
            inArray(searchIndex.fileId, ids),
          ),
        );
      await db
        .delete(noteLinks)
        .where(
          and(
            eq(noteLinks.workspaceId, workspaceId),
            inArray(noteLinks.sourceFileId, ids),
          ),
        );
    },
  };
}
