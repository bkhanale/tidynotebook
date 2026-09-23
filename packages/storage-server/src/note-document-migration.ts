/**
 * Data migration that starts the document of every existing note (record 0084).
 *
 * Release 0.5 keeps a document for each note, and a save carries work on it.
 * A note that an earlier release wrote has no document, and a workspace that
 * held none started an empty one at the first save. Two devices that each
 * started a document for such a note from its text then sent two sets of
 * character identities, and the note held its text twice. Record 0084 states
 * the rule instead: the server starts each existing note once, from its text,
 * and no device starts an existing note from Markdown.
 *
 * A live note starts from the text of its head. A note in Trash starts from
 * the last live text, which is the text that Restore brings back, because an
 * empty tombstone must not erase it. The migration runs before the server
 * serves, it writes only a note that has no document, and a second run finds
 * nothing to do, so an interrupted run completes on the next start.
 */
import type { DocumentService } from '@notesapp/core';
import pg from 'pg';

/** What one run of the migration did. */
export type NoteDocumentMigrationResult = {
  /** How many notes received a document in this run. */
  readonly startedNotes: number;
};

type NoteRow = {
  readonly workspace_id: string;
  readonly file_id: string;
  readonly head_revision_id: string;
};

/** Starts the document of each note that has none, from its last live text. */
export async function migrateNoteDocuments(
  databaseUrl: string,
  documents: DocumentService,
): Promise<NoteDocumentMigrationResult> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let startedNotes = 0;
  try {
    const notes = await client.query<NoteRow>(`
      select f.workspace_id, f.id as file_id, f.head_revision_id
      from files f
      where f.kind = 'note'
        and f.head_revision_id is not null
        and not exists (
          select 1 from note_documents d
          where d.workspace_id = f.workspace_id and d.file_id = f.id
        )
      order by f.workspace_id, f.id
    `);
    for (const note of notes.rows) {
      // The nearest revision on the first-parent chain that is not a
      // tombstone holds the last live text of the note.
      const live = await client.query<{ markdown: string | null }>(
        `with recursive chain as (
           select r.workspace_id, r.id, r.deleted, r.content_digest, 0 as depth
           from revisions r
           where r.workspace_id = $1 and r.id = $2
           union all
           select p.workspace_id, p.id, p.deleted, p.content_digest,
                  chain.depth + 1
           from chain
           join revision_parents rp
             on rp.workspace_id = chain.workspace_id
            and rp.child_id = chain.id
            and rp.ordinal = 0
           join revisions p
             on p.workspace_id = rp.workspace_id and p.id = rp.parent_id
           where chain.deleted
         )
         select c.markdown
         from chain
         join contents c
           on c.workspace_id = chain.workspace_id
          and c.digest = chain.content_digest
         where not chain.deleted
         order by chain.depth
         limit 1`,
        [note.workspace_id, note.head_revision_id],
      );
      const text = live.rows[0]?.markdown ?? '';
      const bytes = documents.start(text);
      const written = await client.query(
        `insert into note_documents (workspace_id, file_id, epoch, bytes, state)
         values ($1, $2, 1, $3, $4)
         on conflict do nothing`,
        [
          note.workspace_id,
          note.file_id,
          Buffer.from(bytes),
          Buffer.from(documents.observe(bytes)),
        ],
      );
      startedNotes += written.rowCount ?? 0;
    }
  } finally {
    await client.end();
  }
  return { startedNotes };
}
