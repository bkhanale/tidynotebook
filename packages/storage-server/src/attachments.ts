/**
 * Attachment persistence and cleanup on the private server volume.
 *
 * Attachment bytes are stored under the configured storage root, partitioned
 * by workspace and addressed by their verified SHA-256 digest. Deduplication
 * stays strictly inside one workspace.
 */
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type {
  Actor,
  AttachmentMediaType,
  AttachmentObjectRecord,
} from '@notesapp/core';
import { OperationalError } from '@notesapp/core';
import { storedAttachmentState, storedMediaType } from './attachment-row.ts';
import { attachmentObjects } from './schema.ts';
import { WorkspaceUnavailableError } from './workspace-store/index.ts';

export type AttachmentStore = {
  /** Saves metadata for an uploaded temporary attachment object. */
  saveTemporaryAttachment(
    actor: Actor,
    workspaceId: string,
    object: {
      readonly id: string;
      readonly digest: string;
      readonly size: bigint;
      readonly mediaType: AttachmentMediaType;
      readonly width: number;
      readonly height: number;
    },
  ): Promise<void>;

  /** Reads metadata of one attachment object in a workspace. */
  getAttachmentObject(
    actor: Actor,
    workspaceId: string,
    objectId: string,
  ): Promise<AttachmentObjectRecord | null>;

  /**
   * Promotes a temporary attachment object to finalized.
   * Moves bytes to immutable storage if needed.
   */
  finalizeAttachmentObject(
    actor: Actor,
    workspaceId: string,
    objectId: string,
    expectedDigest: string,
  ): Promise<
    | { readonly ok: true; readonly object: AttachmentObjectRecord }
    | {
        readonly ok: false;
        readonly error: 'not_found' | 'invalid_content' | 'already_unavailable';
      }
  >;

  /**
   * Reads the binary content and metadata of an accepted attachment revision.
   */
  readAttachmentRevision(
    actor: Actor,
    workspaceId: string,
    revisionId: string,
  ): Promise<{
    readonly stream: Readable;
    readonly size: bigint;
    readonly mediaType: AttachmentMediaType;
    readonly digest: string;
    readonly revisionId: string;
  } | null>;

  /**
   * Reclaims attachment bytes. This is the only code that deletes them.
   *
   * It takes an abandoned temporary object, an unreferenced finalized object
   * older than 24 hours, an object that a purge marked unavailable, and the
   * attachments of a deleted workspace. Every deletion runs inside the locked
   * transaction that claims the row, so a concurrent finalize cannot lose its
   * bytes. Returns how many objects were reclaimed.
   */
  reclaimAttachments(now: Date): Promise<number>;

  /** Absolute path for a temporary upload file. */
  temporaryPath(objectId: string): string;

  /** Absolute path for finalized attachment content. */
  immutablePath(workspaceId: string, digest: string): string;
};

export type AttachmentStoreHandle = AttachmentStore & {
  readonly close: () => Promise<void>;
};

export type AttachmentStoreOptions = {
  readonly poolSize?: number;
  readonly statementTimeoutMs?: number;
  /**
   * Runs inside the locked reclaim transaction, after the object was claimed
   * and before its bytes are deleted.
   *
   * The concurrency check of the reclaim needs to act in that window, which no
   * public call can reach. Production composition leaves this undefined.
   */
  readonly onReclaimMarked?: (objectId: string) => Promise<void>;
};

/** How many queued objects of deleted workspaces one reclaim batch takes. */
const reclaimBatchSize = 100;

/** True when the value is a lowercase hexadecimal SHA-256 digest. */
function isDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/** True when the value has the shape of a UUID. */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

/** Deletes one file and ignores a file that is already gone. */
async function removeFile(path: string): Promise<void> {
  if (!existsSync(path)) return;
  try {
    await unlink(path);
  } catch {
    // A file that another run removed first needs no report.
  }
}

/** Opens an attachment store backed by PostgreSQL and local volume storage. */
export function openAttachmentStore(
  databaseUrl: string,
  storageRoot: string,
  options: AttachmentStoreOptions = {},
): AttachmentStoreHandle {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.poolSize ?? 10,
    ...(options.statementTimeoutMs === undefined
      ? {}
      : { statement_timeout: options.statementTimeoutMs }),
  });

  function temporaryPath(objectId: string): string {
    return join(storageRoot, 'tmp', `${objectId}.tmp`);
  }

  function immutablePath(workspaceId: string, digest: string): string {
    return join(storageRoot, 'workspaces', workspaceId, 'attachments', digest);
  }

  /**
   * Deletes the attachment bytes that a workspace deletion queued.
   *
   * The workspace row and its attachment rows are already gone, so the whole
   * workspace directory is dead. The queue row is taken and the bytes are
   * deleted inside one transaction, so a failed deletion returns the row.
   */
  async function reclaimDeletedWorkspaces(
    client: pg.PoolClient,
  ): Promise<number> {
    let count = 0;
    for (;;) {
      let taken: readonly { workspace_id: string; object_id: string }[] = [];
      try {
        await client.query('begin');
        const result = await client.query<{
          workspace_id: string;
          object_id: string;
          digest: string;
        }>(
          'SELECT workspace_id, object_id, digest FROM public.notesapp_take_attachment_reclaim($1)',
          [reclaimBatchSize],
        );
        taken = result.rows;
        if (taken.length === 0) {
          await client.query('rollback');
          return count;
        }
        for (const row of taken) {
          await removeFile(temporaryPath(row.object_id));
        }
        const workspaces = new Set(taken.map((row) => row.workspace_id));
        for (const id of workspaces) {
          if (!isUuid(id)) continue;
          await rm(join(storageRoot, 'workspaces', id), {
            recursive: true,
            force: true,
          });
        }
        await client.query('commit');
      } catch {
        try {
          await client.query('rollback');
        } catch {
          // The connection is unusable; the next run repeats the work.
        }
        return count;
      }
      count += taken.length;
      if (taken.length < reclaimBatchSize) return count;
    }
  }

  async function withClient<T>(
    actor: Actor,
    workspaceId: string,
    action: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    let client: pg.PoolClient;
    try {
      client = await pool.connect();
    } catch {
      throw new OperationalError(
        'unavailable',
        'notesapp: database connection refused.',
      );
    }
    try {
      await client.query('begin');
      await client.query("select set_config('notesapp.account_id', $1, true)", [
        actor.accountId,
      ]);
      await client.query(
        'select pg_advisory_xact_lock(hashtext($1::text)::bigint)',
        [workspaceId],
      );
      const seen = await client.query<{ id: string }>(
        'select id from workspaces where id = $1',
        [workspaceId],
      );
      if (seen.rowCount === 0) {
        throw new WorkspaceUnavailableError(workspaceId);
      }
      const result = await action(client);
      await client.query('commit');
      return result;
    } catch (err: unknown) {
      try {
        await client.query('rollback');
      } catch {
        // Rollback failure is ignored after an error.
      }
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    temporaryPath,
    immutablePath,

    async saveTemporaryAttachment(actor, workspaceId, object): Promise<void> {
      await withClient(actor, workspaceId, async (client) => {
        const db = drizzle({ client });
        await db.insert(attachmentObjects).values({
          workspaceId,
          id: object.id,
          digest: object.digest.toLowerCase(),
          size: object.size,
          mediaType: object.mediaType,
          width: object.width,
          height: object.height,
          state: 'temporary',
        });
      });
    },

    async getAttachmentObject(
      actor,
      workspaceId,
      objectId,
    ): Promise<AttachmentObjectRecord | null> {
      return withClient(actor, workspaceId, async (client) => {
        const db = drizzle({ client });
        const rows = await db
          .select()
          .from(attachmentObjects)
          .where(
            and(
              eq(attachmentObjects.workspaceId, workspaceId),
              eq(attachmentObjects.id, objectId),
            ),
          );
        const row = rows[0];
        if (!row) return null;
        return {
          workspaceId: row.workspaceId,
          id: row.id,
          digest: row.digest,
          size: Number(row.size),
          mediaType: storedMediaType(row.mediaType),
          width: row.width,
          height: row.height,
          state: storedAttachmentState(row.state),
          createdAt: row.createdAt.toISOString(),
          finalizedAt: row.finalizedAt ? row.finalizedAt.toISOString() : null,
        };
      });
    },

    async finalizeAttachmentObject(
      actor,
      workspaceId,
      objectId,
      expectedDigest,
    ): Promise<
      | { readonly ok: true; readonly object: AttachmentObjectRecord }
      | {
          readonly ok: false;
          readonly error:
            'not_found' | 'invalid_content' | 'already_unavailable';
        }
    > {
      return withClient(actor, workspaceId, async (client) => {
        const selectResult = await client.query<{
          id: string;
          workspace_id: string;
          digest: string;
          size: string;
          media_type: string;
          width: number | null;
          height: number | null;
          state: string;
          created_at: Date;
          finalized_at: Date | null;
        }>(
          'SELECT * FROM attachment_objects WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
          [workspaceId, objectId],
        );
        if (selectResult.rowCount === 0) {
          return { ok: false, error: 'not_found' };
        }
        const row = selectResult.rows[0];
        if (!row) return { ok: false, error: 'not_found' };

        if (row.state === 'unavailable') {
          return { ok: false, error: 'already_unavailable' };
        }
        if (row.digest !== expectedDigest.toLowerCase()) {
          return { ok: false, error: 'invalid_content' };
        }

        const target = immutablePath(workspaceId, row.digest);
        const tmp = temporaryPath(objectId);

        if (row.state === 'temporary') {
          await mkdir(dirname(target), { recursive: true });
          if (existsSync(tmp)) {
            if (existsSync(target)) {
              await unlink(tmp);
            } else {
              await rename(tmp, target);
            }
          }
          const updateResult = await client.query<{ finalized_at: Date }>(
            "UPDATE attachment_objects SET state = 'finalized', finalized_at = clock_timestamp() WHERE workspace_id = $1 AND id = $2 RETURNING finalized_at",
            [workspaceId, objectId],
          );
          const finalizedAt = updateResult.rows[0]?.finalized_at ?? new Date();
          return {
            ok: true,
            object: {
              workspaceId: row.workspace_id,
              id: row.id,
              digest: row.digest,
              size: Number(row.size),
              mediaType: storedMediaType(row.media_type),
              width: row.width,
              height: row.height,
              state: 'finalized',
              createdAt: row.created_at.toISOString(),
              finalizedAt: finalizedAt.toISOString(),
            },
          };
        }

        // Already finalized
        return {
          ok: true,
          object: {
            workspaceId: row.workspace_id,
            id: row.id,
            digest: row.digest,
            size: Number(row.size),
            mediaType: storedMediaType(row.media_type),
            width: row.width,
            height: row.height,
            state: 'finalized',
            createdAt: row.created_at.toISOString(),
            finalizedAt: (row.finalized_at ?? row.created_at).toISOString(),
          },
        };
      });
    },

    async readAttachmentRevision(
      actor,
      workspaceId,
      revisionId,
    ): Promise<{
      readonly stream: Readable;
      readonly size: bigint;
      readonly mediaType: AttachmentMediaType;
      readonly digest: string;
      readonly revisionId: string;
    } | null> {
      return withClient(actor, workspaceId, async (client) => {
        const query = `
          SELECT r.id AS revision_id, r.deleted, r.content_digest AS digest,
                 c.size, c.object_id,
                 ao.media_type, ao.state
          FROM revisions r
          JOIN contents c ON c.workspace_id = r.workspace_id AND c.digest = r.content_digest
          JOIN attachment_objects ao ON ao.workspace_id = c.workspace_id AND ao.id = c.object_id
          WHERE r.workspace_id = $1 AND r.id = $2
        `;
        const result = await client.query<{
          revision_id: string;
          deleted: boolean;
          digest: string;
          size: string;
          object_id: string;
          media_type: string;
          state: string;
        }>(query, [workspaceId, revisionId]);

        if (result.rowCount === 0) return null;
        const row = result.rows[0];
        if (!row || row.deleted || row.state === 'unavailable') return null;

        const target = immutablePath(workspaceId, row.digest);
        const tmp = temporaryPath(row.object_id);
        const filePath = existsSync(target)
          ? target
          : existsSync(tmp)
            ? tmp
            : null;
        if (!filePath) return null;

        return {
          stream: createReadStream(filePath),
          size: BigInt(row.size),
          mediaType: storedMediaType(row.media_type),
          digest: row.digest,
          revisionId: row.revision_id,
        };
      });
    },

    async reclaimAttachments(now: Date): Promise<number> {
      const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      let client: pg.PoolClient;
      try {
        client = await pool.connect();
      } catch {
        return 0;
      }

      try {
        const candidatesResult = await client.query<{
          id: string;
          workspace_id: string;
          digest: string;
          state: string;
        }>(
          'SELECT id, workspace_id, digest, state FROM public.notesapp_reclaim_attachments($1)',
          [cutoff],
        );

        let count = 0;
        for (const candidate of candidatesResult.rows) {
          try {
            await client.query('begin');
            await client.query(
              'select pg_advisory_xact_lock(hashtext($1::text)::bigint)',
              [candidate.workspace_id],
            );

            // A reference may have appeared after the candidate was listed.
            const refResult = await client.query<{ exists: boolean }>(
              'SELECT public.notesapp_has_attachment_content_ref($1, $2) as exists',
              [candidate.workspace_id, candidate.id],
            );
            if (refResult.rows[0]?.exists) {
              await client.query('rollback');
              continue;
            }

            // The mark claims the row for this run. A second run, and a run in
            // another process, gets no row and therefore deletes no bytes.
            const updated = await client.query<{ ok: boolean }>(
              'SELECT public.notesapp_mark_attachment_unavailable($1, $2) as ok',
              [candidate.workspace_id, candidate.id],
            );
            if (!updated.rows[0]?.ok) {
              await client.query('rollback');
              continue;
            }

            await options.onReclaimMarked?.(candidate.id);

            // The digest check and both deletions stay inside this locked
            // transaction. A finalize of another object with the same digest
            // holds the same workspace lock, so it cannot pass between the
            // check and the deletion and lose its bytes. It waits, sees no
            // file at the immutable path, and moves its own upload there.
            const digestStillUsed = await client.query<{ exists: boolean }>(
              'SELECT public.notesapp_is_attachment_digest_used($1, $2) as exists',
              [candidate.workspace_id, candidate.digest],
            );

            await removeFile(temporaryPath(candidate.id));
            if (
              !digestStillUsed.rows[0]?.exists &&
              isDigest(candidate.digest) &&
              isUuid(candidate.workspace_id)
            ) {
              await removeFile(
                immutablePath(candidate.workspace_id, candidate.digest),
              );
            }

            await client.query('commit');
            count++;
          } catch {
            try {
              await client.query('rollback');
            } catch {
              // The connection is unusable; the next run repeats the work.
            }
          }
        }

        return count + (await reclaimDeletedWorkspaces(client));
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
