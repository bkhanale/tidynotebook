/**
 * The note use case: read one note that this link opens.
 *
 * A note link opens its one note. A folder link opens every note below the
 * folder, so a reader that follows a link on the page names the note it wants.
 * Both cases pass this one use case, so no caller states the scope rule for
 * itself and no caller can forget the Trash.
 *
 * The order is the order of decision 0031: the link opens first, then the
 * scope decides, and only then does the content travel. A note that the link
 * does not open takes the one refusal, which is the answer of a link that
 * never existed, so the reader learns nothing about the note.
 */
import type { Result } from '../files/model.ts';
import { ok } from '../files/model.ts';
import { refuseRead } from './errors.ts';
import type { PublishedLink, PublishedNoteContent } from './model.ts';
import type { PublicationContext } from './ports.ts';
import { openLink, type ReaderCredentials } from './resolve-link.ts';
import { isNoteInScope } from './scope.ts';

/** One note of a link, with the link that opened it. */
export type PublishedNoteRead = {
  readonly link: PublishedLink;
  readonly note: PublishedNoteContent;
};

/** Answers one note that this address opens, or the one refusal. */
export function readPublishedNote(
  context: PublicationContext,
  credentials: ReaderCredentials,
  fileId: string,
): Promise<Result<PublishedNoteRead>> {
  return context.store.read(async (reader) => {
    const opened = await openLink(context, reader, credentials);
    if (!opened.ok) return opened;
    const link = opened.value;
    const note = await reader.noteOfLink(link, fileId);
    if (note === null || !isNoteInScope(link.scope, note))
      return refuseRead<PublishedNoteRead>(context.refusals, 'out_of_scope');
    return ok({ link, note });
  });
}
