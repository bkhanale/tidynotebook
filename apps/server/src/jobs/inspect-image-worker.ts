/**
 * Image inspection worker process.
 *
 * Limits image pixels. The parent limits process time and output size.
 * Permits only the filesystem loaders of the supported image formats.
 * Prints JSON result to stdout.
 */
import { stat } from 'node:fs/promises';
import sharp from 'sharp';
import { inspectionFailure } from './inspection-failure.ts';

// Block before format selection. libvips excludes blocked loaders from its
// search before their sniff callbacks, header readers or decoders can run.
sharp.block({ operation: ['VipsForeignLoad'] });
sharp.unblock({
  operation: [
    'VipsForeignLoadPngFile',
    'VipsForeignLoadJpegFile',
    'VipsForeignLoadNsgifFile',
    'VipsForeignLoadWebpFile',
  ],
});

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
    console.log(JSON.stringify(inspectionFailure('invalid_image')));
    process.exit(0);
  }

  try {
    const fileStats = await stat(filePath);
    if (fileStats.size === 0) {
      console.log(JSON.stringify(inspectionFailure('invalid_image')));
      process.exit(0);
    }
  } catch {
    console.log(JSON.stringify(inspectionFailure('invalid_image')));
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
      console.log(JSON.stringify(inspectionFailure('unsupported_media_type')));
      process.exit(0);
    }

    const detectedMediaType = formatToMediaType[format];
    if (detectedMediaType !== declaredMediaType) {
      console.log(JSON.stringify(inspectionFailure('inconsistent_media_type')));
      process.exit(0);
    }

    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height || width <= 0 || height <= 0) {
      console.log(JSON.stringify(inspectionFailure('invalid_image')));
      process.exit(0);
    }

    const pages = metadata.pages ?? 1;
    const pageHeight = metadata.pageHeight ?? height;
    const totalPixels = width * pageHeight * pages;
    if (totalPixels > maxPixels || width * height > maxPixels) {
      console.log(JSON.stringify(inspectionFailure('payload_too_large')));
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
      console.log(JSON.stringify(inspectionFailure('payload_too_large')));
      process.exit(0);
    }
    const error =
      message === 'Input file contains unsupported image format'
        ? 'unsupported_media_type'
        : 'invalid_image';
    console.log(JSON.stringify(inspectionFailure(error)));
    process.exit(0);
  }
}

await main();
