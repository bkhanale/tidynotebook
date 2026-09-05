/**
 * File path rules.
 *
 * A workspace path is a relative POSIX path with `/` separators. The path is
 * Unicode NFC normalized and compared case sensitively, so `Notes/a.md` and
 * `notes/a.md` are two different files. The workspace enforces uniqueness over
 * the normalized value, so the composed and the decomposed spelling of one
 * name cannot become two files.
 *
 * The limits are 1024 UTF-8 bytes for the whole path and 255 UTF-8 bytes for
 * one segment. Bytes are counted, not code units, because a storage layer and
 * a file system apply byte limits.
 */
import { fail, ok, type Result } from './model.ts';

/**
 * The kind of file that the path names.
 *
 * A `note` path must end in `.md`. An `attachment` path keeps the uploaded
 * name and needs no fixed suffix. The parameter is optional and defaults to
 * `note`, so `normalizePath(input)` states the Markdown rule. This is the
 * documented choice between a separate function and a kind parameter: one
 * function keeps every other rule in one place.
 */
export type PathKind = 'note' | 'attachment';

const maxPathBytes = 1024;
const maxSegmentBytes = 255;
const markdownSuffix = '.md';

/** The UTF-8 byte length of a string, without a Node or DOM encoder. */
function utf8Length(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/**
 * Reports a C0 control character, a null byte, a delete character, or a C1
 * control character. Such a character can break a header, a log line, or a
 * file system call, so a path never carries one.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Normalizes and checks a workspace path.
 *
 * The result is the NFC form of the input when every rule holds. A rejected
 * path returns `invalid_path` with no file identifiers, because the path
 * belongs to a request that has not been accepted yet.
 */
export function normalizePath(
  input: string,
  kind: PathKind = 'note',
): Result<string> {
  const path = input.normalize('NFC');
  if (path.length === 0) return fail('invalid_path');
  if (hasControlCharacter(path)) return fail('invalid_path');
  // A backslash is a normal character on POSIX, so it would create two names
  // for one file when a client treats it as a separator.
  if (path.includes('\\')) return fail('invalid_path');
  if (path.startsWith('/')) return fail('invalid_path');
  if (utf8Length(path) > maxPathBytes) return fail('invalid_path');
  const segments = path.split('/');
  for (const segment of segments) {
    // An empty segment covers a leading, a repeated, and a trailing separator.
    if (segment.length === 0) return fail('invalid_path');
    if (segment === '.' || segment === '..') return fail('invalid_path');
    if (utf8Length(segment) > maxSegmentBytes) return fail('invalid_path');
  }
  if (kind === 'note') {
    const last = segments.at(-1) ?? '';
    // The comparison is case sensitive, so `.MD` is not a Markdown suffix, and
    // a name that is only the suffix has no title.
    if (!last.endsWith(markdownSuffix) || last.length === markdownSuffix.length)
      return fail('invalid_path');
  }
  return ok(path);
}
