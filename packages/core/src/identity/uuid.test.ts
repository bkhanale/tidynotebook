import assert from 'node:assert/strict';
import test from 'node:test';
import { generateUUID } from './uuid.ts';

const uuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

await test('generateUUID returns a valid RFC 4122 version 4 UUID', () => {
  const id = generateUUID();
  assert.match(id, uuidV4Pattern);
});

await test('generateUUID produces unique values across multiple calls', () => {
  const ids = new Set<string>();
  for (let index = 0; index < 100; index++) {
    const id = generateUUID();
    assert.match(id, uuidV4Pattern);
    assert.equal(ids.has(id), false);
    ids.add(id);
  }
});

await test('generateUUID works when randomUUID is unavailable', () => {
  const originalCrypto = globalThis.crypto;
  try {
    // Simulate insecure browser context without crypto.randomUUID
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
      },
      configurable: true,
      writable: true,
    });
    const id = generateUUID();
    assert.match(id, uuidV4Pattern);
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
  }
});

await test('generateUUID works when crypto is completely absent', () => {
  const originalCrypto = globalThis.crypto;
  try {
    // Simulate environment without Web Cryptography
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const id = generateUUID();
    assert.match(id, uuidV4Pattern);
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
  }
});
