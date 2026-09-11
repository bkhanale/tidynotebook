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
import type { Actor } from '@notesapp/core';

/** The bound scope of one repository inside one open transaction. */
export type RepositoryContext = {
  readonly client: pg.PoolClient;
  readonly db: NodePgDatabase;
  readonly actor: Actor;
  readonly workspaceId: string;
};
