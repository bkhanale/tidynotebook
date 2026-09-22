/** Import of one portable workspace tree from a ZIP archive. */
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Busboy } from '@fastify/busboy';
import type { FastifyRequest } from 'fastify';
import {
  commitChangeset,
  createAttachmentChangeset,
  createFileChangeset,
  listFiles,
  workspaceText,
  normalizePath,
  type Actor,
  type ChangesetInput,
  type WorkspaceStore,
} from '@notesapp/core';
import type { AttachmentStore } from '@notesapp/storage-server';
import { requireActor } from '../auth/actor.ts';
import { inspectImage } from '../jobs/inspect-image.ts';
import { watchBodyIdle } from '../plugins/body-idle-timeout.ts';
import {
  DomainProblemError,
  ForbiddenError,
  InvalidContentError,
  PayloadTooLargeError,
  RequestContractError,
  RequestTimeoutError,
  UnsupportedMediaTypeError,
} from '../plugins/problem.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';
import { readText } from './files.ts';
import { unzipArchive, type UnzipEntry } from './unzip.ts';

const maxArchiveBytes = 100 * 1024 * 1024;
const imageTypes = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
] as const);

function busboyHeaders(request: FastifyRequest): { 'content-type': string } {
  const value = request.headers['content-type'];
  if (typeof value !== 'string')
    throw new UnsupportedMediaTypeError('The import needs a multipart body.');
  return { 'content-type': value };
}

/**
 * Reads the one archive file in a bounded multipart request.
 *
 * The gap between two chunks is bounded, as it is for an upload. A sender
 * that stops in the middle used to hold its slot until the total receive
 * bound fired, and the body limit of this route is four times the limit of
 * the upload route, so the slot was the more valuable one of the two.
 * `plugins/body-idle-timeout.ts` states why the bound is the gap and not the
 * whole: a big archive over a slow link is not an attack.
 */
async function archiveBytes(
  request: FastifyRequest,
  idleMs: number,
): Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;
  let received = false;
  let failure: Error | null = null;
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
    stream.on('data', (part: Buffer) => {
      size += part.length;
      if (size <= maxArchiveBytes) parts.push(Buffer.from(part));
    });
    stream.on('limit', () => {
      failure = new PayloadTooLargeError(
        'The workspace archive is larger than 100 MiB.',
      );
      stream.resume();
    });
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
  } finally {
    watch.stop();
  }
  if (failure !== null) throw failure;
  if (!received || size === 0)
    throw new RequestContractError('body', [
      { path: '/file', message: 'The archive file is missing.' },
    ]);
  return Buffer.concat(parts);
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
      limit: 500,
      sort: 'path',
    });
    if (!page.ok) throw new DomainProblemError(page.error);
    for (const file of page.value.files) paths.add(file.path);
    if (page.value.nextCursor === null) return paths;
    cursor = page.value.nextCursor;
  }
}

async function importAttachment(
  entry: UnzipEntry,
  declaredType: string,
  actor: Actor,
  workspaceId: string,
  store: WorkspaceStore,
  attachments: AttachmentStore,
): Promise<void> {
  const objectId = randomUUID();
  const temporaryPath = attachments.temporaryPath(objectId);
  await mkdir(dirname(temporaryPath), { recursive: true });
  await writeFile(temporaryPath, entry.bytes);
  const inspection = await inspectImage(temporaryPath, declaredType);
  if (!inspection.ok) {
    await unlink(temporaryPath).catch(() => undefined);
    throw new InvalidContentError(inspection.reason);
  }
  const digest = createHash('sha256').update(entry.bytes).digest('hex');
  await attachments.saveTemporaryAttachment(actor, workspaceId, {
    id: objectId,
    digest,
    size: BigInt(entry.bytes.length),
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

async function importNotes(
  entries: readonly UnzipEntry[],
  actor: Actor,
  workspaceId: string,
  store: WorkspaceStore,
): Promise<void> {
  if (entries.length === 0) return;
  const revisions: ChangesetInput['revisions'][number][] = [];
  const expectedHeads: Record<string, null> = {};
  for (const entry of entries) {
    const fileId = randomUUID();
    const built = createFileChangeset({
      workspaceId,
      fileId,
      revisionId: randomUUID(),
      path: entry.path,
      // An import starts the document of the note on the server (record 0084).
      content: workspaceText(entry.bytes.toString('utf8'), 1),
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

/**
 * Builds the portable workspace import handler.
 *
 * @param idleMs the longest gap between two chunks of the archive body, from
 * `config.limits.uploadIdleTimeoutMs`. One bound serves both bodies that this
 * server streams, so a deployment states it once.
 */
export function createImportHandlers(
  store: WorkspaceStore,
  attachments: AttachmentStore,
  idleMs: number,
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
      let entries: readonly UnzipEntry[];
      try {
        entries = unzipArchive(await archiveBytes(request, idleMs));
      } catch (error) {
        // A body that is too large and a body that stopped are answers of
        // their own. Only an archive that arrived whole and cannot be read is
        // invalid content.
        if (error instanceof PayloadTooLargeError) throw error;
        if (error instanceof RequestTimeoutError) throw error;
        if (error instanceof RequestContractError) throw error;
        if (error instanceof UnsupportedMediaTypeError) throw error;
        throw new InvalidContentError(
          error instanceof Error
            ? error.message
            : 'The workspace archive is not valid.',
        );
      }
      const notes = entries.filter((entry) => entry.path.endsWith('.md'));
      const images = entries.filter((entry) => mediaType(entry.path) !== null);
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
      const taken = await livePaths(store, actor, workspaceId);
      const conflicts = entries.filter((entry) => taken.has(entry.path));
      if (conflicts.length > 0)
        throw new DomainProblemError({ code: 'path_conflict', fileIds: [] });
      await importNotes(notes, actor, workspaceId, store);
      for (const entry of images) {
        const type = mediaType(entry.path);
        if (type === null) continue;
        await importAttachment(
          entry,
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
    },
  };
}
