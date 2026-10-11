/**
 * Checks the parser of the image inspection worker answer.
 *
 * The worker is a separate process, so its output is text that this process
 * did not build. The parser has to accept a complete answer, refuse a
 * measurement that no image can have, and refuse a failure name that the
 * upload handler does not know. A refusal reads as `null`, which the caller
 * turns into the one failure that the person can act on.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { inspectImage, parseInspection } from './inspect-image.ts';

await test('a complete answer reads back with its measurements', () => {
  assert.deepEqual(
    parseInspection({
      ok: true,
      mediaType: 'image/png',
      width: 1280,
      height: 720,
    }),
    { ok: true, mediaType: 'image/png', width: 1280, height: 720 },
  );
});

await test('a failure keeps its reported name and uses fixed safe text', () => {
  assert.deepEqual(
    parseInspection({
      ok: false,
      error: 'unsupported_media_type',
      reason: 'sharp: /private/image secret-sentinel engine notice',
    }),
    {
      ok: false,
      error: 'unsupported_media_type',
      reason: 'The image format is not supported. Use PNG, JPEG, GIF or WebP.',
    },
  );
});

await test('a failure name the handler does not know becomes invalid image', () => {
  // A newer worker can report a name this release has no answer for. The
  // upload must still tell the person one thing it can act on.
  assert.deepEqual(parseInspection({ ok: false, error: 'exotic_failure' }), {
    ok: false,
    error: 'invalid_image',
    reason:
      'The image cannot be read. Export it as PNG, JPEG, GIF or WebP, then try again.',
  });
});

await test('each worker failure discards engine text, paths and rejected data', () => {
  for (const [error, reason] of [
    ['payload_too_large', 'The image is too large. Use a smaller image.'],
    [
      'unsupported_media_type',
      'The image format is not supported. Use PNG, JPEG, GIF or WebP.',
    ],
    [
      'inconsistent_media_type',
      'The image does not match its file type. Export it as PNG, JPEG, GIF or WebP, then try again.',
    ],
    [
      'invalid_image',
      'The image cannot be read. Export it as PNG, JPEG, GIF or WebP, then try again.',
    ],
  ] as const) {
    for (const supplied of [
      'sharp: Input file has corrupt header: /private/image secret-sentinel',
      { path: '/private/image', secret: 'secret-sentinel' },
      undefined,
    ]) {
      assert.deepEqual(
        parseInspection({ ok: false, error, reason: supplied }),
        {
          ok: false,
          error,
          reason,
        },
      );
    }
  }
  assert.deepEqual(
    parseInspection({
      ok: false,
      error: 'timeout',
      reason: '/private/image secret-sentinel',
    }),
    {
      ok: false,
      error: 'invalid_image',
      reason:
        'The image cannot be read. Export it as PNG, JPEG, GIF or WebP, then try again.',
    },
  );
});

await test('an answer that is not a record is refused', () => {
  for (const value of [null, undefined, 'ok', 5, [], true])
    assert.equal(parseInspection(value), null);
});

await test('an answer without the ok flag is refused', () => {
  assert.equal(parseInspection({ mediaType: 'image/png' }), null);
  assert.equal(parseInspection({ ok: 'true' }), null);
});

await test('a media type outside the accepted list is refused', () => {
  // The worker reports what it decoded. SVG is deliberately not an
  // attachment type, so an answer that names it cannot pass.
  for (const mediaType of ['image/svg+xml', 'application/pdf', ''])
    assert.equal(
      parseInspection({ ok: true, mediaType, width: 10, height: 10 }),
      null,
      mediaType,
    );
});

await test('a measurement that no image can have is refused', () => {
  // Regression: a zero or fractional measurement used to reach the record and
  // be stored as the size of the attachment.
  for (const size of [0, -1, 1.5, Number.NaN, '10', null, undefined]) {
    assert.equal(
      parseInspection({
        ok: true,
        mediaType: 'image/png',
        width: size,
        height: 10,
      }),
      null,
      String(size),
    );
    assert.equal(
      parseInspection({
        ok: true,
        mediaType: 'image/png',
        width: 10,
        height: size,
      }),
      null,
      String(size),
    );
  }
});

await test('an inherited member cannot pass the check', () => {
  const inherited: unknown = Object.create({
    ok: true,
    mediaType: 'image/png',
    width: 10,
    height: 10,
  });
  assert.equal(parseInspection(inherited), null);
});

/** Small real images that the installed native library can read. */
function sampleImage() {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 40, g: 60, b: 80 },
    },
  });
}

/** Sends fixture bytes to the real inspection child process. */
async function inspectBytes(bytes: Uint8Array, mediaType = 'image/png') {
  const directory = await mkdtemp(join(tmpdir(), 'image-inspection-'));
  try {
    // The file name must not select a format. Upload scratch files have none.
    const path = join(directory, 'image');
    await writeFile(path, bytes);
    return await inspectImage(path, mediaType);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await test('the child permits only the supported filesystem image loaders', async (t) => {
  for (const [format, mediaType] of [
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['gif', 'image/gif'],
    ['webp', 'image/webp'],
  ] as const) {
    await t.test(format, async () => {
      const bytes = await sampleImage().toFormat(format).toBuffer();
      assert.deepEqual(await inspectBytes(bytes, mediaType), {
        ok: true,
        mediaType,
        width: 2,
        height: 2,
      });
    });
  }
});

await test('the child refuses blocked loaders before unsupported metadata is read', async (t) => {
  const heif = await sampleImage().avif().toBuffer();
  const tiff = await sampleImage().tiff().toBuffer();
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>',
  );
  for (const [name, bytes, format] of [
    ['HEIF', heif, 'heif'],
    ['TIFF', tiff, 'tiff'],
    ['SVG', svg, 'svg'],
  ] as const) {
    await t.test(name, async () => {
      // The parent can read each fixture. The restriction belongs to the
      // upload worker, and its refusal occurs during native loader selection.
      assert.equal((await sharp(bytes).metadata()).format, format);
      assert.deepEqual(await inspectBytes(bytes), {
        ok: false,
        error: 'unsupported_media_type',
        reason:
          'The image format is not supported. Use PNG, JPEG, GIF or WebP.',
      });
      assert.equal((await sharp(bytes).metadata()).format, format);
    });
  }
  await t.test(
    'a truncated HEIF header also cannot enter its loader',
    async () => {
      // Keep the complete ftyp box, but remove all image items. The old worker
      // selects HEIF and reports a corrupt native header instead of refusing it.
      assert.equal(heif.subarray(4, 8).toString(), 'ftyp');
      const header = heif.subarray(0, heif.readUInt32BE(0));
      await assert.rejects(sharp(header).metadata(), /corrupt header/);
      const refused = await inspectBytes(header);
      assert.equal(refused.ok, false);
      if (!refused.ok) {
        assert.equal(refused.error, 'unsupported_media_type');
        assert.equal(
          refused.reason,
          'The image format is not supported. Use PNG, JPEG, GIF or WebP.',
        );
      }
    },
  );
});

await test('the child retains animation, MIME checks and pixel limits', async () => {
  const frames = Buffer.alloc(2 * 4 * 3, 40);
  frames.fill(80, 2 * 2 * 3);
  const animated = await sharp(frames, {
    raw: { width: 2, height: 4, channels: 3, pageHeight: 2 },
  })
    .gif()
    .toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  assert.deepEqual(await inspectBytes(animated, 'image/gif'), {
    ok: true,
    mediaType: 'image/gif',
    width: 2,
    height: 4,
  });

  const mismatch = await inspectBytes(await sampleImage().jpeg().toBuffer());
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.error, 'inconsistent_media_type');

  const large = await sampleImage().png().toBuffer();
  // A real PNG header is enough to test the metadata pixel limit. No large
  // pixel allocation is needed in the test process.
  large.writeUInt32BE(7000, 16);
  large.writeUInt32BE(7000, 20);
  large.writeUInt32BE(crc32(large.subarray(12, 29)), 29);
  const oversized = await inspectBytes(large);
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.error, 'payload_too_large');
});

await test('unknown bytes are unsupported and a recognized corrupt PNG is invalid', async () => {
  const unknown = await inspectBytes(Buffer.from('This is not an image.'));
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.error, 'unsupported_media_type');
  const corrupt = await inspectBytes(
    Buffer.from('89504e470d0a1a0a0000000d494844', 'hex'),
  );
  assert.equal(corrupt.ok, false);
  if (!corrupt.ok) assert.equal(corrupt.error, 'invalid_image');
  assert.deepEqual(corrupt, {
    ok: false,
    error: 'invalid_image',
    reason:
      'The image cannot be read. Export it as PNG, JPEG, GIF or WebP, then try again.',
  });
});

await test('a child timeout keeps its code and states the correct safe cause', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'image-inspection-'));
  try {
    const path = join(directory, 'image');
    await writeFile(path, await sampleImage().png().toBuffer());
    // The process has not loaded its native library within this limit.
    assert.deepEqual(await inspectImage(path, 'image/png', 1), {
      ok: false,
      error: 'payload_too_large',
      reason: 'The image check took too long. Use a smaller image.',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test('a missing inspection file cannot expose the local path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'image-inspection-'));
  try {
    assert.deepEqual(
      await inspectImage(join(directory, 'secret-sentinel'), 'image/png'),
      {
        ok: false,
        error: 'invalid_image',
        reason:
          'The image cannot be read. Export it as PNG, JPEG, GIF or WebP, then try again.',
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test('a failed child startup cannot expose command text or local paths', () => {
  const module = new URL('./inspect-image.ts', import.meta.url).href;
  const script = `
    import { inspectImage } from ${JSON.stringify(module)};
    process.env.NODE_OPTIONS = '--require=./missing-inspection-secret-sentinel.cjs';
    console.log(JSON.stringify(await inspectImage('/private/secret-sentinel', 'image/png')));
  `;
  // Fail before the worker starts, in a separate parent so the test runner's
  // environment never changes. The exec error contains both command and path.
  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    { encoding: 'utf8' },
  );
  const result: unknown = JSON.parse(output);
  assert.deepEqual(result, {
    ok: false,
    error: 'invalid_image',
    reason:
      'The image cannot be read. Export it as PNG, JPEG, GIF or WebP, then try again.',
  });
  assert.doesNotMatch(output, /secret-sentinel|\/private\/|MODULE_NOT_FOUND/);
});
