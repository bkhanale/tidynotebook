/**
 * Copy this note as Markdown, from the command palette.
 *
 * The action copies the whole text of the open editor, with no selection.
 * The document of the editor is the Markdown source of the note (record
 * 0133), and that source is portable at rest (record 0021), so the copy is
 * the text a person sees, with every edit that is not saved yet. Export as
 * Markdown reads the saved version from the server instead, so the two
 * actions answer two different needs.
 *
 * The palette closes before the action runs, so nothing on the screen shows
 * that the copy happened. The editor shows the one sentence of the result in
 * a toast that goes away by itself after {@link copyNoticeMs}.
 *
 * This module is pure. The caller passes the clipboard writer, so a unit test
 * holds both results without a browser.
 */

/** The sentence of each result of a copy. */
export const copyNoteMessages = {
  copied: 'The note is on the clipboard.',
  failed: 'This browser cannot copy the note. Use Export as Markdown.',
} as const;

/** How long the sentence of a copy stays on the screen. */
export const copyNoticeMs = 4000;

/**
 * Copies the whole text of one note and answers the sentence of the result.
 *
 * `copy` answers `false` when the page has no clipboard, as `copyText` of
 * `platform.ts` does on a page served over plain HTTP. An empty note copies
 * as an empty text, because an empty note is still the whole note.
 */
export async function copyNote(
  text: string,
  copy: (text: string) => Promise<boolean>,
): Promise<string> {
  const done = await copy(text);
  return done ? copyNoteMessages.copied : copyNoteMessages.failed;
}
