/** Checks the rule that compresses a large JSON read (record 0169). */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import {
  answerEncoding,
  compressionThresholdBytes,
  encodeBody,
  type AnswerFacts,
} from './compression.ts';

/** A large JSON read of a browser, which every case changes in one fact. */
const read: AnswerFacts = {
  method: 'GET',
  status: 200,
  contentType: 'application/json; charset=utf-8',
  contentEncoding: '',
  setsCookie: false,
  size: compressionThresholdBytes,
  acceptEncoding: 'gzip, deflate, br, zstd',
};

await test('a large JSON read takes Brotli first and gzip second', () => {
  assert.equal(answerEncoding(read), 'br');
  assert.equal(answerEncoding({ ...read, acceptEncoding: 'gzip' }), 'gzip');
  assert.equal(
    answerEncoding({ ...read, acceptEncoding: 'br;q=0, gzip;q=0.5' }),
    'gzip',
  );
});

await test('a caller that accepts no coding gets the answer as it is', () => {
  assert.equal(answerEncoding({ ...read, acceptEncoding: undefined }), null);
  assert.equal(answerEncoding({ ...read, acceptEncoding: 'identity' }), null);
});

await test('a write, a failure and a small answer stay as they are', () => {
  assert.equal(answerEncoding({ ...read, method: 'POST' }), null);
  assert.equal(answerEncoding({ ...read, method: 'HEAD' }), null);
  assert.equal(answerEncoding({ ...read, status: 404 }), null);
  assert.equal(answerEncoding({ ...read, status: 304 }), null);
  assert.equal(
    answerEncoding({ ...read, size: compressionThresholdBytes - 1 }),
    null,
  );
});

await test('an answer that sets a cookie, is encoded or is not JSON stays as it is', () => {
  assert.equal(answerEncoding({ ...read, setsCookie: true }), null);
  assert.equal(answerEncoding({ ...read, contentEncoding: 'br' }), null);
  assert.equal(
    answerEncoding({ ...read, contentType: 'application/problem+json' }),
    null,
  );
  assert.equal(answerEncoding({ ...read, contentType: 'text/html' }), null);
  assert.equal(
    answerEncoding({ ...read, contentType: 'application/zip' }),
    null,
  );
});

await test('each coding gives back the exact bytes', async () => {
  const body = Buffer.from(
    JSON.stringify({ text: 'A line of a note. '.repeat(500) }),
  );
  const br = await encodeBody(body, 'br');
  const gz = await encodeBody(body, 'gzip');
  assert.ok(br.length < body.length / 4);
  assert.ok(gz.length < body.length / 4);
  assert.deepEqual(brotliDecompressSync(br), body);
  assert.deepEqual(gunzipSync(gz), body);
});
