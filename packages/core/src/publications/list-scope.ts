/**
 * The listing use case: every note that this link opens.
 *
 * A folder link lists every note below the folder, now and later, which is
 * what the create dialog states before the owner confirms. A note link lists
 * its one note, so the page of either kind reads one answer.
 *
 * The storage layer bounds its query by the scope of the link. The rule checks
 * every note again here, so a query that reaches too far still lists nothing
 * that the link does not open. A note in the Trash never reaches the list.
 *
 * The order is the path order, so the page of a folder reads like the folder
 * tree. The bound is `maxListedFiles` of `../files/read.ts`, which is the
 * bound of every other listing of this package.
 */
import { ok, type Result } from '../files/model.ts';
import { maxListedFiles } from '../files/read.ts';
import type { PublishedLink, PublishedNote } from './model.ts';
import type { PublicationContext } from './ports.ts';
import { openLink, type ReaderCredentials } from './resolve-link.ts';
import { isNoteInScope } from './scope.ts';

/** Orders two stored paths by their code points, as the file tree does. */
function byPath(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** The notes of one link, with the link that opened them. */
export type PublishedNoteList = {
  readonly link: PublishedLink;
  readonly notes: readonly PublishedNote[];
};

/** Answers every note that this address opens, or the one refusal. */
export function listPublishedNotes(
  context: PublicationContext,
  credentials: ReaderCredentials,
): Promise<Result<PublishedNoteList>> {
  return context.store.read(async (reader) => {
    const opened = await openLink(context, reader, credentials);
    if (!opened.ok) return opened;
    const link = opened.value;
    const found = await reader.notesOfLink(link, maxListedFiles);
    const notes = found
      .filter((note) => isNoteInScope(link.scope, note))
      .toSorted((left, right) => byPath(left.path, right.path));
    return ok({ link, notes });
  });
}
