/**
 * Where each file of an imported archive goes, and the links of its notes.
 *
 * An archive of an export holds notes at their folder paths and pictures in
 * `attachments/`. An Obsidian vault holds the same Markdown with three
 * differences (record 0171): pictures beside the notes, the folder of the
 * settings of Obsidian with the other hidden entries of a file system, and
 * wiki links. This module states what the import does with each, as pure
 * functions, so a unit test holds every case and the handler of
 * `import.ts` only reads the archive and commits.
 *
 * - A hidden entry, one with a segment that starts with a dot, and an entry
 *   of the `__MACOSX` folder of a macOS archive, are not notes. The import
 *   leaves them out.
 * - A picture outside `attachments/` goes to `attachments/<its path>`, and a
 *   standard link to it follows, so the import keeps the one place of the
 *   pictures of the product and the note keeps its picture.
 * - A wiki link becomes a standard link when its target is a note or a
 *   picture of the archive, through `convertWikiLinks` of
 *   `@notesapp/markdown`, the one converter.
 *
 * A note whose new text would grow past the limits of the grammar keeps the
 * text of the archive, which the import already checked.
 */
import {
  convertWikiLinks,
  markdownLimits,
  rewriteRelativeReferences,
  wikiLinkResolver,
  type WikiResolver,
} from '@notesapp/markdown';

/** The folder that holds every picture of a workspace. */
export const attachmentsFolder = 'attachments/';

/** Whether an entry of an archive is a hidden file or a folder of a system. */
export function hiddenEntry(path: string): boolean {
  return path
    .split('/')
    .some((segment) => segment.startsWith('.') || segment === '__MACOSX');
}

/** The path that one picture of an archive takes in the workspace. */
export function importedPicturePath(path: string): string {
  return path.startsWith(attachmentsFolder)
    ? path
    : `${attachmentsFolder}${path}`;
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
 * wiki links over every note and picture at the path it takes.
 */
export function archiveLinks(
  notes: readonly string[],
  pictures: readonly string[],
): ArchiveLinks {
  const moved = new Map<string, string>();
  for (const path of pictures) {
    const next = importedPicturePath(path);
    if (next !== path) moved.set(path, next);
  }
  return {
    moved,
    resolve: wikiLinkResolver([
      ...notes,
      ...pictures.map(importedPicturePath),
    ]),
  };
}

/** The UTF-8 size of a text, as the limits of the grammar count it. */
function utf8Bytes(text: string): number {
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
