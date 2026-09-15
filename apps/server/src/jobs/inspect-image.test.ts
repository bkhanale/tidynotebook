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
import test from 'node:test';
import { parseInspection } from './inspect-image.ts';

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

await test('a failure keeps its reported name and reason', () => {
  assert.deepEqual(
    parseInspection({
      ok: false,
      error: 'unsupported_media_type',
      reason: 'The file is not an image this server accepts.',
    }),
    {
      ok: false,
      error: 'unsupported_media_type',
      reason: 'The file is not an image this server accepts.',
    },
  );
});

await test('a failure name the handler does not know becomes invalid image', () => {
  // A newer worker can report a name this release has no answer for. The
  // upload must still tell the person one thing it can act on.
  assert.deepEqual(parseInspection({ ok: false, error: 'exotic_failure' }), {
    ok: false,
    error: 'invalid_image',
    reason: 'Image inspection failed.',
  });
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
