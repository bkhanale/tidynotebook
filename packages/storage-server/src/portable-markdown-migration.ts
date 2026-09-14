/** Data migration from version 0.1.0 application references to file paths. */
import {
  commitChangeset,
  generateUUID,
  markdownContent,
  verifyActor,
} from '@notesapp/core';
import { migrateLegacyReferences } from '@notesapp/markdown';
import pg from 'pg';
import { openWorkspaceStore } from './workspace-store/index.ts';

export type PortableMarkdownMigrationResult = {
  readonly revisedNotes: number;
  readonly deadReferences: number;
};

type LiveRow = {
  readonly workspace_id: string;
  readonly account_id: string;
  readonly file_id: string;
  readonly path: string;
  readonly kind: 'note' | 'attachment';
  readonly head_revision_id: string;
  readonly markdown: string | null;
};

type AttachmentRevisionRow = {
  readonly workspace_id: string;
  readonly revision_id: string;
  readonly path: string;
};

/** Rewrites every live legacy reference and records each unresolved target. */
export async function migratePortableMarkdown(
  databaseUrl: string,
): Promise<PortableMarkdownMigrationResult> {
  const client = new pg.Client({ connectionString: databaseUrl });
  const store = openWorkspaceStore(databaseUrl, { poolSize: 1 });
  await client.connect();
  let revisedNotes = 0;
  let deadReferences = 0;
  try {
    const live = await client.query<LiveRow>(`
      select f.workspace_id, m.account_id, f.id as file_id, f.path, f.kind,
             f.head_revision_id, c.markdown
      from files f
      join memberships m on m.workspace_id = f.workspace_id and m.role = 'owner'
      join revisions r
        on r.workspace_id = f.workspace_id and r.id = f.head_revision_id
      join contents c
        on c.workspace_id = r.workspace_id and c.digest = r.content_digest
      where not f.deleted
      order by f.workspace_id, f.path
    `);
    const attachmentRevisions = await client.query<AttachmentRevisionRow>(`
      select r.workspace_id, r.id as revision_id, f.path
      from revisions r
      join files f
        on f.workspace_id = r.workspace_id and f.id = r.file_id
      where f.kind = 'attachment' and not f.deleted
    `);
    const workspaceIds = new Set(live.rows.map((row) => row.workspace_id));
    for (const workspaceId of workspaceIds) {
      const rows = live.rows.filter((row) => row.workspace_id === workspaceId);
      const owner = rows[0]?.account_id;
      if (owner === undefined) continue;
      const notes = new Map(
        rows
          .filter((row) => row.kind === 'note')
          .map((row) => [row.file_id, row.path]),
      );
      const attachments = new Map(
        attachmentRevisions.rows
          .filter((row) => row.workspace_id === workspaceId)
          .map((row) => [row.revision_id, row.path]),
      );
      const verified = verifyActor(owner, [
        {
          workspaceId,
          actions: ['read', 'write', 'history', 'purge'],
        },
      ]);
      if (!verified.ok)
        throw new Error('notesapp: the migration owner is not valid.');
      for (const row of rows) {
        if (row.kind !== 'note' || row.markdown === null) continue;
        const migrated = migrateLegacyReferences(row.markdown, row.path, {
          notes,
          attachments,
        });
        for (const reference of migrated.deadReferences) {
          await client.query(
            `insert into portable_markdown_migration_report
               (workspace_id, source_path, reference)
             values ($1, $2, $3)
             on conflict do nothing`,
            [workspaceId, row.path, reference],
          );
          deadReferences += 1;
        }
        if (migrated.count === 0) continue;
        const outcome = await commitChangeset(
          store,
          verified.value,
          {
            workspaceId,
            mutationId: generateUUID(),
            deviceId: 'portable-markdown-migration',
            expectedHeads: { [row.file_id]: row.head_revision_id },
            revisions: [
              {
                id: generateUUID(),
                fileId: row.file_id,
                parents: [row.head_revision_id],
                path: row.path,
                deleted: false,
                content: await markdownContent(migrated.text),
                clientTime: new Date().toISOString(),
                message: 'Make links portable.',
                restoredFrom: null,
              },
            ],
          },
          `portable-markdown-${row.head_revision_id}`,
        );
        if (!outcome.ok)
          throw new Error(
            `notesapp: portable Markdown migration failed with ${outcome.error.code}.`,
          );
        revisedNotes += 1;
      }
    }
    return { revisedNotes, deadReferences };
  } finally {
    await store.close();
    await client.end();
  }
}
