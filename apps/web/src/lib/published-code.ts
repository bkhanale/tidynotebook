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

/** The caption of a block, which holds its label, as the renderer writes it. */
export const publishedCodeLabelSelector = 'figcaption.notes-code-label';

/** The part of a figure that the label of its block is read from. */
export type CodeFigure = {
  querySelector(
    selector: string,
  ): { readonly textContent: string | null } | null;
};

/**
 * The label of the block of one figure, or `null` for a block with none.
 *
 * The copy control names its block by this label, as the bar of the editor
 * does, so two controls of a page differ.
 */
export function publishedCodeLabel(figure: CodeFigure): string | null {
  const text =
    figure.querySelector(publishedCodeLabelSelector)?.textContent?.trim() ?? '';
  return text === '' ? null : text;
}

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
export const publishedCopyPlace =
  'absolute right-1 top-0 md:right-2 md:top-1.5';
