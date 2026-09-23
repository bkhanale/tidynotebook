/**
 * The browser store as release 0.4 left it (record 0088).
 *
 * Release 0.4 queued a save of a note with its text, kept no document, and
 * recorded schema version 4. These helpers write exactly those rows into a
 * store, so a test opens what an upgraded browser opens. A queue row of 0.4
 * does not match the row type of this release, so it goes through the untyped
 * table of the database and never through a typed write.
 */
import { contentDigest } from '@notesapp/core';
import { createDatabase, metaKey } from '@notesapp/storage-browser';

/** The opened tables and database of one raw store. */
type RawStore = ReturnType<typeof createDatabase>;

/** One queued save of release 0.4 that changes the text of one note. */
export type Release04Save = {
  readonly serverOrigin: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly fileId: string;
  readonly mutationId: string;
  readonly revisionId: string;
  /** The revision this save follows: a checkpoint or a server head. */
  readonly parentId: string | null;
  /** The accepted head that the save states it replaces. */
  readonly expectedHead: string | null;
  readonly path: string;
  readonly text: string;
  readonly sequence: number;
  readonly state: 'pending' | 'sending' | 'conflict';
  readonly digest: string | null;
  /** Whether the save moves the note to Trash. Its text is then empty. */
  readonly deleted?: boolean;
};

/**
 * Writes one queued save of release 0.4 with its checkpoint and content.
 *
 * The file row moves its local head to the checkpoint, as 0.4 did, and the
 * working copy of the note holds the text of the save.
 */
export async function storeRelease04Save(
  raw: RawStore,
  save: Release04Save,
): Promise<void> {
  const { serverOrigin, accountId, workspaceId } = save;
  const deleted = save.deleted ?? false;
  const digest = await contentDigest(save.text);
  const clientTime = new Date().toISOString();
  await raw.tables.contents.put({
    serverOrigin,
    accountId,
    workspaceId,
    digest,
    text: save.text,
    bytes: null,
    size: new TextEncoder().encode(save.text).byteLength,
  });
  await raw.tables.checkpoints.put({
    serverOrigin,
    accountId,
    workspaceId,
    revisionId: save.revisionId,
    fileId: save.fileId,
    workingCopyId: `copy-${save.fileId}`,
    parents: save.parentId === null ? [] : [save.parentId],
    path: save.path,
    deleted,
    digest,
    message: null,
    clientTime,
    mutationId: save.mutationId,
    accepted: false,
    sequence: save.sequence,
  });
  const known = await raw.tables.acceptedFiles.get([
    serverOrigin,
    accountId,
    workspaceId,
    save.fileId,
  ]);
  await raw.tables.acceptedFiles.put({
    serverOrigin,
    accountId,
    workspaceId,
    fileId: save.fileId,
    kind: 'note',
    path: save.path,
    deleted,
    acceptedHeadRevisionId: known?.acceptedHeadRevisionId ?? null,
    acceptedHeadDigest: known?.acceptedHeadDigest ?? null,
    localHeadRevisionId: save.revisionId,
    updatedAt: clientTime,
  });
  await raw.db.table<Record<string, unknown>, unknown>('queue').put({
    serverOrigin,
    accountId,
    workspaceId,
    mutationId: save.mutationId,
    sequence: save.sequence,
    input: {
      workspaceId,
      mutationId: save.mutationId,
      deviceId: 'device-release-0-4',
      expectedHeads: { [save.fileId]: save.expectedHead },
      revisions: [
        {
          id: save.revisionId,
          fileId: save.fileId,
          parents: save.parentId === null ? [] : [save.parentId],
          path: save.path,
          deleted,
          content: { kind: 'markdown', digest, text: save.text },
          clientTime,
          message: null,
          restoredFrom: null,
        },
      ],
    },
    state: save.state,
    digest: save.digest,
    errorCode: null,
    createdAt: clientTime,
  });
  await raw.tables.drafts.put({
    serverOrigin,
    accountId,
    workspaceId,
    workingCopyId: `copy-${save.fileId}`,
    fileId: save.fileId,
    baseRevisionId: save.expectedHead,
    text: save.text,
    path: save.path,
    deleted,
    sequence: save.sequence,
    lastCheckpointId: save.revisionId,
    savedAt: clientTime,
  });
}

/**
 * Leaves the store as release 0.4 recorded it.
 *
 * Release 0.4 kept no document of a note, and it recorded schema version 4.
 * The cursor stays, because 0.4 kept its place in the change feed.
 */
export async function markRelease04(raw: RawStore): Promise<void> {
  await raw.tables.documents.clear();
  const meta = await raw.tables.meta.get(metaKey);
  if (meta === undefined) throw new Error('the store holds no meta record');
  await raw.tables.meta.put({ ...meta, schemaVersion: 4 });
}
