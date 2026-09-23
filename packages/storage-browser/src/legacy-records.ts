/**
 * The records that release 0.4 left, and the steps that move them (record 0088).
 *
 * A queued save of release 0.4 holds the text of each note it changes. A save
 * of release 0.5 holds work on the document of the note, and text becomes
 * work only against the document that the server holds. The device holds no
 * document before its first snapshot after the upgrade, so the upgrade cannot
 * convert a save. It moves the save out of the queue, keeps the texts that the
 * save and the drafts start from, and leaves placement to
 * `./local-store/legacy.ts`.
 */
import type {
  LegacyBaseRow,
  LegacyDraftRow,
  LegacyRevision,
  LegacySaveRow,
  Tables,
} from './database.ts';
import {
  corrupt,
  count,
  flag,
  isWritableRecord,
  member,
  object,
  optionalText,
  partition,
  text,
  textList,
} from './record-fields.ts';

/** Narrows one revision of a save that release 0.4 queued. */
function validateLegacyRevision(value: unknown, where: string): LegacyRevision {
  const row = object(value, where);
  const content = object(row['content'], `${where}.content`);
  const kind = member(
    content,
    'kind',
    ['markdown', 'attachment'] as const,
    `${where}.content`,
  );
  return {
    id: text(row, 'id', where),
    fileId: text(row, 'fileId', where),
    parents: textList(row, 'parents', where),
    path: text(row, 'path', where),
    deleted: flag(row, 'deleted', where),
    content:
      kind === 'markdown'
        ? {
            kind,
            digest: text(content, 'digest', `${where}.content`),
            text: text(content, 'text', `${where}.content`),
          }
        : {
            kind,
            digest: text(content, 'digest', `${where}.content`),
            objectId: text(content, 'objectId', `${where}.content`),
          },
    clientTime: text(row, 'clientTime', where),
    message: optionalText(row, 'message', where),
    restoredFrom: optionalText(row, 'restoredFrom', where),
  };
}

/** Narrows the preconditions of one moved save. */
function expectedHeadsOf(
  row: Record<string, unknown>,
  where: string,
): Record<string, string | null> {
  const heads = object(row['expectedHeads'], `${where}.expectedHeads`);
  const expected: Record<string, string | null> = {};
  for (const [fileId, head] of Object.entries(heads)) {
    if (head !== null && typeof head !== 'string')
      corrupt(`${where}.expectedHeads.${fileId} is not a revision or null`);
    expected[fileId] = head;
  }
  return expected;
}

/** Narrows the revisions of one moved save. */
function revisionsOf(
  row: Record<string, unknown>,
  where: string,
): readonly LegacyRevision[] {
  const revisions: unknown = row['revisions'];
  if (!Array.isArray(revisions)) corrupt(`${where}.revisions is not a list`);
  const list: unknown[] = revisions;
  return list.map((entry: unknown, index: number) =>
    validateLegacyRevision(entry, `${where}.revisions[${String(index)}]`),
  );
}

/** Narrows one moved save of release 0.4. */
export function validateLegacySave(value: unknown): LegacySaveRow {
  const where = 'legacy save';
  const row = object(value, where);
  return {
    ...partition(row, where),
    mutationId: text(row, 'mutationId', where),
    sequence: count(row, 'sequence', where),
    deviceId: text(row, 'deviceId', where),
    expectedHeads: expectedHeadsOf(row, where),
    revisions: revisionsOf(row, where),
    state: member(row, 'state', ['pending', 'sending', 'conflict'], where),
    digest: optionalText(row, 'digest', where),
    createdAt: text(row, 'createdAt', where),
  };
}

/** Narrows one kept base text. */
export function validateLegacyBase(value: unknown): LegacyBaseRow {
  const where = 'legacy base';
  const row = object(value, where);
  return {
    ...partition(row, where),
    revisionId: text(row, 'revisionId', where),
    text: text(row, 'text', where),
  };
}

/** Narrows one marked working copy of release 0.4. */
export function validateLegacyDraft(value: unknown): LegacyDraftRow {
  const where = 'legacy draft';
  const row = object(value, where);
  return {
    ...partition(row, where),
    workingCopyId: text(row, 'workingCopyId', where),
    fileId: text(row, 'fileId', where),
  };
}

/**
 * Whether one stored queue entry holds a note revision in the shape of 0.4.
 *
 * Such a revision carries text and no document work. An entry that changes
 * only attachments has the same shape in both releases and stays queued.
 */
function holdsLegacyText(value: Record<string, unknown>): boolean {
  const input: unknown = value['input'];
  if (!isWritableRecord(input)) return false;
  const revisions: unknown = input['revisions'];
  if (!Array.isArray(revisions)) return false;
  const list: unknown[] = revisions;
  return list.some((revision: unknown) => {
    if (!isWritableRecord(revision)) return false;
    const content: unknown = revision['content'];
    return (
      isWritableRecord(content) &&
      content['kind'] === 'markdown' &&
      !('document' in content)
    );
  });
}

/**
 * Removes every change position and every staged snapshot.
 *
 * The documents of version 5 arrive with a snapshot, and a cursor would make
 * the next pull read only the feed after it. Without a cursor the next pull
 * reads a full snapshot, which carries the whole document of every note.
 */
export async function removeChangePositions(tables: Tables): Promise<void> {
  await tables.cursors.clear();
  await tables.stagedSnapshots.clear();
  await tables.snapshotItems.clear();
}

/**
 * Keeps the text of one server revision that earlier work starts from.
 *
 * A local checkpoint keeps its own text, so only a revision that another
 * device or the server made is kept here. The mirror still names the head
 * it knew, which is the head that the earlier work was written over.
 */
async function keepBaseText(
  tables: Tables,
  key: {
    readonly serverOrigin: string;
    readonly accountId: string;
    readonly workspaceId: string;
  },
  fileId: string,
  revisionId: string | null,
): Promise<void> {
  if (revisionId === null) return;
  const { serverOrigin, accountId, workspaceId } = key;
  const local: unknown = await tables.checkpoints.get([
    serverOrigin,
    accountId,
    workspaceId,
    revisionId,
  ]);
  if (local !== undefined) return;
  const stored: unknown = await tables.acceptedFiles.get([
    serverOrigin,
    accountId,
    workspaceId,
    fileId,
  ]);
  if (!isWritableRecord(stored)) return;
  if (stored['acceptedHeadRevisionId'] !== revisionId) return;
  const digest: unknown = stored['acceptedHeadDigest'];
  if (typeof digest !== 'string') return;
  const content: unknown = await tables.contents.get([
    serverOrigin,
    accountId,
    workspaceId,
    digest,
  ]);
  if (!isWritableRecord(content)) return;
  const body: unknown = content['text'];
  if (typeof body !== 'string') return;
  await tables.legacyBases.put({
    serverOrigin,
    accountId,
    workspaceId,
    revisionId,
    text: body,
  });
}

/**
 * Moves the saves and drafts of release 0.4 out of the way of version 5.
 *
 * Each queued save that holds text leaves the queue for `legacySaves`, with
 * its identity, its order, its state and its frozen digest. Each draft is
 * marked, because its text was written over a head that the snapshot after
 * the upgrade replaces. The base text of every such save and draft is kept
 * while the mirror still knows it.
 */
export async function moveLegacyWork(tables: Tables): Promise<void> {
  const queued: unknown[] = await tables.queue.toArray();
  for (const value of queued) {
    // A record that is not a record at all stays, and revalidation refuses it.
    if (!isWritableRecord(value) || !holdsLegacyText(value)) continue;
    const where = 'queue entry';
    const input = object(value['input'], `${where}.input`);
    const save: LegacySaveRow = {
      ...partition(value, where),
      mutationId: text(value, 'mutationId', where),
      sequence: count(value, 'sequence', where),
      deviceId: text(input, 'deviceId', `${where}.input`),
      expectedHeads: expectedHeadsOf(input, `${where}.input`),
      revisions: revisionsOf(input, `${where}.input`),
      state: member(value, 'state', ['pending', 'sending', 'conflict'], where),
      digest: optionalText(value, 'digest', where),
      createdAt: text(value, 'createdAt', where),
    };
    await tables.legacySaves.put(save);
    await tables.queue.delete([
      save.serverOrigin,
      save.accountId,
      save.workspaceId,
      save.mutationId,
    ]);
    for (const revision of save.revisions)
      if (revision.content.kind === 'markdown')
        await keepBaseText(
          tables,
          save,
          revision.fileId,
          revision.parents[0] ?? null,
        );
  }
  const drafts: unknown[] = await tables.drafts.toArray();
  for (const value of drafts) {
    if (!isWritableRecord(value)) continue;
    const where = 'draft';
    const draft = {
      ...partition(value, where),
      workingCopyId: text(value, 'workingCopyId', where),
      fileId: text(value, 'fileId', where),
    };
    await tables.legacyDrafts.put(draft);
    await keepBaseText(
      tables,
      draft,
      draft.fileId,
      optionalText(value, 'lastCheckpointId', where) ??
        optionalText(value, 'baseRevisionId', where),
    );
  }
}
