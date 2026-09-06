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
        try {
          const parsed = JSON.parse(stdout.trim()) as {
            readonly ok: boolean;
            readonly mediaType?: AttachmentMediaType;
            readonly width?: number;
            readonly height?: number;
            readonly error?:
              | 'payload_too_large'
              | 'unsupported_media_type'
              | 'inconsistent_media_type'
              | 'invalid_image';
            readonly reason?: string;
          };
          if (parsed.ok && parsed.mediaType && parsed.width && parsed.height) {
            resolve({
              ok: true,
              mediaType: parsed.mediaType,
              width: parsed.width,
              height: parsed.height,
            });
          } else {
            resolve({
              ok: false,
              error: parsed.error ?? 'invalid_image',
              reason: parsed.reason ?? 'Image inspection failed.',
            });
          }
        } catch {
          resolve({
            ok: false,
            error: 'invalid_image',
            reason: 'Malformed worker output.',
          });
        }
      },
    );
  });
}
