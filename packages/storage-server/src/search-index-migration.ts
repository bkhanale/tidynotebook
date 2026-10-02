/**
 * Data migration that writes the search row of every live note that has none
 * or holds one of an earlier rule (record 0167).
 *
 * A row states in `text_rule` the version of the rule that made its body.
 * Migration 0027 empties the table, because its rows held raw Markdown, and
 * this run writes the row of each live note from the Markdown of its head:
 * the readable text, under the name of the note, and the current rule. The
 * stored vector follows the body, because the database computes it.
 *
 * The run walks the live notes by keyset, `(workspace_id, id)`, in batches of
 * `batchSize`, so each batch is one short read and no read starts from the
 * front again. Each batch reads keys only, and the Markdown of one note at a
 * time, so a batch holds one note in memory and not a batch of them. A note
 * that the grammar of this release refuses gets no row, as a save of it
 * would write none. A note that has a row of the current rule is not read,
 * so a second run reads keys only, and an interrupted run completes on the
 * next start.
 */
import { MarkdownLimitError } from '@notesapp/markdown';
import pg from 'pg';
import { noteTitle, searchableNote, searchTextRule } from './search-text.ts';

/** What one run of the migration did. */
export type SearchIndexMigrationResult = {
  /** How many rows received the text of the current rule in this run. */
  readonly writtenRows: number;
};

type NoteKey = {
  readonly workspace_id: string;
  readonly file_id: string;
  readonly revision_id: string;
  readonly path: string;
};

/** How many note keys one read of the run holds at a time. */
const batchSize = 500;

/** The readable text of one note, or `null` when the grammar refuses it. */
function bodyOf(markdown: string, path: string): string | null {
  try {
    return searchableNote(markdown, path).body;
  } catch (error) {
    if (error instanceof MarkdownLimitError) return null;
    throw error;
  }
}

/** Writes the row of every live note that has none or an older one. */
export async function migrateSearchIndex(
  databaseUrl: string,
): Promise<SearchIndexMigrationResult> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let writtenRows = 0;
  try {
    // A run that stops before the migration of the rule, as an upgrade test
    // does, has a table with no rule to read. The run after it writes it.
    const ruled = await client.query(
      `select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'search_index'
         and column_name = 'text_rule'`,
    );
    if (ruled.rows.length === 0) return { writtenRows };
    let after: readonly [string, string] = [
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000000',
    ];
    for (;;) {
      const keys = await client.query<NoteKey>(
        `select f.workspace_id, f.id as file_id,
                f.head_revision_id as revision_id, f.path
         from files f
         left join search_index s
           on s.workspace_id = f.workspace_id and s.file_id = f.id
         where f.kind = 'note' and not f.deleted
           and f.head_revision_id is not null
           and (f.workspace_id, f.id) > ($2::uuid, $3::uuid)
           and (s.file_id is null or s.text_rule < $1
                or s.revision_id <> f.head_revision_id)
         order by f.workspace_id, f.id
         limit $4`,
        [searchTextRule, after[0], after[1], batchSize],
      );
      const last = keys.rows.at(-1);
      if (last === undefined) break;
      after = [last.workspace_id, last.file_id];
      for (const key of keys.rows) {
        const content = await client.query<{ markdown: string | null }>(
          `select c.markdown
           from revisions r
           join contents c
             on c.workspace_id = r.workspace_id and c.digest = r.content_digest
           where r.workspace_id = $1 and r.id = $2`,
          [key.workspace_id, key.revision_id],
        );
        const body = bodyOf(content.rows[0]?.markdown ?? '', key.path);
        if (body === null) {
          await client.query(
            'delete from search_index where workspace_id = $1 and file_id = $2',
            [key.workspace_id, key.file_id],
          );
          continue;
        }
        const written = await client.query(
          `insert into search_index
             (workspace_id, file_id, revision_id, path, title, body, text_rule)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (workspace_id, file_id) do update
             set revision_id = excluded.revision_id, path = excluded.path,
                 title = excluded.title, body = excluded.body,
                 text_rule = excluded.text_rule`,
          [
            key.workspace_id,
            key.file_id,
            key.revision_id,
            key.path,
            noteTitle(key.path),
            body,
            searchTextRule,
          ],
        );
        writtenRows += written.rowCount ?? 0;
      }
    }
  } finally {
    await client.end();
  }
  return { writtenRows };
}
