/**
 * The scope rule: what one link opens.
 *
 * A note link opens one note by its identifier, so a rename keeps the link. A
 * folder link opens every note below one folder, because a folder is a part of
 * a note path under decision 0005.
 *
 * The comparison of a folder runs over path segments, never over characters.
 * A folder `notes/trip` and a note `notes/trips-2026/x.md` share the first
 * eleven characters, so a plain prefix test would open a folder that the owner
 * never published. The rule therefore splits both paths at `/` and compares
 * segment by segment. The note also has to sit below the folder, so the folder
 * itself, and a note `notes/trip.md` beside it, stay out.
 *
 * Both paths pass `normalizePath` of `../files/path.ts` first, so the scope
 * reads one spelling of one name. A note path keeps the one `.md` rule, so a
 * link opens a note and never an attachment. A path that the rule refuses is
 * out of scope, so the rule fails closed.
 *
 * A note in the Trash is out of scope, as decision 0030 states. The Trash is
 * the set of files whose head is a tombstone, so the rule reads the `deleted`
 * member of the note and refuses it there. A caller cannot forget the Trash,
 * because it does not state it.
 */
import { fail, ok, type Result } from '../files/model.ts';
import { normalizePath } from '../files/path.ts';
import type { PublicationScope, ScopedNote } from './model.ts';

/**
 * Reads the scope that a request states.
 *
 * The answer is the scope in its stored spelling. A folder path follows every
 * workspace path rule and carries no trailing separator. A note scope needs an
 * identifier, and the workspace decides later whether a note holds it.
 */
export function normalizeScope(
  scope: PublicationScope,
): Result<PublicationScope> {
  if (scope.kind === 'note') {
    if (scope.fileId.length === 0) return fail('not_found');
    return ok({ kind: 'note', fileId: scope.fileId });
  }
  const path = normalizePath(scope.path, 'folder');
  if (!path.ok) return path;
  return ok({ kind: 'folder', path: path.value });
}

/**
 * The stored path prefix of a folder link, with its separator.
 *
 * The storage layer builds the bound of its query from this value, so the SQL
 * and the rule read one shape. The answer is `null` for a note link and for a
 * folder path that the path rules refuse.
 */
export function folderScopePrefix(scope: PublicationScope): string | null {
  if (scope.kind !== 'folder') return null;
  const path = normalizePath(scope.path, 'folder');
  return path.ok ? `${path.value}/` : null;
}

/** Whether the link opens this note now. */
export function isNoteInScope(
  scope: PublicationScope,
  note: ScopedNote,
): boolean {
  // A note in the Trash is out of scope, whatever the scope states.
  if (note.deleted) return false;
  const path = normalizePath(note.path, 'note');
  if (!path.ok) return false;
  if (scope.kind === 'note')
    return scope.fileId.length > 0 && note.fileId === scope.fileId;
  const folder = normalizePath(scope.path, 'folder');
  if (!folder.ok) return false;
  const folderSegments = folder.value.split('/');
  const noteSegments = path.value.split('/');
  // The note sits below the folder, so it holds one segment more at least.
  if (noteSegments.length <= folderSegments.length) return false;
  return folderSegments.every(
    (segment, index) => noteSegments[index] === segment,
  );
}
