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

/** SHA-256 of UTF-8 text, in lower case hexadecimal. */
async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(hash));
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
