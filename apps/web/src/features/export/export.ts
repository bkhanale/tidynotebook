/**
 * Downloads of exported Markdown.
 *
 * A browser saves a file in one way only: an anchor that points at a local
 * object URL and is clicked. The bytes therefore come from the generated
 * operation, become a blob URL, and the URL is revoked as soon as the click
 * is handed to the browser. No request URL is built here.
 *
 * The download name comes from the answer. The server states it in the
 * content disposition, which is the one place that knows the stored path.
 */
import {
  exportNote,
  exportWorkspace,
  importWorkspace,
} from '@notesapp/api-client';
import { maxArchiveEntries, maxArchiveExpandedBytes } from '@notesapp/core';

/** The problem code of a failed generated call, or an empty string. */
function problemCode(error: unknown): string {
  if (error === null || typeof error !== 'object') return '';
  const code: unknown = Object.fromEntries(Object.entries(error))['code'];
  return typeof code === 'string' ? code : '';
}

/** The message of a refused download. */
function refuse(error: unknown): Error {
  const code = problemCode(error);
  if (code === 'not_found')
    return new Error('This note is not on the server any more.');
  if (code === 'unauthenticated')
    return new Error('Sign in again to download your notes.');
  return new Error('The download did not start. Try again.');
}

/**
 * The message of each refusal of an import that a person can act on.
 *
 * Each problem code of the import has its own sentence, so the person reads
 * the real cause and the next step (issue 243). A code that is not here gets
 * the general sentence.
 */
const importRefusals: Readonly<Record<string, string>> = {
  path_conflict:
    'A note or an image in this workspace has the same name as a file in the zip file. Rename or move it, then import again.',
  unauthenticated: 'Sign in again to import your notes.',
  payload_too_large:
    'The zip file is too large. Put the files in smaller zip files and import each one.',
  archive_too_many_files: `The zip file has more than ${String(maxArchiveEntries)} files. Put the files in smaller zip files and import each one.`,
  archive_too_large: `The files in the zip file are larger than ${String(maxArchiveExpandedBytes / (1024 * 1024))} MiB. Put the files in smaller zip files and import each one.`,
  archive_invalid:
    'This file is not a zip file that NotesApp can read. Make the zip file again and import it.',
  unsupported_media_type:
    'The zip file can hold only Markdown files and images. Remove the other files and import again.',
  quota_exceeded:
    'Your account has no room for these files. Delete some notes or images, then import again.',
};

/** The message of a refused import. */
export function importRefusalMessage(error: unknown): string {
  return (
    importRefusals[problemCode(error)] ??
    'The import did not finish. Check the zip file and try again.'
  );
}

/**
 * The sentence that a screen shows for a failed download or import.
 *
 * Each function of this module refuses with an `Error` whose message is the
 * sentence of the cause. The general problem text of the application reads a
 * problem code, and an `Error` has none, so it named a lost connection for
 * every refusal (issue 243). A screen reads the sentence here instead.
 */
export function transferFailureMessage(failure: unknown): string {
  return failure instanceof Error && failure.message !== ''
    ? failure.message
    : 'The request did not finish. Try again.';
}

/** The error of a refused import. */
function refuseImport(error: unknown): Error {
  return new Error(importRefusalMessage(error));
}

/**
 * The download name that the answer states, or the given fallback.
 *
 * The header carries the name twice: once in ASCII between quotes and once
 * percent encoded as UTF-8. The encoded form is preferred, because it is the
 * one that keeps every character of the name.
 */
export function downloadName(
  disposition: string | null,
  fallback: string,
): string {
  if (disposition === null) return fallback;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded !== undefined) {
    try {
      const name = decodeURIComponent(encoded.trim());
      if (name !== '') return name;
    } catch {
      // A header this client cannot read falls back to the quoted form.
    }
  }
  const quoted = /filename="([^"]*)"/i.exec(disposition)?.[1];
  return quoted === undefined || quoted === '' ? fallback : quoted;
}

/**
 * The answer as a blob.
 *
 * The generated client parses an answer by its media type: a zip arrives as a
 * blob, and Markdown arrives as text. Both are saved the same way, so the
 * text form is wrapped here.
 */
function asBlob(data: unknown, mediaType: string): Blob {
  if (data instanceof Blob) return data;
  return new Blob([typeof data === 'string' ? data : ''], {
    type: mediaType,
  });
}

/** Hands one blob to the browser as a saved file. */
export function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // The click is queued before this runs, so the browser keeps the bytes.
  URL.revokeObjectURL(url);
}

/** Saves one note as a Markdown file on this device. */
export async function downloadNote(
  workspaceId: string,
  fileId: string,
): Promise<void> {
  const answer = await exportNote({ path: { workspaceId, fileId } });
  if (answer.error !== undefined || answer.data === undefined)
    throw refuse(answer.error);
  save(
    asBlob(answer.data, 'text/markdown'),
    downloadName(
      answer.response?.headers.get('content-disposition') ?? null,
      'note.md',
    ),
  );
}

/** Saves every live note of the workspace as one zip archive. */
export async function downloadAll(workspaceId: string): Promise<void> {
  const answer = await exportWorkspace({ path: { workspaceId } });
  if (answer.error !== undefined || answer.data === undefined)
    throw refuse(answer.error);
  save(
    asBlob(answer.data, 'application/zip'),
    downloadName(
      answer.response?.headers.get('content-disposition') ?? null,
      'notes.zip',
    ),
  );
}

/** Imports one portable workspace archive without changing its references. */
export async function importAll(
  workspaceId: string,
  file: File,
): Promise<{ readonly notes: number; readonly attachments: number }> {
  const answer = await importWorkspace({
    path: { workspaceId },
    body: { file },
  });
  if (answer.error !== undefined || answer.data === undefined)
    throw refuseImport(answer.error);
  return answer.data;
}
