/**
 * Note name rules of the interface.
 *
 * The stored path always ends in one `.md` suffix and the person never sees
 * it. Every refusal has its own sentence, so a person can act on it, and no
 * refusal prints a machine code. `cleanNoteName` removes the edge spaces
 * that the domain rule refuses, so a name that only needs trimming is saved
 * instead of refused.
 */

/** The storage suffix that is hidden from note names in the interface. */
const markdownSuffix = '.md';

/** C0, delete, and C1 controls, format characters, and line separators. */
const forbiddenCharacter = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

/** The domain limits, repeated here so the message can name them. */
const maxPathBytes = 1024;
const maxSegmentBytes = 255;

/** Converts a stored Markdown path to the name that a person edits. */
export function displayNoteName(path: string): string {
  return path.toLowerCase().endsWith(markdownSuffix)
    ? path.slice(0, -markdownSuffix.length)
    : path;
}

/** Converts an edited note name to its canonical Markdown storage path. */
export function storageNotePath(name: string): string {
  return `${displayNoteName(name)}${markdownSuffix}`;
}

/** The folder part of a stored path, or an empty string at the root. */
export function folderOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/** The last segment of a stored path, without its folders. */
export function baseNameOf(path: string): string {
  return path.split('/').at(-1) ?? path;
}

/** Joins a folder and a note name into one stored path. */
export function joinNotePath(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}

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
 * Removes the spaces that the domain rule refuses.
 *
 * Every folder and the note name lose their leading and trailing white
 * space. A name that only carries a trailing space is then saved with the
 * name the person can read, instead of being refused or stored with an
 * invisible character.
 */
export function cleanNoteName(name: string): string {
  return displayNoteName(name)
    .normalize('NFC')
    .split('/')
    .map((segment) => segment.trim())
    .join('/');
}

/**
 * States why a note name is refused, with one sentence per cause.
 *
 * Returns `null` when the name is accepted. The caller passes the visible
 * name; the `.md` suffix is added afterwards and is never the cause.
 */
export function noteNameProblem(name: string): string | null {
  const cleaned = cleanNoteName(name);
  if (cleaned === '') return 'Type a note name.';
  if (!cleaned.isWellFormed())
    return 'This note name has a character that cannot be stored. Remove it.';
  if (cleaned.includes('\\'))
    return 'A note name cannot contain a backslash. Use a slash for a folder.';
  if (forbiddenCharacter.test(cleaned))
    return 'A note name cannot contain a hidden or a control character.';
  if (cleaned.startsWith('/')) return 'A note name cannot start with a slash.';
  const segments = cleaned.split('/');
  if (segments.includes(''))
    return 'A note name cannot have an empty folder. Remove the extra slash.';
  if (segments.includes('.') || segments.includes('..'))
    return 'A note name cannot use "." or ".." as a folder.';
  for (const segment of segments) {
    if (utf8Length(segment) > maxSegmentBytes)
      return `One part of this note name is longer than ${String(maxSegmentBytes)} bytes. Make it shorter.`;
  }
  if (utf8Length(storageNotePath(cleaned)) > maxPathBytes)
    return `This note name is longer than ${String(maxPathBytes)} bytes. Make it shorter.`;
  return null;
}

/**
 * States that another note already uses this name.
 *
 * The check runs before a save, so the person renames instead of meeting a
 * conflict from the server after the save was refused.
 */
export function duplicateNameProblem(
  path: string,
  files: readonly { readonly fileId: string; readonly path: string }[],
  ownFileId: string,
): string | null {
  const wanted = path.toLowerCase();
  const clash = files.find(
    (file) => file.fileId !== ownFileId && file.path.toLowerCase() === wanted,
  );
  if (clash === undefined) return null;
  return `Another note is already named ${displayNoteName(clash.path)}. Choose a different name.`;
}

/** Every folder that the note paths of a workspace imply, sorted by path. */
export function folderPaths(paths: readonly string[]): readonly string[] {
  const folders = new Set<string>();
  for (const path of paths) {
    const segments = path.split('/');
    let current = '';
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index] ?? '';
      if (segment === '') continue;
      current = current === '' ? segment : `${current}/${segment}`;
      folders.add(current);
    }
  }
  return [...folders].sort((left, right) => (left < right ? -1 : 1));
}

/**
 * Rewrites one stored path for a folder rename or a move.
 *
 * Returns `null` when the path is outside the folder, so a caller can skip
 * the note without a second condition. The root folder is the empty string.
 */
export function rewriteFolder(
  path: string,
  fromFolder: string,
  toFolder: string,
): string | null {
  if (fromFolder === '') return null;
  const prefix = `${fromFolder}/`;
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  return toFolder === '' ? rest : `${toFolder}/${rest}`;
}
