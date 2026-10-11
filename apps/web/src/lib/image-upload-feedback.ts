/** Fixed cause and action text for an image upload. No engine text reaches it. */
import {
  problemCode,
  problemLimit,
  problemSentence,
  problemStatus,
} from './problem-text.ts';

const imageCauses: ReadonlyMap<string, string> = new Map([
  [
    'unsupported_media_type',
    'The image format is not supported. Use PNG, JPEG, GIF or WebP.',
  ],
  [
    'invalid_content',
    'The image is not valid. Export it as PNG, JPEG, GIF or WebP, then try again.',
  ],
  ['payload_too_large', 'The image cannot be added. Use a smaller image.'],
]);

/** A generated failure contributes only its parsed code, status and limit. */
export function imageUploadFailure(error: unknown): string {
  const code = problemCode(error);
  const status = problemStatus(error);
  if (code !== null) {
    const imageCause = imageCauses.get(code);
    if (imageCause !== undefined) return imageCause;
  }
  const limit = problemLimit(error);
  const sentence = problemSentence(code, status, limit);
  return typeof sentence === 'string'
    ? sentence
    : problemSentence(null, status, limit);
}

/** The chosen file exceeds the byte cap on this device. */
export function imageUploadTooLarge(): string {
  return 'The image is too large. Use a smaller image.';
}

/** The request or the later insertion stops without a parsed cause. */
export function imageUploadInterruption(): string {
  return 'The image cannot be added. Try again.';
}
