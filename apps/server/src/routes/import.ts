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
 * Record 0170 bounds the rest:
 *
 * - One import of an account and a few of the installation run at once.
 * - A body longer than the bound is refused from `Content-Length`, and a body
 *   that the free space less `archiveDiskReserveBytes` cannot hold is refused
 *   with 507, before a byte of it is read.
 * - A body that stops ends the import, and its file closes.
 * - Every entry is checked before the first commit: the paths in NFC, each
 *   free and each once, each note under the limits of the grammar, each
 *   image, and the room of the owner. Only a failure of the service stops the
 *   import after its first commit, and the answer states what came in.
 *
 * Then one entry at a time expands, and the notes go in batches that
 * `maxFilesPerChangeset` and `noteBatchBytes` bound, so the memory of an
 * import is one batch of notes or one image.
 *
 * An Obsidian vault imports as well (record 0172). `import-layout.ts` leaves
 * out the settings of a tool and every file that is neither a note nor a
 * picture, and the answer names them. It moves a picture beside a note into
 * `attachments/`, and turns each wiki link whose target is in the archive
 * into a standard link. The check parses each note, and counts its size, as
 * the commit writes it.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  statfs,
  unlink,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Busboy } from '@fastify/busboy';
import type { FastifyRequest } from 'fastify';
import {
  attachmentMediaTypeOf,
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
  type AttachmentMediaType,
  type ChangesetInput,
  type WorkspaceStore,
} from '@notesapp/core';
import {
  MarkdownLimitError,
  markdownLimits,
  parseMarkdown,
} from '@notesapp/markdown';
import {
  writeChargeBytes,
  type AttachmentStore,
} from '@notesapp/storage-server';
import { requireActor } from '../auth/actor.ts';
import { inspectImage } from '../jobs/inspect-image.ts';
import { watchBodyIdle } from '../plugins/body-idle-timeout.ts';
import {
  ArchiveRefusedError,
  DomainProblemError,
  ForbiddenError,
  ImportIncompleteError,
  InvalidContentError,
  PayloadTooLargeError,
  RequestContractError,
  RequestTimeoutError,
  StorageFullError,
  UnsupportedMediaTypeError,
} from '../plugins/problem.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';
import { mebibyte } from '../config.ts';
import { openArchiveFile, writeArchiveFile } from './archive-file.ts';
import { reserveArchiveJob, type ArchiveJobs } from './archive-jobs.ts';
import {
  archiveLinks,
  entryRole,
  importedNoteText,
  placedPictures,
  skippedFiles,
  utf8Bytes,
  type ArchiveLinks,
  type SkippedFiles,
} from './import-layout.ts';
import { readText } from './files.ts';
import {
  fileSource,
  readArchiveDirectory,
  readArchiveEntry,
  type ArchiveEntry,
  type ArchiveSource,
} from './unzip.ts';

/**
 * The most bytes of Markdown that one changeset of an import holds.
 *
 * A batch of notes is in memory while it commits, so it ends at this size as
 * well as at `maxFilesPerChangeset` files.
 */
const noteBatchBytes = 32 * mebibyte;

/**
 * The free space that an import leaves on the storage volume.
 *
 * The volume also holds the attachments and, on a small installation, the
 * database, so an import never fills it.
 */
export const archiveDiskReserveBytes = 512 * mebibyte;

/** The sentence of a body past the bound of one archive. */
function archiveTooLarge(): PayloadTooLargeError {
  return new PayloadTooLargeError(
    `The workspace archive is larger than ${String(Math.floor(maxArchiveBytes / mebibyte))} MiB.`,
  );
}

function busboyHeaders(request: FastifyRequest): { 'content-type': string } {
  const value = request.headers['content-type'];
  if (typeof value !== 'string')
    throw new UnsupportedMediaTypeError('The import needs a multipart body.');
  return { 'content-type': value };
}

/**
 * Why a body is refused before it is read, or `null` (record 0170).
 *
 * A body longer than the bound is too large. A body that the storage volume,
 * less `archiveDiskReserveBytes`, cannot hold has no room. A body with no
 * length could be as long as the bound, so the volume must hold the bound for
 * it.
 */
export function bodyRoomRefusal(
  statedBytes: number | null,
  bodyBytes: number,
  freeBytes: number,
): 'too_large' | 'no_room' | null {
  if (statedBytes !== null && statedBytes > bodyBytes) return 'too_large';
  const wanted = (statedBytes ?? bodyBytes) + archiveDiskReserveBytes;
  return freeBytes < wanted ? 'no_room' : null;
}

/** Refuses a body before it is read, by the rule of `bodyRoomRefusal`. */
async function checkBodyRoom(
  request: FastifyRequest,
  folder: string,
  bodyBytes: number,
): Promise<void> {
  const stated = Number(request.headers['content-length']);
  const known = Number.isSafeInteger(stated) && stated >= 0 ? stated : null;
  if (known !== null && known > bodyBytes) throw archiveTooLarge();
  await mkdir(folder, { recursive: true });
  const volume = await statfs(folder);
  const refusal = bodyRoomRefusal(
    known,
    bodyBytes,
    volume.bavail * volume.bsize,
  );
  if (refusal === 'too_large') throw archiveTooLarge();
  if (refusal === 'no_room')
    throw new StorageFullError(
      'The server has no room for this zip file now. Try again later, or ask the administrator for more room.',
    );
}

/**
 * Writes the one archive file of a bounded multipart request to `handle`,
 * and answers its size.
 *
 * The gap between two chunks is bounded, as it is for an upload. A sender
 * that stops in the middle used to hold its slot until the total receive
 * bound fired. `plugins/body-idle-timeout.ts` states why the bound is the gap
 * and not the whole: a big archive over a slow link is not an attack. A body
 * that ends before it is whole, because the sender closed its connection,
 * ends the read through `pipeline`, which destroys the parser, so the import
 * ends and its file closes.
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
      failure = archiveTooLarge();
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
  idle.catch(() => undefined);
  const parsed = new Promise<void>((resolve, reject) => {
    parser.on('finish', resolve);
    parser.on('error', reject);
    pipeline(request.raw, parser).catch(reject);
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
  } catch {
    if (failure !== null) throw failure;
    throw new RequestTimeoutError(
      'The import stopped before the whole archive came. Send the archive again.',
    );
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

/** The image type that the name of an entry states, from the list of core. */
function mediaType(path: string): string | null {
  return attachmentMediaTypeOf(path);
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

/** One file of the archive that passed every check, at its stored path. */
type CheckedEntry = {
  readonly entry: ArchiveEntry;
  /** The path in NFC, as the workspace stores it. */
  readonly path: string;
  /**
   * The bytes that the workspace stores: the text after its links are
   * rewritten for a note (record 0172), the bytes of the archive for an
   * image.
   */
  readonly bytes: number;
};

/** One image that passed its inspection, with what the store needs of it. */
type CheckedImage = CheckedEntry & {
  readonly digest: string;
  readonly mediaType: AttachmentMediaType;
  readonly width: number;
  readonly height: number;
};

/** A path in NFC, or a refusal that names the kind. */
function storedPath(path: string, kind: 'note' | 'attachment'): string {
  const normalized = normalizePath(path, kind);
  if (!normalized.ok)
    throw new InvalidContentError(
      kind === 'note'
        ? 'The archive has an invalid note path.'
        : 'The archive has an invalid attachment path.',
    );
  return normalized.value;
}

/** Inspects one image of the archive in a file of its own, then removes it. */
async function inspectEntry(
  source: ArchiveSource,
  checked: CheckedEntry,
  declaredType: string,
  attachments: AttachmentStore,
): Promise<CheckedImage> {
  const bytes = await readArchiveEntry(source, checked.entry);
  const path = attachments.temporaryPath(`inspect-${randomUUID()}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  try {
    const inspection = await inspectImage(path, declaredType);
    if (!inspection.ok) throw new InvalidContentError(inspection.reason);
    return {
      ...checked,
      digest: createHash('sha256').update(bytes).digest('hex'),
      mediaType: inspection.mediaType,
      width: inspection.width,
      height: inspection.height,
    };
  } finally {
    await unlink(path).catch(() => undefined);
  }
}

/** Commits one checked image of the archive. */
async function importAttachment(
  source: ArchiveSource,
  image: CheckedImage,
  context: ImportContext,
): Promise<void> {
  const { actor, workspaceId, store, attachments } = context;
  const bytes = await readArchiveEntry(source, image.entry);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== image.digest)
    throw new Error('notesapp: an image of the import changed in its file.');
  const objectId = randomUUID();
  const temporaryPath = attachments.temporaryPath(objectId);
  await mkdir(dirname(temporaryPath), { recursive: true });
  await writeFile(temporaryPath, bytes);
  await attachments.saveTemporaryAttachment(actor, workspaceId, {
    id: objectId,
    digest,
    size: BigInt(bytes.length),
    mediaType: image.mediaType,
    width: image.width,
    height: image.height,
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
    path: image.path,
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

/** The batches of notes that the commits take, in archive order. */
function noteBatches(
  notes: readonly CheckedEntry[],
): readonly (readonly CheckedEntry[])[] {
  const batches: CheckedEntry[][] = [];
  let batch: CheckedEntry[] = [];
  let bytes = 0;
  for (const note of notes) {
    if (
      batch.length === maxFilesPerChangeset ||
      (batch.length > 0 && bytes + note.bytes > noteBatchBytes)
    ) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(note);
    bytes += note.bytes;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** Commits one batch of notes as one changeset. */
async function importNoteBatch(
  source: ArchiveSource,
  notes: readonly CheckedEntry[],
  links: ArchiveLinks,
  context: ImportContext,
): Promise<void> {
  const { actor, workspaceId, store } = context;
  const revisions: ChangesetInput['revisions'][number][] = [];
  const expectedHeads: Record<string, null> = {};
  for (const note of notes) {
    const text = importedNoteText(
      (await readArchiveEntry(source, note.entry)).toString('utf8'),
      note.path,
      links,
    );
    const fileId = randomUUID();
    const built = createFileChangeset({
      workspaceId,
      fileId,
      revisionId: randomUUID(),
      path: note.path,
      // An import starts the document of the note on the server (record 0084).
      content: workspaceText(text, 1),
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

/** What one import works on. */
type ImportContext = {
  readonly actor: Actor;
  readonly workspaceId: string;
  readonly store: WorkspaceStore;
  readonly attachments: AttachmentStore;
};

/** What one import commits, after every check passed. */
type ImportPlan = {
  readonly notes: readonly CheckedEntry[];
  readonly images: readonly CheckedImage[];
  /** The pictures that move and the wiki links of the archive (record 0172). */
  readonly links: ArchiveLinks;
  /** The files of the archive that the import leaves out (record 0172). */
  readonly skipped: SkippedFiles;
};

/**
 * Checks every entry of an archive before the first commit (record 0170).
 *
 * A refusal here leaves the workspace as it was. Each note is read and parsed
 * once under the limits of the grammar, as the commit parses it, and each
 * image is inspected, so a commit later fails only for a cause of the service.
 */
async function checkArchive(
  source: ArchiveSource,
  entries: readonly ArchiveEntry[],
  context: ImportContext,
  attachmentBytes: number,
): Promise<ImportPlan> {
  const noteEntries: { entry: ArchiveEntry; path: string }[] = [];
  const imageEntries: { entry: ArchiveEntry; type: string }[] = [];
  const left: string[] = [];
  // A note and a picture come in. The settings of a tool and every other
  // kind of file stay out, and the answer names them (record 0172).
  for (const entry of entries) {
    const role = entryRole(entry.path);
    if (role === 'skipped') {
      left.push(entry.path);
      continue;
    }
    checkEntrySize(entry, attachmentBytes);
    // A note has no media type and a picture has one, as the role reads it.
    const type = mediaType(entry.path);
    if (type === null)
      noteEntries.push({ entry, path: storedPath(entry.path, 'note') });
    else imageEntries.push({ entry, type });
  }
  // A picture beside a note takes its place in the attachments folder, under
  // a free name when that place is taken.
  const placed = placedPictures(
    imageEntries.map((item) => item.entry.path.normalize('NFC')),
    noteEntries.map((note) => note.path),
  );
  const imageChecks = imageEntries.map((item) => ({
    checked: {
      entry: item.entry,
      path: storedPath(
        placed.get(item.entry.path.normalize('NFC')) ?? item.entry.path,
        'attachment',
      ),
      bytes: item.entry.size,
    },
    type: item.type,
  }));
  // The workspace stores a path in NFC, so two names of one path in another
  // form are one file, and a name in another form of a live file is that file.
  const seen = new Set<string>();
  for (const path of [
    ...noteEntries.map((note) => note.path),
    ...imageChecks.map((item) => item.checked.path),
  ]) {
    if (seen.has(path))
      throw new InvalidContentError('The archive holds one path twice.');
    seen.add(path);
  }
  const taken = await livePaths(
    context.store,
    context.actor,
    context.workspaceId,
  );
  if ([...seen].some((path) => taken.has(path)))
    throw new DomainProblemError({ code: 'path_conflict', fileIds: [] });
  const links = archiveLinks(
    noteEntries.map((note) => note.path),
    placed,
  );
  const notes: CheckedEntry[] = [];
  for (const note of noteEntries) {
    // The text that the commit takes is the text that this check parses and
    // the room of the workspace counts.
    const text = importedNoteText(
      (await readArchiveEntry(source, note.entry)).toString('utf8'),
      note.path,
      links,
    );
    try {
      parseMarkdown(text);
    } catch (error) {
      if (error instanceof MarkdownLimitError)
        throw new DomainProblemError({ code: 'note_too_large', fileIds: [] });
      throw error;
    }
    notes.push({ ...note, bytes: utf8Bytes(text) });
  }
  const images: CheckedImage[] = [];
  for (const { checked, type } of imageChecks)
    images.push(await inspectEntry(source, checked, type, context.attachments));
  const contentBytes = [...notes, ...images].reduce(
    (total, item) => total + BigInt(item.bytes),
    0n,
  );
  const charge = writeChargeBytes(
    contentBytes,
    notes.length + images.length,
    noteBatches(notes).length + images.length,
  );
  const room = await context.attachments.workspaceRoom(
    context.actor,
    context.workspaceId,
  );
  if (charge > room)
    throw new DomainProblemError({ code: 'quota', fileIds: [] });
  return { notes, images, links, skipped: skippedFiles(left) };
}

/** The phrase of a count of files, for example `1 file` and `3 files`. */
function filePhrase(count: number): string {
  return count === 1 ? '1 file' : `${String(count)} files`;
}

/**
 * Commits a checked archive, and names what came in when the service stops
 * it on the way.
 */
async function commitArchive(
  source: ArchiveSource,
  plan: ImportPlan,
  context: ImportContext,
): Promise<void> {
  const total = plan.notes.length + plan.images.length;
  let done = 0;
  try {
    for (const batch of noteBatches(plan.notes)) {
      await importNoteBatch(source, batch, plan.links, context);
      done += batch.length;
    }
    for (const image of plan.images) {
      await importAttachment(source, image, context);
      done += 1;
    }
  } catch (error) {
    if (done === 0) throw error;
    throw new ImportIncompleteError(
      `${filePhrase(done)} of ${String(total)} came in before the import stopped, and they stay in the workspace. Import a zip file of the other files to finish.`,
    );
  }
}

/**
 * Builds the portable workspace import handler.
 *
 * @param limits the largest image of one upload, from
 * `config.limits.attachmentBytes`, which bounds an image of an archive too,
 * the largest body of one import, from `config.limits.importBodyBytes`, and
 * the longest gap between two chunks of the archive body, from
 * `config.limits.uploadIdleTimeoutMs`. One idle bound serves both bodies that
 * this server streams, so a deployment states it once.
 */
export function createImportHandlers(
  store: WorkspaceStore,
  attachments: AttachmentStore,
  jobs: ArchiveJobs,
  limits: {
    readonly attachmentBytes: number;
    readonly importBodyBytes: number;
    readonly uploadIdleTimeoutMs: number;
  },
): HandlerMap {
  return {
    importWorkspace: async (request, reply): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const grant = actor.grants.find(
        (entry) => entry.workspaceId === workspaceId,
      );
      if (grant === undefined || !grant.actions.includes('write'))
        throw new ForbiddenError();
      await checkBodyRoom(
        request,
        dirname(attachments.temporaryPath('import')),
        limits.importBodyBytes,
      );
      const lease = await reserveArchiveJob(jobs, reply, actor.accountId);
      try {
        const handle = await openArchiveFile(attachments, 'import');
        try {
          const size = await receiveArchive(
            request,
            handle,
            limits.uploadIdleTimeoutMs,
          );
          const source = fileSource(handle, size);
          const entries = await readDirectory(source);
          const context = { actor, workspaceId, store, attachments };
          const plan = await checkArchive(
            source,
            entries,
            context,
            limits.attachmentBytes,
          );
          await commitArchive(source, plan, context);
          return {
            status: 200,
            mediaType: 'application/json',
            body: {
              notes: plan.notes.length,
              attachments: plan.images.length,
              skipped: plan.skipped,
            },
          };
        } finally {
          await handle.close();
        }
      } finally {
        await lease.release();
      }
    },
  };
}
