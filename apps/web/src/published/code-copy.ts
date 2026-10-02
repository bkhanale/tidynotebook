/**
 * The copy action of each code block of a published page (record 0174).
 *
 * The page shows each block with its language in a bar at the top of the
 * card, which a reader with no script reads too. This module puts a copy
 * control at the other end of the bar. The control is the ghost button of
 * `packages/ui`, with the copy glyph and its word, and its name states what
 * it copies. A copy says Copied for a moment. A browser with no clipboard,
 * such as one that opened the page over plain HTTP, gets no control, and the
 * reader selects the code instead.
 */
import {
  buttonClassName,
  checkParts,
  compactButtonVisualClassName,
  copiedForMs,
  copyCodeWords,
  copyParts,
  glyph,
} from '@notesapp/ui';
import {
  copiedCode,
  publishedCodeSelector,
  publishedCopyPlace,
} from '../lib/published-code.ts';

/** The class of the glyph inside the control: the 16 px of a control. */
const glyphClass = 'size-4 shrink-0';

/** One copy control for the code block of one figure. */
function copyControl(figure: HTMLElement, code: HTMLElement): HTMLElement {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = buttonClassName({
    variant: 'ghost',
    size: 'sm',
    compact: true,
    className: publishedCopyPlace,
  });
  control.setAttribute('aria-label', copyCodeWords.name);
  const surface = document.createElement('span');
  surface.className = compactButtonVisualClassName({
    variant: 'ghost',
    size: 'sm',
    iconOnly: false,
  });
  const word = document.createElement('span');
  word.textContent = copyCodeWords.action;
  const status = document.createElement('span');
  status.className = 'sr-only';
  status.setAttribute('role', 'status');
  surface.append(glyph(glyphClass, copyParts), word);
  control.append(surface, status);
  let timer = 0;
  control.addEventListener('click', () => {
    void navigator.clipboard
      .writeText(copiedCode(code.textContent ?? ''))
      .then(() => {
        surface.replaceChildren(glyph(glyphClass, checkParts), word);
        word.textContent = copyCodeWords.done;
        status.textContent = copyCodeWords.announcement;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          surface.replaceChildren(glyph(glyphClass, copyParts), word);
          word.textContent = copyCodeWords.action;
          status.textContent = '';
        }, copiedForMs);
      })
      .catch(() => {
        // A copy that the browser refuses selects the code, so the reader
        // copies it with the keyboard.
        window.getSelection()?.selectAllChildren(code);
      });
  });
  figure.append(control);
  return control;
}

/** Puts a copy control on every code block of the page. */
export function startCodeCopy(): void {
  // `navigator.clipboard` is absent where the page is not a secure context.
  if (typeof navigator.clipboard?.writeText !== 'function') return;
  for (const figure of document.querySelectorAll<HTMLElement>(
    publishedCodeSelector,
  )) {
    const code = figure.querySelector<HTMLElement>('pre code');
    if (code !== null) copyControl(figure, code);
  }
}
