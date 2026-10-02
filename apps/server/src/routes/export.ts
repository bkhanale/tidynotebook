/**
 * Handlers of the two export operations.
 *
 * Export is the promise that the file is the document: nothing is stored that
 * the person cannot take away as plain Markdown. One note leaves as one
 * Markdown file, and the whole workspace leaves as a zip of Markdown files in
 * their folders plus every live image file. Nothing in an
 * archive needs this application to be read again.
 *
 * The export of a workspace plans its archive before its first byte: the
 * path and the size of the head of every live file (record 0160). A workspace
 * past a bound of the format is refused at once with an answer of its own.
 * Otherwise the answer states the exact length of the archive and streams it
 * while it is written, one note or one image in memory at a time, from the
 * planned revisions, which never change. No file of the server holds it, and
 * the first byte leaves at once, so a proxy that waits for it does not give
 * up. `HEAD` plans and sends no body.
 */
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import type { FastifyReply } from 'fastify';
import type { Actor, WorkspaceStore } from '@notesapp/core';
import {
  archiveBytesAllowed,
  listFiles,
  maxArchiveBytes,
  maxArchiveEntries,
  readFile,
  readRevision,
} from '@notesapp/core';
import type { ArchivePlanRow, AttachmentStore } from '@notesapp/storage-server';
import { requireActor } from '../auth/actor.ts';
import { readText } from './files.ts';
import {
  ExportTooLargeError,
  NotFoundError,
  unwrapDomain,
} from '../plugins/problem.ts';
import {
  contentDisposition,
  dispositionKind,
  downloadName,
} from '../plugins/content-disposition.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';
import { reserveArchiveJob, type ArchiveJobs } from './archive-jobs.ts';
import { archiveLength, zipArchive, type ZipEntry } from './zip.ts';

/** Media type of one exported note. */
const markdownMediaType = 'text/markdown';

/** Media type of the whole workspace export. */
const archiveMediaType = 'application/zip';

/** Download name of the whole workspace export. */
const archiveName = 'notes.zip';

/** How many files one page of the export plan reads. */
const planPageSize = 1000;

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

/**
 * The refusal of a planned archive past a bound of the format, or `null`
 * (record 0160). The plan is checked before the first byte, so a refusal is
 * an answer of its own and never a download that stops in the middle.
 */
export function exportRefusal(
  plan: readonly { readonly path: string; readonly size: number }[],
): ExportTooLargeError | null {
  if (plan.length > maxArchiveEntries)
    return new ExportTooLargeError(
      `One zip archive holds ${String(maxArchiveEntries)} files at the most. Move some notes to another workspace, then export each workspace.`,
    );
  if (!archiveBytesAllowed(archiveLength(plan)))
    return new ExportTooLargeError(
      `One zip archive holds ${String(Math.floor(maxArchiveBytes / (1024 * 1024)))} MiB at the most. Move some notes to another workspace, then export each workspace.`,
    );
  return null;
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
  jobs: ArchiveJobs,
): HandlerMap {
  /** Reserves the archive job of one account, or refuses it. */
  const reserveJob = (reply: FastifyReply, accountId: string) =>
    reserveArchiveJob(jobs, reply, accountId);

  /** Every live file of the workspace with the size of its head. */
  async function planArchive(
    actor: Actor,
    workspaceId: string,
  ): Promise<readonly ArchivePlanRow[]> {
    // The core read check runs first, so a member that may not read is
    // refused as the listing refuses it.
    unwrapDomain(
      await listFiles(store, actor, workspaceId, {
        cursor: null,
        limit: 1,
        sort: 'path',
      }),
    );
    const rows: ArchivePlanRow[] = [];
    let after: string | null = null;
    for (;;) {
      const page = await attachments.archivePlan(
        actor,
        workspaceId,
        after,
        planPageSize,
      );
      rows.push(...page);
      // One more file than the format holds is enough to refuse the export.
      if (page.length < planPageSize || rows.length > maxArchiveEntries)
        return rows;
      after = page.at(-1)?.path ?? null;
    }
  }

  /**
   * The entries of the planned archive, in plan order.
   *
   * Each entry is the planned revision, which never changes, so the archive
   * holds exactly the bytes that the plan counted. A revision that a purge
   * removed while the archive streams stops the answer.
   */
  async function* plannedEntries(
    actor: Actor,
    workspaceId: string,
    plan: readonly ArchivePlanRow[],
  ): AsyncGenerator<ZipEntry> {
    for (const row of plan) {
      let bytes: Buffer;
      if (row.kind === 'attachment') {
        const found = await attachments.readAttachmentRevision(
          actor,
          workspaceId,
          row.headRevisionId,
        );
        if (found === null)
          throw new Error('notesapp: a planned image of the export is gone.');
        bytes = await readAll(found.stream);
      } else {
        const head = unwrapDomain(
          await readRevision(store, actor, workspaceId, row.headRevisionId),
        );
        bytes = Buffer.from(head.text ?? '', 'utf8');
      }
      if (bytes.length !== row.size)
        throw new Error('notesapp: a planned file of the export changed size.');
      yield { path: row.path, bytes, modified: row.updatedAt };
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

    exportWorkspace: async (request, reply): Promise<HandlerResult> => {
      const actor = requireActor(request).actor;
      const workspaceId = readText(request.params, 'workspaceId');
      const plan = await planArchive(actor, workspaceId);
      const refusal = exportRefusal(plan);
      if (refusal !== null) throw refusal;
      const length = archiveLength(plan);
      const headers: [string, string][] = [
        [
          'content-disposition',
          exportDisposition({
            path: archiveName,
            mediaType: archiveMediaType,
            fallback: archiveName,
          }),
        ],
        ['content-length', String(length)],
        ['cache-control', 'no-store'],
      ];
      // A HEAD asks for the headers only, so it plans and runs no job.
      if (request.method === 'HEAD')
        return {
          status: 200,
          mediaType: archiveMediaType,
          body: Readable.from([]),
          headers,
        };
      const lease = await reserveJob(reply, actor.accountId);
      const body = zipArchive(plannedEntries(actor, workspaceId, plan));
      // The job ends when the archive ends, fails, or the caller leaves.
      body.once('close', () => {
        void lease.release().catch(() => undefined);
      });
      return { status: 200, mediaType: archiveMediaType, body, headers };
    },
  };
}
