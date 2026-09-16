/**
 * Pure derivation of the notes that link to one note, from local bodies.
 *
 * This is the answer the device can give with no connection. The accepted
 * index `note_links` on the server stays the one index at rest and the one
 * authority; this module adds nothing at rest. It reads the rows that
 * `listSearchFiles` already gives the command palette, which hold every
 * accepted note body with the current draft on top, and it reports the notes
 * whose text holds a link that resolves to the open note. See decision 0037.
 *
 * A full parse of every note is not affordable, so the derivation filters
 * before it parses. A link that resolves to a target path holds the last
 * segment of that path in its destination, because the resolver builds the
 * resolved path by appending the segments of the destination. A body that
 * does not hold that name in any spelling can therefore hold no link to the
 * target, and only a body that holds one reaches `extractLinks`.
 *
 * Three spellings reach the same path, and two rules cover all three:
 *
 * - The composed form, which is the form every stored path keeps, and the
 *   decomposed form, which the resolver composes before it compares. The
 *   filter looks for both.
 * - The percent encoded form that `portableRelativePath` writes. An author or
 *   an imported file can escape any character, so the filter sends a body that
 *   holds a percent sign to the parse without a scan. That rule covers the
 *   canonical encoded name too, because that name holds a percent sign. A body
 *   with no percent sign can hide no name behind an escape, so the filter
 *   loses nothing.
 *
 * One spelling stays outside the filter: a character that composes to another
 * character, such as the Kelvin sign, resolves to the plain letter and no scan
 * finds it. The server index holds that link, so the merged panel still shows
 * it when the server answers.
 */
import { extractLinks } from '@notesapp/markdown';
import type { LocalSearchFile } from './local-search.ts';

/** One note of this device that links to the note a person reads. */
export type LocalBacklink = {
  readonly fileId: string;
  readonly path: string;
  readonly revisionId: string;
};

/** The last segment of a stored path. */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The forms of `name` that a destination can hold without an escape. */
function spellings(name: string): readonly string[] {
  return [...new Set([name, name.normalize('NFD')])];
}

/** Reports whether `text` can hold a link to a note with this name. */
function canHoldLink(text: string, names: readonly string[]): boolean {
  if (text.includes('%')) return true;
  return names.some((name) => text.includes(name));
}

/**
 * Reports whether one body holds a link that resolves to `targetPath`.
 *
 * A body larger or deeper than the shared parser accepts holds no link this
 * device can read. The server refuses such a body too, so it can only be a
 * local draft, and the panel states the rest of its answer.
 */
function linksTo(file: LocalSearchFile, targetPath: string): boolean {
  try {
    return extractLinks(file.text, file.path).some(
      (link) => link.targetPath === targetPath,
    );
  } catch {
    return false;
  }
}

/**
 * Lists the notes on this device that link to one note.
 *
 * The result is `null` when this device does not hold the note itself. The
 * device then knows no path for it, so it has no answer to give and the
 * caller reports a failed or a server only read rather than an empty one.
 *
 * If the input holds more than one state for a file, the last state wins, as
 * in `searchLocal`. The browser store places drafts after accepted states, so
 * a link in an unsaved draft counts, which the server index cannot show. A
 * note that links to itself is listed, which is what the server index holds
 * too.
 */
export function localBacklinks(
  targetFileId: string,
  files: readonly LocalSearchFile[],
): readonly LocalBacklink[] | null {
  const latest = new Map<string, LocalSearchFile>();
  for (const file of files) latest.set(file.fileId, file);
  const target = latest.get(targetFileId);
  if (target === undefined) return null;
  const names = spellings(baseName(target.path));
  const found: LocalBacklink[] = [];
  for (const file of latest.values()) {
    if (!canHoldLink(file.text, names)) continue;
    if (!linksTo(file, target.path)) continue;
    found.push({
      fileId: file.fileId,
      path: file.path,
      revisionId: file.revisionId,
    });
  }
  return found.sort((left, right) => (left.path < right.path ? -1 : 1));
}
