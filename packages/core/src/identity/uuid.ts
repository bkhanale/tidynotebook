/**
 * Universally unique identifier generation.
 *
 * This module creates RFC 4122 version 4 identifiers. It works in secure
 * browser contexts, insecure browser contexts, and server environments.
 */

/** Hexadecimal lookup table for byte conversion. */
const byteToHex: readonly string[] = Array.from({ length: 256 }, (_, index) =>
  index.toString(16).padStart(2, '0'),
);

/**
 * Creates an RFC 4122 version 4 UUID string.
 *
 * It uses `crypto.randomUUID` when the platform supports it in the current
 * context. When `crypto.randomUUID` is unavailable (such as in an insecure
 * browser context), it generates random bytes with `crypto.getRandomValues` and
 * applies the version 4 bit masks. When no web cryptography is present, it
 * falls back to pseudo-random numbers.
 */
export function generateUUID(): string {
  const cryptoObj =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;

  if (typeof cryptoObj?.randomUUID === 'function') {
    try {
      return cryptoObj.randomUUID();
    } catch {
      // Fall through to getRandomValues when randomUUID fails.
    }
  }

  if (typeof cryptoObj?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    // Version 4: 0100 in the most significant 4 bits of time_hi_and_version
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    // Variant 1: 10 in the most significant 2 bits of clock_seq_hi_and_reserved
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

    return (
      (byteToHex[bytes[0] ?? 0] ?? '00') +
      (byteToHex[bytes[1] ?? 0] ?? '00') +
      (byteToHex[bytes[2] ?? 0] ?? '00') +
      (byteToHex[bytes[3] ?? 0] ?? '00') +
      '-' +
      (byteToHex[bytes[4] ?? 0] ?? '00') +
      (byteToHex[bytes[5] ?? 0] ?? '00') +
      '-' +
      (byteToHex[bytes[6] ?? 0] ?? '00') +
      (byteToHex[bytes[7] ?? 0] ?? '00') +
      '-' +
      (byteToHex[bytes[8] ?? 0] ?? '00') +
      (byteToHex[bytes[9] ?? 0] ?? '00') +
      '-' +
      (byteToHex[bytes[10] ?? 0] ?? '00') +
      (byteToHex[bytes[11] ?? 0] ?? '00') +
      (byteToHex[bytes[12] ?? 0] ?? '00') +
      (byteToHex[bytes[13] ?? 0] ?? '00') +
      (byteToHex[bytes[14] ?? 0] ?? '00') +
      (byteToHex[bytes[15] ?? 0] ?? '00')
    );
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
