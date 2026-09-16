/**
 * The page use case: everything that one published address shows.
 *
 * Decision 0031 makes the published page one document that the server builds,
 * and decision 0047 makes it the answer for every state of a link. That one
 * document needs four facts at once, so this use case answers all four from
 * one read:
 *
 * ```text
 * whether the link opens, or waits for a password, or opens nothing
 * every note that the link opens, so the page can resolve a link between two
 * the note that the address named, with the Markdown of its current head
 * the attachment references of that note, so a picture gets an address
 * ```
 *
 * A page that asked four questions would open four transactions and could read
 * four different instants of the workspace. One read answers one instant.
 *
 * The rules are the rules of the neighbouring files and none of them is
 * repeated here. `readAccess` decides what the record of the link allows,
 * `isNoteInScope` decides every note again after the storage layer bounded its
 * query, and the reference rule of `attachment-reference.ts` decides what the
 * address of a picture may name.
 *
 * `locked` is the one state that a caller can tell apart from a refusal, and
 * it exists because a password form cannot be shown without it. Every other
 * failure, including a note outside the scope, answers `unavailable`, so the
 * four causes of decision 0030 still read alike.
 */
import { maxListedFiles } from '../files/read.ts';
import type {
  PublishedAttachmentReference,
  PublishedLink,
  PublishedNote,
  PublishedNoteContent,
} from './model.ts';
import type { PublicationContext } from './ports.ts';
import { readAccess, type ReaderCredentials } from './resolve-link.ts';
import { isNoteInScope } from './scope.ts';

/** Orders two stored paths by their code points, as the file tree does. */
function byPath(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** What one published address shows. */
export type PublishedPage =
  /** The link opens nothing now, whatever the cause. */
  | { readonly kind: 'unavailable' }
  /** The link opens after a password that this address did not carry. */
  | { readonly kind: 'locked' }
  /** The link opens, and the address named no note of it. */
  | {
      readonly kind: 'list';
      readonly link: PublishedLink;
      readonly notes: readonly PublishedNote[];
    }
  /** The link opens, and the address named one note that it opens. */
  | {
      readonly kind: 'note';
      readonly link: PublishedLink;
      /** Every note that the link opens, for the links inside this one. */
      readonly notes: readonly PublishedNote[];
      readonly note: PublishedNoteContent;
      readonly attachments: readonly PublishedAttachmentReference[];
    };

/**
 * Answers what this address shows.
 *
 * `fileId` is the note that the address named, or `null` when it named none. A
 * link over one note opens that note when the address names none, so a reader
 * of such a link never sees a list of one.
 */
export function readPublishedPage(
  context: PublicationContext,
  credentials: ReaderCredentials,
  fileId: string | null,
): Promise<PublishedPage> {
  return context.store.read(async (reader) => {
    const access = await readAccess(context, reader, credentials);
    if (access.kind !== 'open') return access;
    const link = access.link;
    const found = await reader.notesOfLink(link, maxListedFiles);
    const notes = found
      .filter((note) => isNoteInScope(link.scope, note))
      .toSorted((left, right) => byPath(left.path, right.path));
    const wanted =
      fileId ?? (link.scope.kind === 'note' ? link.scope.fileId : null);
    if (wanted === null) return { kind: 'list', link, notes };
    const note = await reader.noteOfLink(link, wanted);
    if (note === null || !isNoteInScope(link.scope, note)) {
      context.refusals.record('out_of_scope');
      return { kind: 'unavailable' };
    }
    const attachments = await reader.attachmentsOfNote(link, note);
    return { kind: 'note', link, notes, note, attachments };
  });
}
