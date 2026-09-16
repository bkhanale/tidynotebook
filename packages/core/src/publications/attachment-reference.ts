/**
 * The attachment reference rule: may this picture travel to this reader.
 *
 * The address of a picture names the link, the note and the attachment
 * revision, as decision 0046 states. The server trusts no part of it. This use
 * case proves all three facts in one place:
 *
 * ```text
 * the link opens now                                  (the resolve use case)
 * the note is in the scope of that link               (the scope rule)
 * the current head of that note names the revision    (the reference rule)
 * ```
 *
 * The last check reads the current content only. A revision that an older head
 * named is not a reference, so a reader that kept an address loses the picture
 * when the author drops it from the note. A picture that only a note outside
 * the scope names is refused, because the note of the address has to be in
 * scope first.
 *
 * `packages/core` reads no Markdown. The storage layer states which attachment
 * revisions the current head names, and this rule decides.
 */
import { ok, type Result } from '../files/model.ts';
import { refuseRead } from './errors.ts';
import type { PublishedLink, PublishedNote } from './model.ts';
import type { PublicationContext } from './ports.ts';
import { openLink, type ReaderCredentials } from './resolve-link.ts';
import { isNoteInScope } from './scope.ts';

/** What the address of a picture names. */
export type PublishedAttachmentRequest = {
  readonly fileId: string;
  readonly revisionId: string;
};

/** One picture that a reader may read, and the note that names it. */
export type PublishedAttachment = {
  readonly link: PublishedLink;
  readonly note: PublishedNote;
  readonly revisionId: string;
};

/** Answers the picture that this address opens, or the one refusal. */
export function resolvePublishedAttachment(
  context: PublicationContext,
  credentials: ReaderCredentials,
  request: PublishedAttachmentRequest,
): Promise<Result<PublishedAttachment>> {
  return context.store.read(async (reader) => {
    const opened = await openLink(context, reader, credentials);
    if (!opened.ok) return opened;
    const link = opened.value;
    const note = await reader.noteOfLink(link, request.fileId);
    if (note === null || !isNoteInScope(link.scope, note))
      return refuseRead<PublishedAttachment>(context.refusals, 'out_of_scope');
    const named = await reader.attachmentsOfNote(link, note);
    if (!named.includes(request.revisionId))
      return refuseRead<PublishedAttachment>(context.refusals, 'no_reference');
    return ok({ link, note, revisionId: request.revisionId });
  });
}
