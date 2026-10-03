/**
 * The stable problem of a failed service call (record 0182).
 *
 * A generated call fails with a value of no known shape. This module is the
 * boundary that reads it: each member is read through a guard, and a member
 * of an unknown shape reads as absent, so no assertion stands anywhere.
 */
import { isNoteRefusal } from '@notesapp/core';
import { transportFailedCode, type Problem } from './queue.ts';

/** Reading one unknown property without asserting its shape. */
function readProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value))[key];
}

/** The text list of a problem's file IDs, or an empty list. */
function readFileIds(value: unknown): readonly string[] {
  const fileIds = readProperty(value, 'fileIds');
  if (!Array.isArray(fileIds)) return [];
  return fileIds.filter(
    (entry: unknown): entry is string => typeof entry === 'string',
  );
}

/**
 * Maps a generated failure to a stable problem.
 *
 * The client interceptor normalizes failures to problem details, so the
 * code, the status, and the file IDs are read from the error first and from
 * the HTTP answer as a fallback.
 */
export function toProblem(
  error: unknown,
  response: Response | undefined,
): Problem {
  const statusRaw = readProperty(error, 'status');
  const status =
    typeof statusRaw === 'number' ? statusRaw : (response?.status ?? 0);
  const codeRaw = readProperty(error, 'code');
  const code =
    typeof codeRaw === 'string' && codeRaw !== ''
      ? codeRaw
      : status === 401
        ? 'unauthorized'
        : status === 0
          ? transportFailedCode
          : 'unexpected_response';
  // The limit of a refused note is read through the guard of its one list,
  // so a value that no release names reads as no cause at all.
  const noteRefusal = readProperty(error, 'noteRefusal');
  return {
    status,
    code,
    fileIds: readFileIds(error),
    ...(isNoteRefusal(noteRefusal) ? { noteRefusal } : {}),
  };
}
