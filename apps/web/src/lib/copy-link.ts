/**
 * Copy link, from the menu of a note row (record 0164).
 *
 * The address of a note is the address of its screen in this application, so
 * a person can paste it into a message to themself or open it on another
 * device that signs in to the same account. The workspace stays in the
 * address, so the note keeps a stable link (record 0049). It is not a
 * published link: it opens nothing for a person without an account, and
 * Publish is the action for that (record 0030).
 *
 * This module is pure. The caller passes the origin of the page and the
 * clipboard writer, so a unit test holds both results.
 */

/** The sentence of each result of a copy. */
export const copyLinkMessages = {
  copied: 'The link to the note is on the clipboard.',
  failed:
    'This browser cannot copy the link. Open the note and copy its address.',
} as const;

/** The address of the screen of one note. */
export function noteAddress(
  origin: string,
  workspaceId: string,
  fileId: string,
): string {
  return `${origin}/w/${workspaceId}/notes/${fileId}`;
}

/** Copies the address of one note and answers the sentence of the result. */
export async function copyNoteLink(
  address: string,
  copy: (text: string) => Promise<boolean>,
): Promise<string> {
  return (await copy(address))
    ? copyLinkMessages.copied
    : copyLinkMessages.failed;
}
