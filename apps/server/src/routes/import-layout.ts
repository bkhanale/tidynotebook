/**
 * Where each file of an imported archive goes, and the links of its notes.
 *
 * An archive of an export holds notes at their folder paths and pictures in
 * `attachments/`. An Obsidian vault holds the same Markdown with three
 * differences (record 0172): pictures beside the notes, the settings of the
 * tool and of a file system, and wiki links. This module states what the
 * import does with each, as pure functions, so a unit test holds every case
 * and the handler of `import.ts` only reads the archive and commits.
 *
 * - The settings of a tool are not notes: the folders `.obsidian`, `.trash`
 *   and `.git`, the `__MACOSX` folder of a macOS archive, `.DS_Store`, and a
 *   `._` file of macOS. Every other hidden name is a note or a picture like
 *   any other, because an export writes it, so a backup comes back whole.
 * - A note is a `.md` file and a picture is an image type of
 *   `@notesapp/core`. Every other file is left out. The answer names what
 *   was left out, so nothing goes in silence.
 * - A picture outside `attachments/` goes to `attachments/<its path>`, under
 *   another free name when that path is taken, and a standard link to it
 *   follows, so the import keeps the one place of the pictures of the
 *   product and the note keeps its picture.
 * - A wiki link becomes a standard link when its target is a note or a
 *   picture of the archive, through `convertWikiLinks` of
 *   `@notesapp/markdown`, the one converter. A target resolves among the
 *   paths of the archive, where the folder of a picture is the folder that
 *   the vault states, and only then takes the path the picture moves to.
 *
 * A note whose new text would grow past the limits of the grammar keeps the
 * text of the archive, which the import already checked.
 */
import { attachmentMediaTypeOf } from '@notesapp/core';
import {
  convertWikiLinks,
  markdownLimits,
  rewriteRelativeReferences,
  wikiLinkResolver,
  type WikiResolver,
} from '@notesapp/markdown';

/** The folder that holds every picture of a workspace. */
export const attachmentsFolder = 'attachments/';

/** The folders that hold the settings of a tool, and never a note. */
const toolFolders: ReadonlySet<string> = new Set([
  '.obsidian',
  '.trash',
  '.git',
  '__MACOSX',
]);

/** Whether an entry of an archive holds the settings of a tool. */
export function toolEntry(path: string): boolean {
  const segments = path.split('/');
  const name = segments.at(-1) ?? '';
  return (
    segments.slice(0, -1).some((segment) => toolFolders.has(segment)) ||
    name === '.DS_Store' ||
    name.startsWith('._')
  );
}

/** What the import does with one entry of an archive. */
export type EntryRole = 'note' | 'picture' | 'skipped';

/** The role of one entry, from its path. */
export function entryRole(path: string): EntryRole {
  if (toolEntry(path)) return 'skipped';
  if (path.endsWith('.md')) return 'note';
  return attachmentMediaTypeOf(path) === null ? 'skipped' : 'picture';
}

/** The kind of a file that an import leaves out, for its answer. */
export function skippedKind(path: string): string {
  if (toolEntry(path)) return 'settings';
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? 'file' : name.slice(dot + 1).toLowerCase();
}

/** The files that an import leaves out: how many, and of which kinds. */
export type SkippedFiles = {
  readonly files: number;
  readonly kinds: readonly string[];
};

/** The files left out of an archive, as the answer of an import states them. */
export function skippedFiles(paths: readonly string[]): SkippedFiles {
  return {
    files: paths.length,
    kinds: [...new Set(paths.map(skippedKind))].sort().slice(0, 50),
  };
}

/** A path with ` 2`, ` 3` and so on before its extension. */
function numbered(path: string, number: number): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash + 1
    ? `${path.slice(0, dot)} ${String(number)}${path.slice(dot)}`
    : `${path} ${String(number)}`;
}

/**
 * The path that each picture of an archive takes in the workspace.
 *
 * A picture in `attachments/` keeps its path. Any other picture goes to
 * `attachments/<its path>`, and when that path is taken by another file of
 * the archive it takes the first free name with a number, so both pictures
 * come in: `x.png` beside `attachments/x.png` becomes `attachments/x 2.png`.
 */
export function placedPictures(
  pictures: readonly string[],
  others: readonly string[],
): ReadonlyMap<string, string> {
  const taken = new Set<string>([
    ...others,
    ...pictures.filter((path) => path.startsWith(attachmentsFolder)),
  ]);
  const placed = new Map<string, string>();
  for (const path of pictures) {
    if (path.startsWith(attachmentsFolder)) {
      placed.set(path, path);
      continue;
    }
    const wanted = `${attachmentsFolder}${path}`;
    let next = wanted;
    for (let number = 2; taken.has(next); number += 1)
      next = numbered(wanted, number);
    taken.add(next);
    placed.set(path, next);
  }
  return placed;
}

/** What the notes of one archive need to rewrite their links. */
export type ArchiveLinks = {
  /** The pictures that moved, from the path of the archive to the new one. */
  readonly moved: ReadonlyMap<string, string>;
  /** The resolver of the wiki links of the archive. */
  readonly resolve: WikiResolver;
};

/**
 * The links of one archive: the pictures that move, and the resolver of the
 * wiki links.
 *
 * The resolver reads the paths of the archive, so the picture in the folder
 * of a note wins as the vault states it, and then answers the path that the
 * picture takes.
 */
export function archiveLinks(
  notes: readonly string[],
  pictures: ReadonlyMap<string, string>,
): ArchiveLinks {
  const moved = new Map<string, string>();
  for (const [from, to] of pictures) if (from !== to) moved.set(from, to);
  const resolveInArchive = wikiLinkResolver([...notes, ...pictures.keys()]);
  return {
    moved,
    resolve: (target, sourcePath) => {
      const found = resolveInArchive(target, sourcePath);
      return found === null ? null : (moved.get(found) ?? found);
    },
  };
}

/** The UTF-8 size of a text, as the limits of the grammar count it. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The text that one note of an archive takes in the workspace.
 *
 * A standard link to a picture that moved follows it, and each wiki link that
 * resolves becomes a standard link. Every other character stays as the
 * archive holds it.
 */
export function importedNoteText(
  text: string,
  path: string,
  links: ArchiveLinks,
): string {
  try {
    const followed =
      links.moved.size === 0
        ? text
        : rewriteRelativeReferences(text, path, links.moved).text;
    const linked = convertWikiLinks(followed, path, links.resolve).text;
    return utf8Bytes(linked) <= markdownLimits.maxInputBytes ? linked : text;
  } catch {
    // A note that the grammar refuses keeps its text, and the commit states
    // the refusal for it, as it does for a note of an export.
    return text;
  }
}
