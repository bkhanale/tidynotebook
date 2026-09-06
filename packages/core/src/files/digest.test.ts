import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CanonicalJsonError,
  canonicalJson,
  contentDigest,
  requestDigest,
  sha256Fallback,
} from './digest.ts';

/**
 * Known answers, so a later change of the algorithm cannot pass unnoticed.
 *
 * The values are the SHA-256 of the UTF-8 bytes of each string, in lower case
 * hexadecimal.
 */
const knownDigests: readonly (readonly [string, string])[] = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  [
    '# Title\n',
    'e01b17ff9af77056792f67c57e3d1908795b9d1ae4cfe72421d0a2838991b740',
  ],
  [
    'caf\u00e9',
    '850f7dc43910ff890f8879c0ed26fe697c93a067ad93a7d50f466a7028a9bf4e',
  ],
  [
    'cafe\u0301',
    '81ef060bcd98adc7824eb5c1ada83c32491b16018e11e79f00ab9d09e04b015a',
  ],
];

await test('a content digest matches its known answer', async () => {
  for (const [text, expected] of knownDigests) {
    assert.equal(await contentDigest(text), expected, JSON.stringify(text));
  }
});

await test('a content digest applies no unicode normalization', async () => {
  // The composed and the decomposed spelling of one word are different bytes,
  // so they are different content and keep different digests.
  assert.notEqual(
    await contentDigest('caf\u00e9'),
    await contentDigest('cafe\u0301'),
  );
});

await test('sha256Fallback matches known answers exactly', () => {
  const hexDigits = '0123456789abcdef';
  function toHex(bytes: Uint8Array): string {
    let text = '';
    for (const byte of bytes) {
      text += hexDigits[(byte >> 4) & 0xf] ?? '0';
      text += hexDigits[byte & 0xf] ?? '0';
    }
    return text;
  }
  for (const [text, expected] of knownDigests) {
    const bytes = new TextEncoder().encode(text);
    assert.equal(toHex(sha256Fallback(bytes)), expected, JSON.stringify(text));
  }
});

await test('contentDigest falls back when crypto.subtle is unavailable', async () => {
  const originalCrypto = globalThis.crypto;
  try {
    // Insecure browser context where subtle is undefined
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
      },
      configurable: true,
      writable: true,
    });
    for (const [text, expected] of knownDigests) {
      assert.equal(await contentDigest(text), expected, JSON.stringify(text));
    }
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
  }
});

await test('canonical json sorts object keys at every depth', () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: 2, c: 3 } }),
    '{"a":{"c":3,"d":2},"b":1}',
  );
  assert.equal(
    canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    '{"a":{"c":3,"d":2},"b":1}',
  );
});

await test('canonical json keeps array order', () => {
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  assert.equal(
    canonicalJson([{ b: 1, a: 2 }, [{ z: 1, y: 2 }]]),
    '[{"a":2,"b":1},[{"y":2,"z":1}]]',
  );
});

await test('canonical json keeps an explicit null and drops a missing member', () => {
  assert.equal(canonicalJson({ a: null }), '{"a":null}');
  assert.equal(canonicalJson({ a: undefined }), '{}');
  assert.notEqual(canonicalJson({ a: null }), canonicalJson({}));
  // A position in an array cannot be left out, so it becomes null.
  assert.equal(canonicalJson([undefined, 1]), '[null,1]');
});

await test('canonical json applies no unicode normalization', () => {
  assert.notEqual(
    canonicalJson({ path: 'caf\u00e9.md' }),
    canonicalJson({ path: 'cafe\u0301.md' }),
  );
});

await test('canonical json rejects a value that json cannot represent', () => {
  for (const value of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    assert.throws(() => canonicalJson({ a: value }), CanonicalJsonError);
    assert.throws(() => canonicalJson([value]), CanonicalJsonError);
  }
  assert.throws(() => canonicalJson({ a: 1n }), CanonicalJsonError);
  assert.throws(
    () => canonicalJson({ a: (): number => 1 }),
    CanonicalJsonError,
  );
  assert.throws(() => canonicalJson(Symbol('x')), CanonicalJsonError);
});

await test('a request digest matches its known answer', async () => {
  assert.equal(
    await requestDigest('createFile', null, { path: 'a.md' }),
    'c3c9dface48a393bc0505f346bcd0f27dc2f4b21924cd9973b9c3c6b83ca3b5a',
  );
  assert.equal(
    await requestDigest(
      'updateFile',
      { ifMatch: 'r1' },
      {
        path: 'a.md',
        text: 'one',
      },
    ),
    '678d1313d027748a2f484fcd63692576fa5c7f8160341847b5ebdc124645fa6e',
  );
});

await test('a request digest ignores member order but not the values', async () => {
  const first = await requestDigest(
    'updateFile',
    { ifMatch: 'r1' },
    { path: 'a.md', text: 'one' },
  );
  const second = await requestDigest(
    'updateFile',
    { ifMatch: 'r1' },
    { text: 'one', path: 'a.md' },
  );
  assert.equal(first, second);

  const otherBody = await requestDigest(
    'updateFile',
    { ifMatch: 'r1' },
    { path: 'a.md', text: 'two' },
  );
  const otherPrecondition = await requestDigest(
    'updateFile',
    { ifMatch: 'r2' },
    { path: 'a.md', text: 'one' },
  );
  const otherOperation = await requestDigest(
    'createFile',
    { ifMatch: 'r1' },
    { path: 'a.md', text: 'one' },
  );
  assert.notEqual(first, otherBody);
  assert.notEqual(first, otherPrecondition);
  assert.notEqual(first, otherOperation);
});

await test('a request digest separates a missing member from a null member', async () => {
  const missing = await requestDigest('createFile', null, { path: 'a.md' });
  const explicit = await requestDigest('createFile', null, {
    path: 'a.md',
    message: null,
  });
  const absent = await requestDigest('createFile', null, {
    path: 'a.md',
    message: undefined,
  });
  assert.notEqual(missing, explicit);
  assert.equal(missing, absent);
});

await test('a request digest rejects a non-finite number', async () => {
  await assert.rejects(
    () => requestDigest('createFile', null, { limit: Number.NaN }),
    CanonicalJsonError,
  );
});
