/**
 * The `Content-Disposition` header of every answer that carries a file.
 *
 * Two decisions live here, and both are stated once for the whole server.
 *
 * **What the browser does with the bytes.** The kind follows the media type,
 * not the route. An attachment image is served `inline`, because the product
 * points a browser straight at that address: the note surface shows the
 * picture, and the published reader page of
 * [decision 0031](../../../../docs/decisions/0031-the-reader-path-is-a-closed-read-only-boundary.md)
 * will resolve an image reference to the same address. Those bytes are safe to
 * render, because the upload accepts only the image types of
 * `allowedMediaTypes`, every answer carries `nosniff`, and the data content
 * policy of `security-headers.ts` permits nothing to load and nothing to
 * frame. Every other media type is served `attachment`, so a stored file that
 * is not one of those images can never render inside a served origin.
 *
 * **How a name reaches a header field.** The name comes from the person, so it
 * can hold a quote, a line break, a semicolon, a character outside ASCII, or
 * more characters than a header should carry. The value is built in the RFC
 * 6266 form: a quoted ASCII `filename` that an old client reads, and a
 * `filename*` in the RFC 8187 form that carries the real name. Nothing reaches
 * the header unencoded, so no input can end the field or start a second one.
 */
import { Buffer } from 'node:buffer';
import { isAllowedMediaType } from '@notesapp/core';

/** What the browser does with the bytes of an answer. */
export type DispositionKind = 'attachment' | 'inline';

/**
 * The longest download name, in code points.
 *
 * A name is bounded before it is encoded, because one code point outside
 * ASCII becomes up to twelve characters in the encoded form. Sixty-four code
 * points therefore keep the whole field inside one kilobyte for any input,
 * which is the length that the contract declares for the header.
 */
const maxNameCodePoints = 64;

/** The longest suffix that a shortened name keeps. */
const maxSuffixCodePoints = 16;

/**
 * The characters that RFC 8187 carries unencoded in an extended value.
 *
 * Everything else, and that includes the quote, the semicolon, the space, the
 * apostrophe and every control character, is percent encoded.
 */
const attributeCharacter = /^[A-Za-z0-9!#$&+\-.^_`|~]$/;

/** The kind that a media type earns. */
export function dispositionKind(mediaType: string): DispositionKind {
  const base = (mediaType.split(';')[0] ?? '').trim().toLowerCase();
  return isAllowedMediaType(base) ? 'inline' : 'attachment';
}

/** The last segment of a stored path, which is the name a person reads. */
export function downloadName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * The code points of a string.
 *
 * The code point is the unit of every rule below, because each one maps or
 * counts one stored character. A UTF-16 unit is the wrong unit: it can cut a
 * surrogate pair in half and leave a string that is not well formed.
 */
function codePoints(value: string): readonly string[] {
  const points: string[] = [];
  for (const character of value) points.push(character);
  return points;
}

/**
 * The name, shortened to the bound, with its suffix kept.
 *
 * The suffix decides which application opens a saved file, so a shortened
 * name keeps it. A suffix that is longer than `maxSuffixCodePoints` is not a
 * suffix, so it is dropped with the rest.
 */
function shorten(name: string): string {
  const points = codePoints(name);
  if (points.length <= maxNameCodePoints) return name;
  const dot = name.lastIndexOf('.');
  const suffix = dot <= 0 ? [] : codePoints(name.slice(dot));
  const kept =
    suffix.length > 0 && suffix.length <= maxSuffixCodePoints ? suffix : [];
  return [...points.slice(0, maxNameCodePoints - kept.length), ...kept].join(
    '',
  );
}

/**
 * The ASCII form, for the quoted `filename` field.
 *
 * A quoted string carries the printable ASCII range without the quote and the
 * backslash. Every other character becomes one underscore, and that includes
 * a carriage return, a line feed, and every character outside ASCII. A path
 * separator also becomes an underscore, so a name can never propose a
 * directory to the client that saves it.
 */
function asciiName(name: string): string {
  let safe = '';
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    const carried =
      code >= 0x20 &&
      code <= 0x7e &&
      character !== '"' &&
      character !== '\\' &&
      character !== '/';
    safe += carried ? character : '_';
  }
  return safe;
}

/** The RFC 8187 extended value of a name, in UTF-8. */
function extendedValue(name: string): string {
  let encoded = '';
  for (const byte of Buffer.from(name, 'utf8')) {
    const character = String.fromCharCode(byte);
    encoded += attributeCharacter.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return encoded;
}

/**
 * Builds the header value of one download.
 *
 * @param input.kind what the browser does with the bytes.
 * @param input.name the name that the person gave the file.
 * @param input.fallback the name to use when nothing usable is left.
 */
export function contentDisposition(input: {
  readonly kind: DispositionKind;
  readonly name: string;
  readonly fallback: string;
}): string {
  const name = shorten(input.name.trim());
  const ascii = asciiName(name).trim();
  const quoted = ascii === '' ? asciiName(input.fallback) : ascii;
  const extended = extendedValue(name === '' ? input.fallback : name);
  return `${input.kind}; filename="${quoted}"; filename*=UTF-8''${extended}`;
}
