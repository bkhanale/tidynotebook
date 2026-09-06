/**
 * Content digests and request digests.
 *
 * Two different digests appear in this application:
 *
 * - A content digest names immutable bytes. Storage deduplicates content by
 *   this value inside one workspace, so a revision that declares a wrong
 *   digest would attach itself to bytes that the client never sent. Every
 *   layer that accepts content therefore recomputes it.
 * - A request digest names one submitted operation. It is stored with the
 *   mutation receipt, so a retry of the same mutation identity can be told
 *   apart from a different operation that reuses that identity.
 *
 * Both use SHA-256 through the WebCrypto `crypto.subtle` global, because this
 * package also runs in the browser and cannot import a Node module.
 */

/** The alphabet of a lower case hexadecimal digest. */
const hexDigits = '0123456789abcdef';

/** Lower case hexadecimal of a byte sequence. */
function toHex(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    text += hexDigits[(byte >> 4) & 0xf] ?? '0';
    text += hexDigits[byte & 0xf] ?? '0';
  }
  return text;
}

/** SHA-256 round constants. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Right rotate 32-bit unsigned integer. */
function rotr(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/** Computes SHA-256 hash bytes using pure TypeScript. */
export function sha256Fallback(bytes: Uint8Array): Uint8Array {
  const length = bytes.length;
  const bitLength = length * 8;
  const totalLength = ((length + 9 + 63) >>> 6) << 6;
  const padded = new Uint8Array(totalLength);
  padded.set(bytes);
  padded[length] = 0x80;

  const view = new DataView(
    padded.buffer,
    padded.byteOffset,
    padded.byteLength,
  );
  const highBits = Math.floor(length / 0x20000000);
  view.setUint32(totalLength - 8, highBits, false);
  view.setUint32(totalLength - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        rotr(w[i - 15] ?? 0, 7) ^
        rotr(w[i - 15] ?? 0, 18) ^
        ((w[i - 15] ?? 0) >>> 3);
      const s1 =
        rotr(w[i - 2] ?? 0, 17) ^
        rotr(w[i - 2] ?? 0, 19) ^
        ((w[i - 2] ?? 0) >>> 10);
      w[i] = (((w[i - 16] ?? 0) + s0) >>> 0) + (((w[i - 7] ?? 0) + s1) >>> 0);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 =
        ((((h + s1) >>> 0) + ch) >>> 0) + (((K[i] ?? 0) + (w[i] ?? 0)) >>> 0);
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const result = new Uint8Array(32);
  const resultView = new DataView(result.buffer);
  resultView.setUint32(0, h0, false);
  resultView.setUint32(4, h1, false);
  resultView.setUint32(8, h2, false);
  resultView.setUint32(12, h3, false);
  resultView.setUint32(16, h4, false);
  resultView.setUint32(20, h5, false);
  resultView.setUint32(24, h6, false);
  resultView.setUint32(28, h7, false);
  return result;
}

/** SHA-256 of UTF-8 text, in lower case hexadecimal. */
async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const cryptoObj =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (typeof cryptoObj?.subtle?.digest === 'function') {
    try {
      const hash = await cryptoObj.subtle.digest('SHA-256', bytes);
      return toHex(new Uint8Array(hash));
    } catch {
      // Fall through to fallback when WebCrypto subtle fails.
    }
  }
  return toHex(sha256Fallback(bytes));
}

/**
 * The content digest of Markdown text.
 *
 * The text is encoded as UTF-8 exactly as it was given. No Unicode
 * normalization is applied, because two spellings of one word are two
 * different documents and a client that stored one of them must get it back
 * unchanged.
 */
export function contentDigest(text: string): Promise<string> {
  return sha256(text);
}

/**
 * A value that canonical JSON cannot represent.
 *
 * A non-finite number is the expected case: JSON has no such literal, so
 * `JSON.stringify` writes `null` for it and two different requests would reach
 * the same digest. The contract schema rejects these values as well; this
 * error is the second line of defence for a caller that builds a request
 * itself.
 */
export class CanonicalJsonError extends Error {
  constructor(detail: string) {
    super(`notesapp: ${detail}`);
    this.name = 'CanonicalJsonError';
  }
}

/**
 * Serializes a value as canonical JSON.
 *
 * The rules make one value produce one string on every runtime:
 *
 * - Object members are written in ascending order of their keys, compared by
 *   UTF-16 code unit, so the order a client used cannot change the digest.
 * - Array order is kept, because the order of a list is part of its value.
 * - An explicit `null` member is kept. It differs from a missing member.
 * - A member whose value is `undefined` is left out, exactly as
 *   `JSON.stringify` does, so an optional field that was not set and a field
 *   that is absent reach the same digest.
 * - `undefined` inside an array becomes `null`, again as `JSON.stringify`
 *   does, because an array has no way to leave a position out.
 * - A non-finite number, a `bigint`, a function, and a symbol are rejected.
 * - Strings are written as given. No Unicode normalization is applied.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new CanonicalJsonError(
        'a canonical request cannot contain a non-finite number.',
      );
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint')
    throw new CanonicalJsonError(
      'a canonical request cannot contain a bigint value.',
    );
  if (typeof value !== 'object')
    throw new CanonicalJsonError(
      `a canonical request cannot contain a ${typeof value} value.`,
    );
  if (Array.isArray(value))
    return `[${value.map((entry: unknown) => canonicalJson(entry)).join(',')}]`;
  // Own enumerable string keys only, so an inherited member cannot change the
  // digest of a value that was parsed from JSON.
  const record: Record<string, unknown> = Object.fromEntries(
    Object.entries(value),
  );
  const members: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const member: unknown = record[key];
    if (member === undefined) continue;
    members.push(`${JSON.stringify(key)}:${canonicalJson(member)}`);
  }
  return `{${members.join(',')}}`;
}

/**
 * The request digest of one submitted operation.
 *
 * The digest covers the operation identity, the preconditions that the request
 * carried, and its body. Two retries of one operation therefore reach the same
 * value, and a reused mutation identity with a different body, a different
 * expected head, or a different operation does not.
 *
 * The transport computes this over its own validated request. Values that only
 * the transport uses, such as a correlation header, are left out by the
 * caller: they do not change what the operation does.
 *
 * The function is asynchronous, so a rejected value is a rejected promise
 * rather than a thrown error in the middle of a request handler.
 */
export async function requestDigest(
  operationId: string,
  preconditions: unknown,
  body: unknown,
): Promise<string> {
  const message = `${operationId}\n${canonicalJson(preconditions)}\n${canonicalJson(body)}`;
  const digest = await sha256(message);
  return digest;
}
