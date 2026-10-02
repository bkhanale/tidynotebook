/**
 * Import of one portable workspace tree from a ZIP archive.
 *
 * An import takes every archive that an export writes (issue 243). Both read
 * `maxArchiveEntries` and `maxArchiveBytes` of `@notesapp/core`, which are the
 * bounds of the zip format, so an archive of the largest export is an archive
 * of the largest import.
 *
 * Such an archive does not fit in memory, so the import keeps it in a file of
 * the server. The file is removed from its folder as soon as it is open, so it
 * leaves nothing behind when the import ends, fails, or the process stops.
 * The central directory is read and every entry checked before any file is
 * written to the workspace. Then one entry at a time expands, and the notes
 * go in batches that `maxFilesPerChangeset` and `noteBatchBytes` bound, so the
 * memory of an import is one batch of notes or one image.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Busboy } from '@fastify/busboy';
import type { FastifyRequest } from 'fastify';
import {
  commitChangeset,
  createAttachmentChangeset,
  createFileChangeset,
  listFiles,
  maxArchiveBytes,
  maxFilesPerChangeset,
  maxPageSize,
  workspaceText,
  normalizePath,
  type Actor,
  type ChangesetInput,
  type WorkspaceStore,
} from '@notesapp/core';
import { markdownLimits } from '@notesapp/markdown';
import type { AttachmentStore } from '@notesapp/storage-server';
import { requireActor } from '../auth/actor.ts';
import { inspectImage } from '../jobs/inspect-image.ts';
import { watchBodyIdle } from '../plugins/body-idle-timeout.ts';
import {
  ArchiveRefusedError,
  DomainProblemError,
  ForbiddenError,
  InvalidContentError,
  PayloadTooLargeError,
  RequestContractError,
  RequestTimeoutError,
  UnsupportedMediaTypeError,
} from '../plugins/problem.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';
import { mebibyte } from '../config.ts';
import { openArchiveFile, writeArchiveFile } from './archive-file.ts';
import { readText } from './files.ts';
import {
  fileSource,
  readArchiveDirectory,
  readArchiveEntry,
  type ArchiveEntry,
  type ArchiveSource,
} from './unzip.ts';

const imageTypes = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
] as const);

/**
 * The most bytes of Markdown that one changeset of an import holds.
 *
 * A batch of notes is in memory while it commits, so it ends at this size as
 * well as at `maxFilesPerChangeset` files.
 */
const noteBatchBytes = 32 * mebibyte;

function busboyHeaders(request: FastifyRequest): { 'content-type': string } {
  const value = request.headers['content-type'];
  if (typeof value !== 'string')
    throw new UnsupportedMediaTypeError('The import needs a multipart body.');
  return { 'content-type': value };
}

/**
 * Writes the one archive file of a bounded multipart request to `handle`,
 * and answers its size.
 *
 * The gap between two chunks is bounded, as it is for an upload. A sender
 * that stops in the middle used to hold its slot until the total receive
 * bound fired. `plugins/body-idle-timeout.ts` states why the bound is the gap
 * and not the whole: a big archive over a slow link is not an attack.
 */
async function receiveArchive(
  request: FastifyRequest,
  handle: FileHandle,
  idleMs: number,
): Promise<number> {
  let size = 0;
  let received = false;
  let failure: Error | null = null;
  const writes: Promise<void>[] = [];
  const parser = new Busboy({
    headers: busboyHeaders(request),
    limits: { fileSize: maxArchiveBytes, files: 1, parts: 5 },
  });
  parser.on('file', (_name, stream) => {
    if (received) {
      stream.resume();
      return;
    }
    received = true;
    stream.on('limit', () => {
      failure = new PayloadTooLargeError(
        `The workspace archive is larger than ${String(Math.floor(maxArchiveBytes / mebibyte))} MiB.`,
      );
    });
    const written = writeArchiveFile(handle, stream).then((bytes) => {
      size = bytes;
    });
    // A body that stops leaves its write behind, and the answer is the stop.
    written.catch(() => undefined);
    writes.push(written);
  });
  parser.on('filesLimit', () => {
    failure = new PayloadTooLargeError(
      'The import has too many archive files.',
    );
  });
  parser.on('partsLimit', () => {
    failure = new PayloadTooLargeError('The import has too many form parts.');
  });
  let idleReject: (error: Error) => void = () => {};
  const idle = new Promise<never>((_resolve, reject) => {
    idleReject = reject;
  });
  const parsed = new Promise<void>((resolve, reject) => {
    parser.on('finish', resolve);
    parser.on('error', reject);
    request.raw.pipe(parser);
  });
  // The bound is armed after the pipe, so no chunk of the body is lost to the
  // watch, and it is stopped in every exit of the read below.
  const watch = watchBodyIdle({
    body: request.raw,
    idleMs,
    onIdle: () => {
      const stopped = new RequestTimeoutError(
        'The import stopped. Send the archive again.',
      );
      failure ??= stopped;
      idleReject(stopped);
    },
  });
  try {
    await Promise.race([parsed, idle]);
    await Promise.race([Promise.all(writes), idle]);
  } finally {
    watch.stop();
  }
  if (failure !== null) throw failure;
  if (!received || size === 0)
    throw new RequestContractError('body', [
      { path: '/file', message: 'The archive file is missing.' },
    ]);
  return size;
}

function mediaType(path: string): string | null {
  const lower = path.toLowerCase();
  for (const [suffix, type] of imageTypes)
    if (lower.endsWith(suffix)) return type;
  return null;
}

async function livePaths(
  store: WorkspaceStore,
  actor: Actor,
  workspaceId: string,
): Promise<Set<string>> {
  const paths = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const page = await listFiles(store, actor, workspaceId, {
      cursor,
      limit: maxPageSize,
      sort: 'path',
    });
    if (!page.ok) throw new DomainProblemError(page.error);
    for (const file of page.value.files) paths.add(file.path);
    if (page.value.nextCursor === null) return paths;
    cursor = page.value.nextCursor;
  }
}

/**
 * Refuses an entry that is larger than the file that it becomes may be.
 *
 * A note is bounded by the grammar and an image by the upload bound, so an
 * export never writes a larger one, and an entry of another writer cannot
 * hold more memory than one note or one image.
 */
function checkEntrySize(entry: ArchiveEntry, attachmentBytes: number): void {
  const note = entry.path.endsWith('.md');
  const bound = note ? markdownLimits.maxInputBytes : attachmentBytes;
  if (entry.size <= bound) return;
  throw new ArchiveRefusedError(
    'archive_too_large',
    note
      ? `A note of one import holds ${String(bound / mebibyte)} MiB at the most.`
      : `An image of one import holds ${String(bound / mebibyte)} MiB at the most.`,
  );
}

async function importAttachment(
  entry: ArchiveEntry,
  bytes: Buffer,
  declaredType: string,
  actor: Actor,
  workspaceId: string,
  store: WorkspaceStore,
  attachments: AttachmentStore,
): Promise<void> {
  const objectId = randomUUID();
  const temporaryPath = attachments.temporaryPath(objectId);
  await mkdir(dirname(temporaryPath), { recursive: true });
  await writeFile(temporaryPath, bytes);
  const inspection = await inspectImage(temporaryPath, declaredType);
  if (!inspection.ok) {
    await unlink(temporaryPath).catch(() => undefined);
    throw new InvalidContentError(inspection.reason);
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  await attachments.saveTemporaryAttachment(actor, workspaceId, {
    id: objectId,
    digest,
    size: BigInt(bytes.length),
    mediaType: inspection.mediaType,
    width: inspection.width,
    height: inspection.height,
  });
  const finalized = await attachments.finalizeAttachmentObject(
    actor,
    workspaceId,
    objectId,
    digest,
  );
  if (!finalized.ok)
    throw new InvalidContentError('The imported image did not finalize.');
  const input = createAttachmentChangeset({
    workspaceId,
    fileId: randomUUID(),
    revisionId: randomUUID(),
    path: entry.path,
    objectId,
    digest,
    expectedHead: null,
    message: 'Import attachment.',
    ids: {
      mutationId: randomUUID(),
      deviceId: 'workspace-import',
      clientTime: new Date().toISOString(),
    },
  });
  const accepted = await commitChangeset(
    store,
    actor,
    input,
    `workspace-import-${input.mutationId}`,
  );
  if (!accepted.ok) throw new DomainProblemError(accepted.error);
}

/**
 * Commits the notes of an archive, in changesets of bounded size.
 *
 * `maxFilesPerChangeset` bounds every changeset, and an archive can hold up
 * to `maxArchiveEntries` files, so the notes go in batches (issue 243). A
 * batch also ends at `noteBatchBytes`, so it holds a bounded memory. The
 * paths were checked free before the first batch, so a batch fails only for
 * a cause that the answer names, such as the room of the account.
 */
async function importNotes(
  source: ArchiveSource,
  entries: readonly ArchiveEntry[],
  actor: Actor,
  workspaceId: string,
  store: WorkspaceStore,
): Promise<void> {
  let batch: { readonly path: string; readonly text: string }[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (
      batch.length === maxFilesPerChangeset ||
      (batch.length > 0 && bytes + entry.size > noteBatchBytes)
    ) {
      await importNoteBatch(batch, actor, workspaceId, store);
      batch = [];
      bytes = 0;
    }
    const content = await readArchiveEntry(source, entry);
    batch.push({ path: entry.path, text: content.toString('utf8') });
    bytes += entry.size;
  }
  if (batch.length > 0) await importNoteBatch(batch, actor, workspaceId, store);
}

/** Commits one batch of notes as one changeset. */
async function importNoteBatch(
  notes: readonly { readonly path: string; readonly text: string }[],
  actor: Actor,
  workspaceId: string,
  store: WorkspaceStore,
): Promise<void> {
  const revisions: ChangesetInput['revisions'][number][] = [];
  const expectedHeads: Record<string, null> = {};
  for (const note of notes) {
    const fileId = randomUUID();
    const built = createFileChangeset({
      workspaceId,
      fileId,
      revisionId: randomUUID(),
      path: note.path,
      // An import starts the document of the note on the server (record 0084).
      content: workspaceText(note.text, 1),
      message: 'Import note.',
      ids: {
        mutationId: randomUUID(),
        deviceId: 'workspace-import',
        clientTime: new Date().toISOString(),
      },
    });
    expectedHeads[fileId] = null;
    revisions.push(...built.revisions);
  }
  const input: ChangesetInput = {
    workspaceId,
    mutationId: randomUUID(),
    deviceId: 'workspace-import',
    expectedHeads,
    revisions,
  };
  const accepted = await commitChangeset(
    store,
    actor,
    input,
    `workspace-import-${input.mutationId}`,
  );
  if (!accepted.ok) throw new DomainProblemError(accepted.error);
}

/** The files of an archive, checked, or the refusal that names the cause. */
async function readDirectory(
  source: ArchiveSource,
): Promise<readonly ArchiveEntry[]> {
  try {
    return await readArchiveDirectory(source);
  } catch (error) {
    // The reader names each cause it knows (issue 243). Anything else that
    // it meets is an archive it cannot read, which is never a digest that
    // does not match.
    if (error instanceof ArchiveRefusedError) throw error;
    throw new ArchiveRefusedError(
      'archive_invalid',
      'The file is not a zip archive that this server can read.',
    );
  }
}

/**
 * Builds the portable workspace import handler.
 *
 * @param limits the largest image of one upload, from
 * `config.limits.attachmentBytes`, which bounds an image of an archive too,
 * and the longest gap between two chunks of the archive body, from
 * `config.limits.uploadIdleTimeoutMs`. One idle bound serves both bodies that
 * this server streams, so a deployment states it once.
 */
export function createImportHandlers(
  store: WorkspaceStore,
  attachments: AttachmentStore,
  limits: {
    readonly attachmentBytes: number;
    readonly uploadIdleTimeoutMs: number;
  },
): HandlerMap {
  return {
    importWorkspace: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const grant = actor.grants.find(
        (entry) => entry.workspaceId === workspaceId,
      );
      if (grant === undefined || !grant.actions.includes('write'))
        throw new ForbiddenError();
      const handle = await openArchiveFile(attachments, 'import');
      try {
        const size = await receiveArchive(
          request,
          handle,
          limits.uploadIdleTimeoutMs,
        );
        const source = fileSource(handle, size);
        const entries = await readDirectory(source);
        const notes = entries.filter((entry) => entry.path.endsWith('.md'));
        const images = entries.filter(
          (entry) => mediaType(entry.path) !== null,
        );
        if (notes.length + images.length !== entries.length)
          throw new UnsupportedMediaTypeError(
            'The archive can contain Markdown and image files only.',
          );
        if (images.some((entry) => !entry.path.startsWith('attachments/')))
          throw new InvalidContentError(
            'An imported image must be in the attachments folder.',
          );
        for (const entry of notes) {
          if (!normalizePath(entry.path, 'note').ok)
            throw new InvalidContentError(
              'The archive has an invalid note path.',
            );
        }
        for (const entry of images) {
          if (!normalizePath(entry.path, 'attachment').ok)
            throw new InvalidContentError(
              'The archive has an invalid attachment path.',
            );
        }
        for (const entry of entries)
          checkEntrySize(entry, limits.attachmentBytes);
        const taken = await livePaths(store, actor, workspaceId);
        const conflicts = entries.filter((entry) => taken.has(entry.path));
        if (conflicts.length > 0)
          throw new DomainProblemError({ code: 'path_conflict', fileIds: [] });
        await importNotes(source, notes, actor, workspaceId, store);
        for (const entry of images) {
          const type = mediaType(entry.path);
          if (type === null) continue;
          await importAttachment(
            entry,
            await readArchiveEntry(source, entry),
            type,
            actor,
            workspaceId,
            store,
            attachments,
          );
        }
        return {
          status: 200,
          mediaType: 'application/json',
          body: { notes: notes.length, attachments: images.length },
        };
      } finally {
        await handle.close();
      }
    },
  };
}
