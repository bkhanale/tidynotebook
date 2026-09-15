/**
 * Bounded image inspection job.
 *
 * Spawns an isolated child process to inspect and validate uploaded images
 * using Sharp. Enforces pixel caps and media type consistency without trusting
 * declared MIME types.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAllowedMediaType } from '@notesapp/core';
import type { AttachmentMediaType } from '@notesapp/core';

export type ImageInspectionResult =
  | {
      readonly ok: true;
      readonly mediaType: AttachmentMediaType;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly ok: false;
      readonly error:
        | 'payload_too_large'
        | 'unsupported_media_type'
        | 'inconsistent_media_type'
        | 'invalid_image';
      readonly reason: string;
    };

/** The failures that the worker is allowed to report. */
const inspectionErrors = [
  'payload_too_large',
  'unsupported_media_type',
  'inconsistent_media_type',
  'invalid_image',
] as const;

/**
 * Reads one worker answer, or `null` when the text does not carry one.
 *
 * The worker is a separate process, so its output is text that this process
 * did not build. A partial write, a library notice on standard output, or an
 * older worker can all produce something else. The parser refuses each of
 * them, and the caller turns the refusal into the one failure that the person
 * can act on, so an unchecked shape never reaches the upload handler.
 */
export function parseInspection(value: unknown): ImageInspectionResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;
  const record: Record<string, unknown> = Object.fromEntries(
    Object.entries(value),
  );
  const ok: unknown = record['ok'];
  if (typeof ok !== 'boolean') return null;
  if (ok) {
    const mediaType: unknown = record['mediaType'];
    const width: unknown = record['width'];
    const height: unknown = record['height'];
    if (typeof mediaType !== 'string' || !isAllowedMediaType(mediaType))
      return null;
    if (typeof width !== 'number' || typeof height !== 'number') return null;
    if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
    if (width <= 0 || height <= 0) return null;
    return { ok: true, mediaType, width, height };
  }
  const reported: unknown = record['error'];
  const error = inspectionErrors.find((entry) => entry === reported);
  const reason: unknown = record['reason'];
  return {
    ok: false,
    error: error ?? 'invalid_image',
    reason:
      typeof reason === 'string' && reason !== ''
        ? reason
        : 'Image inspection failed.',
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = existsSync(join(here, 'inspect-image-worker.js'))
  ? join(here, 'inspect-image-worker.js')
  : join(here, 'inspect-image-worker.ts');

export async function inspectImage(
  filePath: string,
  declaredMediaType: string,
  timeoutMs = 5000,
): Promise<ImageInspectionResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [workerPath, filePath, declaredMediaType],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          if (error.killed || error.signal === 'SIGTERM') {
            resolve({
              ok: false,
              error: 'payload_too_large',
              reason: 'Image inspection timed out.',
            });
            return;
          }
          const text = stdout.trim();
          if (!text) {
            resolve({
              ok: false,
              error: 'invalid_image',
              reason: error.message,
            });
            return;
          }
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(stdout.trim());
        } catch {
          resolve({
            ok: false,
            error: 'invalid_image',
            reason: 'Malformed worker output.',
          });
          return;
        }
        resolve(
          parseInspection(parsed) ?? {
            ok: false,
            error: 'invalid_image',
            reason: 'Malformed worker output.',
          },
        );
      },
    );
  });
}
