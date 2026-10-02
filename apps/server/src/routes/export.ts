/**
 * Handlers of the two export operations.
 *
 * Export is the promise that the file is the document: nothing is stored that
 * the person cannot take away as plain Markdown. One note leaves as one
 * Markdown file, and the whole workspace leaves as a zip of Markdown files in
 * their folders plus every live image file. Nothing in an
 * archive needs this application to be read again.
 *
 * The archive is produced as a stream into a file of the server. One note or
 * one image is held in memory at a time, and the listing is paged, so an
 * export of many notes does not build the whole answer in memory. The file is
 * sent once it is whole, so a refusal is an answer and never a broken file.
 */
import { Buffer } from 'node:buffer';
import type { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import type { FilePage, WorkspaceStore } from '@notesapp/core';
import { listFiles, readFile, readRevision } from '@notesapp/core';
import type { AttachmentStore } from '@notesapp/storage-server';
import { requireActor } from '../auth/actor.ts';
import { readText } from './files.ts';
import { NotFoundError, unwrapDomain } from '../plugins/problem.ts';
import {
  contentDisposition,
  dispositionKind,
  downloadName,
} from '../plugins/content-disposition.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';
import {
  openArchiveFile,
  readArchiveFile,
  writeArchiveFile,
} from './archive-file.ts';
import { zipArchive, type ZipEntry } from './zip.ts';

/** Media type of one exported note. */
const markdownMediaType = 'text/markdown';

/** Media type of the whole workspace export. */
const archiveMediaType = 'application/zip';

/** Download name of the whole workspace export. */
const archiveName = 'notes.zip';

/** How many files one page of the export listing reads. */
const exportPageSize = 200;

/**
 * The header of one export download.
 *
 * Neither export is an image, so `dispositionKind` answers `attachment` for
 * both and the browser saves the file. The name is encoded by the one
 * function of `plugins/content-disposition.ts`, so the export path and the
 * attachment path cannot drift apart.
 */
function exportDisposition(input: {
  readonly path: string;
  readonly mediaType: string;
  readonly fallback: string;
}): string {
  return contentDisposition({
    kind: dispositionKind(input.mediaType),
    name: downloadName(input.path),
    fallback: input.fallback,
  });
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
      const page: FilePage = unwrapDomain(
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
        const head = unwrapDomain(
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
      const found = unwrapDomain(
        await readFile(store, actor, workspaceId, fileId),
      );
      const text = found.head?.text;
      if (found.file.kind !== 'note' || typeof text !== 'string')
        throw new NotFoundError('This file holds no Markdown to export.');
      return {
        status: 200,
        mediaType: markdownMediaType,
        body: Buffer.from(text, 'utf8'),
        headers: [
          [
            'content-disposition',
            exportDisposition({
              path: found.file.path,
              mediaType: markdownMediaType,
              fallback: 'note.md',
            }),
          ],
        ],
      };
    },

    exportWorkspace: async (request): Promise<HandlerResult> => {
      const workspaceId = readText(request.params, 'workspaceId');
      // The whole archive is written before the answer, so a workspace past
      // a bound of the format is refused with an answer of its own instead of
      // a download that stops in the middle, and the answer states its length
      // (issue 243).
      const handle = await openArchiveFile(attachments, 'export');
      let size: number;
      try {
        size = await writeArchiveFile(
          handle,
          zipArchive(archiveEntries(request, workspaceId)),
        );
      } catch (error) {
        await handle.close();
        throw error;
      }
      return {
        status: 200,
        mediaType: archiveMediaType,
        // The stream closes the file when it ends or when the caller leaves.
        body: readArchiveFile(handle, size),
        headers: [
          [
            'content-disposition',
            exportDisposition({
              path: archiveName,
              mediaType: archiveMediaType,
              fallback: archiveName,
            }),
          ],
          ['content-length', String(size)],
          ['cache-control', 'no-store'],
        ],
      };
    },
  };
}
