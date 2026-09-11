/**
 * Read mode: the rendered surface of one note.
 *
 * Read mode shows the same document as the editor with the shared renderer.
 * The editor host in `note-editor.tsx` keeps its one CodeMirror view mounted
 * while this component is shown, so the switch back to Write is free and never
 * replaces the editor document. This file owns the rendered markup only.
 *
 * The markup comes from `renderMarkdown` in `packages/markdown`, which
 * sanitizes with the policy in `policy.ts`, so writing it here is the one
 * accepted `innerHTML` host of Read mode (decision record 0003). Mermaid keeps
 * its isolated frame here too, so Read mode never runs a diagram library inside
 * the application origin.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { RenderMarkdownOptions } from '@notesapp/markdown';
import { createDiagramFrame, type DiagramTheme } from '../../diagram/frame.ts';

/**
 * The built diagram frame document.
 *
 * A plain path string on purpose: this names a static Vite entry, not an
 * application API route, so it stays a literal instead of constructed URL.
 */
export const diagramFramePath = '/src/diagram/frame.html';

/**
 * Typography of the rendered note.
 *
 * Read mode shows the same document as the editor, so it uses the same
 * measure, the same font, and the same semantic colour tokens. The rendered
 * HTML comes from the shared renderer, so its elements are reached with
 * Tailwind element variants instead of a style sheet.
 */
const readTypography = [
  'px-4 py-6 font-sans text-note text-strong',
  '[&>*]:mx-auto [&>*]:max-w-note',
  '[&_h1]:py-note-block [&_h1]:text-note-h1 [&_h1]:font-note-heading-strong [&_h1]:text-strong',
  '[&_h2]:py-note-block [&_h2]:text-note-h2 [&_h2]:font-note-heading-strong [&_h2]:text-strong',
  '[&_h3]:py-note-block [&_h3]:text-note-h3 [&_h3]:font-note-heading-strong [&_h3]:text-strong',
  '[&_h4]:py-note-block [&_h4]:text-note-h4 [&_h4]:font-note-heading [&_h4]:text-strong',
  '[&_h5]:py-note-block [&_h5]:text-note-h5 [&_h5]:font-note-heading [&_h5]:text-strong',
  '[&_h6]:py-note-block [&_h6]:text-note-h6 [&_h6]:font-note-heading [&_h6]:text-strong',
  '[&_p]:py-note-line [&_li]:py-note-line',
  '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6',
  '[&_a]:text-accent [&_a]:underline',
  '[&_code]:rounded-sm [&_code]:bg-hover [&_code]:px-1 [&_code]:py-0.5',
  '[&_code]:font-mono [&_code]:text-note-mono',
  '[&_pre]:my-note-block [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-hover',
  '[&_pre]:p-3 [&_pre]:font-mono [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:border-l-4 [&_blockquote]:border-edge',
  '[&_blockquote]:pl-4 [&_blockquote]:text-muted [&_del]:text-muted',
  '[&_hr]:my-note-block [&_hr]:border-edge',
  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse',
  '[&_th]:border [&_th]:border-edge-subtle [&_th]:px-2 [&_th]:py-1',
  '[&_td]:border [&_td]:border-edge-subtle [&_td]:px-2 [&_td]:py-1',
  '[&_th]:text-strong [&_img]:my-note-block [&_img]:max-w-full [&_img]:rounded-md',
  '[&_input]:m-0 [&_input]:mr-1 [&_input]:size-4',
  '[&_input]:cursor-pointer [&_input]:align-text-bottom [&_input]:accent-accent-fill',
].join(' ');

/** Props of the rendered surface. */
export type ReadModeProps = {
  /** The current editor buffer, rendered as Markdown. */
  readonly text: string;
  /** The resolved attachment object URLs, keyed by revision id. */
  readonly attachmentUrls: ReadonlyMap<string, string>;
  /** The resolved appearance the diagram frames render with. */
  readonly theme: DiagramTheme;
  /**
   * The shared Markdown renderer, or `null` until it loads. Read mode shows
   * nothing until the renderer arrives, so the switch never renders stale
   * markup.
   */
  readonly renderMarkdown:
    | ((source: string, options?: RenderMarkdownOptions) => Promise<string>)
    | null;
};

/**
 * The rendered surface of one note.
 *
 * The host mounts this only while Read mode is on and keeps the editor view
 * mounted beside it. The render runs again when the buffer, the resolved
 * attachment URLs, the renderer, or the theme changes.
 */
export function ReadMode({
  text,
  attachmentUrls,
  theme,
  renderMarkdown,
}: ReadModeProps): ReactNode {
  const readRef = useRef<HTMLDivElement | null>(null);
  const [readError, setReadError] = useState('');

  // Read mode renders the current buffer with the shared renderer. The editor
  // stays mounted and keeps its document, so the switch back is free.
  useEffect(() => {
    const host = readRef.current;
    const render = renderMarkdown;
    if (host === null || render === null) return;
    let cancelled = false;
    const disposers: Array<() => void> = [];
    void (async (): Promise<void> => {
      try {
        const html = await render(text, {
          attachmentHref: (revisionId: string): string =>
            attachmentUrls.get(revisionId) ?? '',
        });
        if (cancelled) return;
        host.innerHTML = html;
        setReadError('');
        // Mermaid keeps its isolated frame here too, so Read mode never runs
        // a diagram library inside the application origin.
        for (const block of host.querySelectorAll('pre[data-diagram]')) {
          const frame = createDiagramFrame({
            source: block.textContent ?? '',
            theme,
            framePath: diagramFramePath,
          });
          disposers.push(frame.dispose);
          block.replaceWith(frame.element);
        }
      } catch {
        if (cancelled) return;
        host.textContent = '';
        setReadError(
          'This note is too large or too deeply nested to show as text. Switch to Write to read the source.',
        );
      }
    })();
    return () => {
      cancelled = true;
      for (const dispose of disposers) dispose();
    };
  }, [text, attachmentUrls, renderMarkdown, theme]);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div ref={readRef} data-note-view="read" className={readTypography} />
      {readError === '' ? null : (
        <p className="px-4 text-control text-danger" role="alert">
          {readError}
        </p>
      )}
    </div>
  );
}
