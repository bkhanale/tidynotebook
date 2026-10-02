/**
 * The rules of the copy action of a published code block (record 0174).
 *
 * `renderMarkdown` writes each code block as a `figure` of the class of
 * `codeBlockClass`, with its language as its caption and its code in a `pre`.
 * The script of `src/published/page.ts` puts a copy control on each one. The
 * decisions it takes are pure, so they live here with their test, and the
 * script holds the DOM work alone.
 */
/**
 * The figure of one code block, as `renderMarkdown` writes it.
 *
 * The script of a page loads no part of the renderer, so it names the class
 * here, and `published-code.test.ts` holds it to `codeBlockClass`.
 */
export const publishedCodeSelector = 'figure.notes-code';

/**
 * The text that the copy of one block takes.
 *
 * The renderer ends the code of a block with one line break, which is not
 * part of the code, so the copy holds what the person wrote and no more.
 */
export function copiedCode(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/**
 * The classes of the copy control of a published block, at the end of the
 * bar at the top of the card. The label stands at the start of the bar.
 */
export const publishedCopyPlace = 'absolute right-1 top-0 md:right-2 md:top-1.5';
