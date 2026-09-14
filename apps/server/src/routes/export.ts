/**
 * Handlers of the two export operations.
 *
 * Export is the promise that the file is the document: nothing is stored that
 * the person cannot take away as plain Markdown. One note leaves as one
 * Markdown file, and the whole workspace leaves as a zip of Markdown files in
 * their folders plus the images that those notes reference. Nothing in an
 * archive needs this application to be read again.
 *
 * The archive is produced as a stream. One note or one image is held in
 * memory at a time, and the listing is paged, so an export of many notes does
 * not build the whole answer first.
 */
import { Buffer } from 'node:buffer';
import type { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import type { FilePage, Result, WorkspaceStore } from '@notesapp/core';
import { listFiles, readFile, readRevision } from '@notesapp/core';
import type { AttachmentStore } from '@notesapp/storage-server';
import { requireActor } from '../auth/actor.ts';
import { readText } from './files.ts';
import { DomainProblemError, NotFoundError } from '../plugins/problem.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';
import { zipArchive, type ZipEntry } from './zip.ts';

/** Media type of one exported note. */
const markdownMediaType = 'text/markdown';

/** Media type of the whole workspace export. */
const archiveMediaType = 'application/zip';

/** How many files one page of the export listing reads. */
const exportPageSize = 200;

/** Returns the value of a domain result, or answers with its failure. */
function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new DomainProblemError(result.error);
}

/**
 * The download name of one note.
 *
 * A path holds folders and can hold any character that the path rules permit,
 * so the last segment is taken and every character that a quoted header field
 * cannot carry is replaced. The header also states the name again in UTF-8,
 * because the quoted form is limited to ASCII.
 */
export function contentDisposition(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  // Every character that a quoted header field cannot carry becomes one
  // underscore. The pattern matches whole code points, so a character that
  // needs two units leaves no half behind.
  const safe = name.replaceAll(/["\\]|[^\u0020-\u007e]/gu, '_');
  const quoted = safe === '' ? 'note.md' : safe;
  return `attachment; filename="${quoted}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** The whole content of one readable stream. */
async function readAll(stream: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream)
    parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(parts);
}

/** Builds the export handlers. */
export function createExportHandlers(
  store: WorkspaceStore,
  attachments: AttachmentStore,
): HandlerMap {
  /**
   * Every entry of one workspace archive, in one pass over the listing.
   *
   * Every live file keeps its stored path and bytes. The archive is therefore
   * a copy of the portable tree and does not translate Markdown references.
   */
  async function* archiveEntries(
    request: FastifyRequest,
    workspaceId: string,
  ): AsyncGenerator<ZipEntry> {
    const actor = requireActor(request).actor;
    let cursor: string | null = null;
    for (;;) {
      const page: FilePage = unwrap(
        await listFiles(store, actor, workspaceId, {
          cursor,
          limit: exportPageSize,
          sort: 'path',
        }),
      );
      for (const file of page.files) {
        if (file.headRevisionId === null) continue;
        if (file.kind === 'attachment') {
          const found = await attachments.readAttachmentRevision(
            actor,
            workspaceId,
            file.headRevisionId,
          );
          if (found !== null)
            yield {
              path: file.path,
              bytes: await readAll(found.stream),
              modified: new Date(file.updatedAt),
            };
          continue;
        }
        const head = unwrap(
          await readRevision(store, actor, workspaceId, file.headRevisionId),
        );
        const text = head.text ?? '';
        yield {
          path: file.path,
          bytes: Buffer.from(text, 'utf8'),
          modified: new Date(file.updatedAt),
        };
      }
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
  }

  return {
    exportNote: async (request): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const fileId = readText(request.params, 'fileId');
      const found = unwrap(await readFile(store, actor, workspaceId, fileId));
      const text = found.head?.text;
      if (found.file.kind !== 'note' || typeof text !== 'string')
        throw new NotFoundError('This file holds no Markdown to export.');
      return {
        status: 200,
        mediaType: markdownMediaType,
        body: Buffer.from(text, 'utf8'),
        headers: [['content-disposition', contentDisposition(found.file.path)]],
      };
    },

    exportWorkspace: (request): Promise<HandlerResult> => {
      const workspaceId = readText(request.params, 'workspaceId');
      return Promise.resolve({
        status: 200,
        mediaType: archiveMediaType,
        body: zipArchive(archiveEntries(request, workspaceId)),
        headers: [
          ['content-disposition', contentDisposition('notes.zip')],
          // The archive is produced while it is sent, so its length is not
          // known when the headers leave.
          ['cache-control', 'no-store'],
        ],
      });
    },
  };
}
