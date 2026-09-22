/**
 * The scope that one open transaction hands to each repository.
 *
 * A repository holds SQL only. It receives the bound driver client, the
 * Drizzle handle over the same client, the verified actor, and the workspace
 * of the transaction. Every statement it runs is therefore inside the one
 * transaction that the unit of work opened.
 */
import type pg from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Actor, DocumentService } from '@notesapp/core';

/** The bound scope of one repository inside one open transaction. */
export type RepositoryContext = {
  readonly client: pg.PoolClient;
  readonly db: NodePgDatabase;
  readonly actor: Actor;
  readonly workspaceId: string;
  /**
   * The document service of this deployment. Storage authors text in two
   * places, the link rewrite after a move and the migration, and both edit the
   * document of the note through this port (records 0081, 0084).
   */
  readonly documents: DocumentService;
};
