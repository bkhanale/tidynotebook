/**
 * The rules of the diagram script of a published page (record 0158).
 *
 * A published page shows the source of each Mermaid fence as a code block,
 * which is what a reader with no script reads. The script of
 * `src/published/diagrams.ts` puts the sandboxed frame of the editor in place
 * of each one. The decisions it takes are pure, so they live here with their
 * test, and the script holds the DOM work alone.
 */
import { diagramLimits, type DiagramTheme } from '../diagram/frame.ts';

/**
 * The placeholder of one diagram, as `renderMarkdown` writes it.
 *
 * The renderer is the one producer of the attribute. An author cannot write
 * it, because the author list of record 0157 names no data attribute.
 */
export const publishedDiagramSelector = 'pre[data-diagram="mermaid"]';

/** The preference of the device that a published page follows (record 0151). */
export const darkPreferenceQuery = '(prefers-color-scheme: dark)';

/**
 * The appearance that a diagram draws in.
 *
 * A published page states no theme and follows the device, so the diagram
 * follows the same preference and the same Default palette as the page.
 */
export function diagramThemeOf(prefersDark: boolean): DiagramTheme {
  return prefersDark ? 'dark' : 'light';
}

/**
 * Whether the script draws one source.
 *
 * An empty source draws nothing, and a source over the limit of the frame is
 * one that the frame refuses, so the code block stays for both.
 */
export function drawsDiagram(source: string): boolean {
  return source.trim() !== '' && source.length <= diagramLimits.maxSourceChars;
}
