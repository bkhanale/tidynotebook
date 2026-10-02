/**
 * The one script of a published page, which draws its diagrams (record 0158).
 *
 * The server writes a published page with no script, and it names this file
 * only when the note holds a diagram. The content policy of that page names
 * this file and the frame document by their exact address, so nothing else
 * runs. The build emits this module alone, with no import, as
 * `assets/published-diagrams-<hash>.js` (`publishedDiagramScript` in
 * `apps/web/vite.config.ts`).
 *
 * Each placeholder is the source of the diagram in a code block, which is what
 * a reader with no script reads. The script puts the sandboxed frame of
 * `src/diagram/frame.ts` in front of it and hides the code block, so the
 * reader sees the picture that the editor draws. A frame that cannot draw
 * leaves, and the code block comes back. A change of the preference of the
 * device draws every diagram again in the new palette.
 */
import { createDiagramFrame, diagramFramePath } from '../diagram/frame.ts';
import {
  darkPreferenceQuery,
  diagramThemeOf,
  drawsDiagram,
  publishedDiagramSelector,
} from '../lib/published-diagrams.ts';

/** One diagram that the script drew, and how to take it back. */
type DrawnDiagram = {
  readonly source: HTMLElement;
  readonly dispose: () => void;
};

/** The diagrams of the page now. */
let drawn: readonly DrawnDiagram[] = [];

/** Draws every diagram of the page in one appearance. */
function drawDiagrams(prefersDark: boolean): void {
  for (const diagram of drawn) {
    diagram.dispose();
    diagram.source.hidden = false;
  }
  const theme = diagramThemeOf(prefersDark);
  const next: DrawnDiagram[] = [];
  for (const source of document.querySelectorAll<HTMLElement>(
    publishedDiagramSelector,
  )) {
    const text = source.textContent ?? '';
    if (!drawsDiagram(text)) continue;
    const frame = createDiagramFrame({
      source: text,
      theme,
      framePath: diagramFramePath,
      onFailure: () => {
        frame.dispose();
        source.hidden = false;
      },
    });
    source.before(frame.element);
    source.hidden = true;
    next.push({ source, dispose: frame.dispose });
  }
  drawn = next;
}

const preference = window.matchMedia(darkPreferenceQuery);
drawDiagrams(preference.matches);
preference.addEventListener('change', (event) => {
  drawDiagrams(event.matches);
});
