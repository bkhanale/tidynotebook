/**
 * Data migration that makes each search row of an earlier rule again
 * (record 0167).
 *
 * A row states in `text_rule` the version of the rule that made its body.
 * Release 0.12 and earlier wrote the raw Markdown, and every such row reads
 * 0. This run finds each row whose rule is older than `searchTextRule`, reads
 * the Markdown of the revision that the row names, and writes the readable
 * text and the current rule. The stored vector follows the body, because the
 * database computes it.
 *
 * Only a row that exists is made again, so a note that the index never held
 * stays out of it, and a row whose note the grammar now refuses goes. The
 * run writes a row only when its rule is old, so a second run changes
 * nothing, and an interrupted run completes on the next start.
 */
import { MarkdownLimitError } from '@notesapp/markdown';
import pg from 'pg';
import { searchableNote, searchTextRule } from './search-text.ts';

/** What one run of the migration did. */
export type SearchIndexMigrationResult = {
  /** How many rows received the text of the current rule in this run. */
  readonly rewrittenRows: number;
};

type IndexRow = {
  readonly workspace_id: string;
  readonly file_id: string;
  readonly revision_id: string;
  readonly path: string;
  readonly markdown: string | null;
};

/** The readable text of one row, or `null` when the grammar refuses it. */
function bodyOf(row: IndexRow): string | null {
  try {
    return searchableNote(row.markdown ?? '', row.path).body;
  } catch (error) {
    if (error instanceof MarkdownLimitError) return null;
    throw error;
  }
}

/** How many rows one read of the run holds at a time. */
const batchSize = 200;

/** Makes the body of every row of an earlier rule again. */
export async function migrateSearchIndex(
  databaseUrl: string,
): Promise<SearchIndexMigrationResult> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let rewrittenRows = 0;
  try {
    for (;;) {
      // Each batch writes the current rule into every row it read, so the
      // next read starts after them and the loop ends.
      const rows = await client.query<IndexRow>(
        `select s.workspace_id, s.file_id, s.revision_id, s.path, c.markdown
         from search_index s
         join revisions r
           on r.workspace_id = s.workspace_id and r.id = s.revision_id
         join contents c
           on c.workspace_id = r.workspace_id and c.digest = r.content_digest
         where s.text_rule < $1
         order by s.workspace_id, s.file_id
         limit $2`,
        [searchTextRule, batchSize],
      );
      if (rows.rows.length === 0) break;
      for (const row of rows.rows) {
        const key = [row.workspace_id, row.file_id, row.revision_id];
        const body = bodyOf(row);
        if (body === null) {
          // The grammar of this release refuses the note, so a save of it
          // would write no row either. The row goes, and search no longer
          // finds a note that the renderer cannot show.
          await client.query(
            `delete from search_index
             where workspace_id = $1 and file_id = $2 and revision_id = $3`,
            key,
          );
          continue;
        }
        const written = await client.query(
          `update search_index
           set body = $4, text_rule = $5
           where workspace_id = $1 and file_id = $2 and revision_id = $3
             and text_rule < $5`,
          [...key, body, searchTextRule],
        );
        rewrittenRows += written.rowCount ?? 0;
      }
    }
  } finally {
    await client.end();
  }
  return { rewrittenRows };
}
