/**
 * Image inspection worker process.
 *
 * Runs sharp in a bounded child process with memory and pixel caps.
 * Prints JSON result to stdout.
 */
import { stat } from 'node:fs/promises';
import sharp from 'sharp';

const maxPixels = 40_000_000;
const allowedFormats = new Set(['png', 'jpeg', 'gif', 'webp']);
const formatToMediaType: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

async function main(): Promise<void> {
  const filePath = process.argv[2];
  const declaredMediaType = process.argv[3];
  if (!filePath || !declaredMediaType) {
    console.log(
      JSON.stringify({
        ok: false,
        error: 'invalid_args',
        reason: 'missing filePath or declaredMediaType',
      }),
    );
    process.exit(0);
  }

  try {
    const fileStats = await stat(filePath);
    if (fileStats.size === 0) {
      console.log(
        JSON.stringify({
          ok: false,
          error: 'invalid_image',
          reason: 'empty file',
        }),
      );
      process.exit(0);
    }
  } catch {
    console.log(
      JSON.stringify({
        ok: false,
        error: 'invalid_image',
        reason: 'cannot access file',
      }),
    );
    process.exit(0);
  }

  try {
    const image = sharp(filePath, {
      animated: true,
      limitInputPixels: maxPixels,
      failOn: 'error',
    });
    const metadata = await image.metadata();
    const format = metadata.format;
    if (!format || !allowedFormats.has(format)) {
      console.log(
        JSON.stringify({
          ok: false,
          error: 'unsupported_media_type',
          reason: `unsupported image format: ${format ?? 'unknown'}`,
        }),
      );
      process.exit(0);
    }

    const detectedMediaType = formatToMediaType[format];
    if (detectedMediaType !== declaredMediaType) {
      console.log(
        JSON.stringify({
          ok: false,
          error: 'inconsistent_media_type',
          reason: `declared media type ${declaredMediaType} does not match detected format ${format}`,
        }),
      );
      process.exit(0);
    }

    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height || width <= 0 || height <= 0) {
      console.log(
        JSON.stringify({
          ok: false,
          error: 'invalid_image',
          reason: 'invalid image dimensions',
        }),
      );
      process.exit(0);
    }

    const pages = metadata.pages ?? 1;
    const pageHeight = metadata.pageHeight ?? height;
    const totalPixels = width * pageHeight * pages;
    if (totalPixels > maxPixels || width * height > maxPixels) {
      console.log(
        JSON.stringify({
          ok: false,
          error: 'payload_too_large',
          reason: `image dimensions (${String(width)}x${String(height)}, ${String(pages)} frames, ${String(totalPixels)} pixels) exceed 40 megapixel limit`,
        }),
      );
      process.exit(0);
    }

    console.log(
      JSON.stringify({
        ok: true,
        mediaType: detectedMediaType,
        width,
        height,
      }),
    );
    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes('Input image exceeds pixel limit') ||
      message.includes('pixel limit')
    ) {
      console.log(
        JSON.stringify({
          ok: false,
          error: 'payload_too_large',
          reason: message,
        }),
      );
      process.exit(0);
    }
    console.log(
      JSON.stringify({
        ok: false,
        error: 'invalid_image',
        reason: message,
      }),
    );
    process.exit(0);
  }
}

await main();
