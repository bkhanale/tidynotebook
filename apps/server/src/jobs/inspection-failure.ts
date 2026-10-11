/** Safe failure answers shared by the image worker and its parent. */
export const inspectionErrors = [
  'payload_too_large',
  'unsupported_media_type',
  'inconsistent_media_type',
  'invalid_image',
] as const;

export type InspectionError = (typeof inspectionErrors)[number];

export type ImageInspectionFailure = {
  readonly ok: false;
  readonly error: InspectionError;
  readonly reason: string;
};

const reasons: Readonly<Record<InspectionError | 'timeout', string>> = {
  payload_too_large: 'The image is too large. Use a smaller image.',
  unsupported_media_type:
    'The image format is not supported. Use PNG, JPEG, GIF or WebP.',
  inconsistent_media_type:
    'The image does not match its file type. Export it as PNG, JPEG, GIF or WebP, then try again.',
  invalid_image:
    'The image cannot be read. Export it as PNG, JPEG, GIF or WebP, then try again.',
  timeout: 'The image check took too long. Use a smaller image.',
};

/** Library or process text never forms part of a failure answer. */
export function inspectionFailure(
  cause: InspectionError | 'timeout',
): ImageInspectionFailure {
  return {
    ok: false,
    error: cause === 'timeout' ? 'payload_too_large' : cause,
    reason: reasons[cause],
  };
}
