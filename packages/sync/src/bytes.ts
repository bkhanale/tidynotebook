/**
 * The byte strings of the contract, as base64.
 *
 * A document update, a state vector and an observed state travel as base64 in
 * JSON. The engine and the snapshot download both read and write them, so one
 * module holds the two conversions.
 */

/** The bytes of one base64 value that the contract states. */
export function bytesOfBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** One byte string as the base64 that the contract states. */
export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
