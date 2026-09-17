/**
 * The scope rule: what one link opens.
 *
 * A note link opens one note by its identifier, so a rename keeps the link. A
 * folder link opens every note below one folder, because a folder is a part of
 * a note path under decision 0005.
 *
 * The comparison of a folder runs over path segments, never over characters.
 * `isBelowFolder` in `../files/path.ts` holds that rule, and the rename of a
 * folder reads the same one, so the two can never drift apart.
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
import { isBelowFolder, normalizePath } from '../files/path.ts';
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
  return isBelowFolder(folder.value.split('/'), path.value.split('/'));
}
