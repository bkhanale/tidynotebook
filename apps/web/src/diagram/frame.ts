/**
 * Isolated Mermaid diagram rendering.
 *
 * Diagrams render inside a sandboxed frame (`frame.html`) rather than in the
 * note itself. The parent keeps the Markdown source; the frame keeps the
 * diagram library. The two sides exchange only two fixed message shapes, so
 * no arbitrary HTML ever travels back to the parent.
 *
 * What this module never does:
 *
 * - It never gives the frame an origin privilege. The iframe uses
 *   `sandbox="allow-scripts"` without `allow-same-origin`, so the frame
 *   cannot read the parent document, storage, or cookies even if a diagram
 *   source is hostile.
 * - It never lets a note control the renderer. The frame fixes its Mermaid
 *   configuration (`securityLevel: 'strict'`, no directives) and its input
 *   limits; the message carries only the source text and the theme name.
 * - It never waits forever or grows forever. The source length, the render
 *   time, and the frame height are all bounded, and a failure replaces the
 *   frame with editable source in the same pane.
 *
 * Mermaid itself loads through a dynamic import inside `startDiagramFrame`,
 * so the main bundle keeps it deferred and the service worker can precache
 * the diagram chunk later. The parent side of this module holds no diagram
 * library at all.
 */

/** The palette name the frame renders with. */
export type DiagramTheme = 'light' | 'dark';

/**
 * The only message the parent sends to the frame.
 *
 * `requestId` matches one render; `source` is the raw Mermaid source without
 * the fence; `theme` selects the Tokyo Night palette inside the frame.
 */
export type DiagramRequest = {
  readonly requestId: string;
  readonly source: string;
  readonly theme: DiagramTheme;
};

/**
 * The only message the frame sends to the parent.
 *
 * `requestId` echoes the request; `ok` reports whether rendering succeeded;
 * `height` is the content height in pixels for the parent to apply. A failed
 * render still answers with `ok: false` so the parent never waits forever.
 */
export type DiagramResponse = {
  readonly requestId: string;
  readonly ok: boolean;
  readonly height: number;
};

/**
 * The fixed resource limits of diagram rendering.
 *
 * Twenty thousand characters already hold a large graph. Eight seconds bound
 * one render without depending on machine load for the outcome: the same
 * source either renders inside the budget or falls back to source. The frame
 * height stays between a visible minimum and a maximum that keeps the note
 * scrollable.
 */
export const diagramLimits = {
  /** Largest accepted diagram source, in characters. */
  maxSourceChars: 20000,
  /** Longest accepted render, in milliseconds. */
  maxRenderMs: 8000,
  /** Smallest applied frame height, in pixels. */
  minHeightPx: 40,
  /** Largest applied frame height, in pixels. */
  maxHeightPx: 800,
} as const;

/** Reports whether a value is a non empty string inside a length cap. */
function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

/** Reads one property of an unknown value without asserting its shape. */
function readProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value))[key];
}

/**
 * Reports whether an unknown value is a diagram request.
 *
 * Every field is checked: the request ID is a short non empty string, the
 * source is inside the character cap, and the theme is exactly one of the
 * two palettes. Anything else is ignored, so a stray message from another
 * frame cannot start a render.
 */
export function isDiagramRequest(value: unknown): value is DiagramRequest {
  const requestId = readProperty(value, 'requestId');
  const source = readProperty(value, 'source');
  const theme = readProperty(value, 'theme');
  return (
    isBoundedString(requestId, 128) &&
    typeof source === 'string' &&
    source.length <= diagramLimits.maxSourceChars &&
    (theme === 'light' || theme === 'dark')
  );
}

/**
 * Reports whether an unknown value is a diagram response.
 *
 * The height must be a finite number inside the applied bounds. A response
 * outside them is ignored, so a faulty frame cannot resize the note
 * arbitrarily.
 */
export function isDiagramResponse(value: unknown): value is DiagramResponse {
  const requestId = readProperty(value, 'requestId');
  const ok = readProperty(value, 'ok');
  const height = readProperty(value, 'height');
  return (
    isBoundedString(requestId, 128) &&
    typeof ok === 'boolean' &&
    typeof height === 'number' &&
    Number.isFinite(height) &&
    height >= 0 &&
    height <= diagramLimits.maxHeightPx * 2
  );
}

/** Clamps a reported height into the applied frame bounds. */
export function clampDiagramHeight(height: number): number {
  if (!Number.isFinite(height)) return diagramLimits.minHeightPx;
  if (height < diagramLimits.minHeightPx) return diagramLimits.minHeightPx;
  if (height > diagramLimits.maxHeightPx) return diagramLimits.maxHeightPx;
  return Math.round(height);
}

/** Options of one parent side diagram frame. */
export type DiagramFrameOptions = {
  /** The Mermaid source without the fence. */
  readonly source: string;
  /** The palette the frame renders with. */
  readonly theme: DiagramTheme;
  /**
   * The path of the built frame document, for example `diagram/frame.html`.
   * A plain path string on purpose: application URL construction belongs to
   * generated output, and this path is a static Vite entry, not an API route.
   */
  readonly framePath: string;
  /** How long the parent waits before falling back to source. */
  readonly timeoutMs?: number | undefined;
};

/**
 * Creates the parent side of one diagram frame.
 *
 * Returns a wrapper element holding the sandboxed iframe. The iframe starts
 * loading immediately; the request is posted once it loads, and the wrapper
 * keeps the requested height once the validated response arrives. A missing
 * response, a mismatched request ID, a failed render, or a timeout replaces
 * the iframe with the editable source and an inline message. The caller
 * removes everything through `dispose`.
 */
export function createDiagramFrame(options: DiagramFrameOptions): {
  readonly element: HTMLDivElement;
  readonly dispose: () => void;
} {
  const wrapper = document.createElement('div');
  wrapper.className = 'notes-diagram';
  wrapper.setAttribute('data-notesapp-diagram', 'pending');

  const requestId = crypto.randomUUID();
  const timeoutMs = options.timeoutMs ?? diagramLimits.maxRenderMs;
  let settled = false;
  let timer = 0;

  const fallback = (message: string): void => {
    if (settled) return;
    settled = true;
    wrapper.setAttribute('data-notesapp-diagram', 'source');
    wrapper.textContent = '';
    const note = document.createElement('p');
    note.className = 'notes-rich-fallback';
    note.textContent = message;
    wrapper.appendChild(note);
    const code = document.createElement('pre');
    code.className = 'notes-rich-source';
    code.textContent = options.source;
    wrapper.appendChild(code);
  };

  const iframe = document.createElement('iframe');
  iframe.className = 'notes-diagram-frame';
  iframe.setAttribute('title', 'Diagram preview');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('src', options.framePath);
  iframe.style.width = '100%';
  iframe.style.border = '0';
  iframe.style.height = `${String(diagramLimits.minHeightPx)}px`;
  wrapper.appendChild(iframe);

  const onMessage = (event: MessageEvent): void => {
    if (!iframe.isConnected) {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      return;
    }
    if (event.source !== iframe.contentWindow) return;
    if (!isDiagramResponse(event.data)) return;
    if (event.data.requestId !== requestId) return;
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    if (!event.data.ok) {
      fallback('This diagram cannot be rendered, so it stays editable source.');
      return;
    }
    wrapper.setAttribute('data-notesapp-diagram', 'ready');
    iframe.style.height = `${String(clampDiagramHeight(event.data.height))}px`;
  };
  window.addEventListener('message', onMessage);

  const request: DiagramRequest = {
    requestId,
    source: options.source,
    theme: options.theme,
  };
  iframe.addEventListener('load', (): void => {
    // The frame runs with an opaque origin (`sandbox` without
    // `allow-same-origin`), so the target origin is `*` by necessity. The
    // message itself carries the request ID, and the response is accepted
    // only from this iframe with the same ID, so a stray frame cannot
    // answer for it.
    iframe.contentWindow?.postMessage(request, '*');
  });

  timer = window.setTimeout(() => {
    fallback('Diagram rendering timed out, so the source stays editable.');
  }, timeoutMs);

  return {
    element: wrapper,
    dispose: (): void => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      wrapper.remove();
    },
  };
}

/**
 * Starts the frame side of the diagram renderer.
 *
 * Called once by `frame.html`. Waits for exactly one validated request,
 * renders it with a fixed strict Mermaid configuration, posts only the fixed
 * response shape back, and shows the editable source on any failure. The
 * Mermaid library loads here through a dynamic import, so only this frame
 * pays for it.
 */
export function startDiagramFrame(): void {
  const render = async (request: DiagramRequest): Promise<void> => {
    document.documentElement.setAttribute('data-theme', request.theme);
    const module = await import('mermaid');
    const mermaid = module.default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: request.theme === 'dark' ? 'dark' : 'default',
    });
    const id = `notes-diagram-${request.requestId.replace(/[^a-zA-Z0-9-]/g, '')}`;
    const outcome = await mermaid.render(id, request.source);
    const host = document.getElementById('notes-diagram-host');
    if (host === null) throw new Error('The diagram host is missing.');
    host.innerHTML = outcome.svg;
    const height = host.scrollHeight;
    const response: DiagramResponse = {
      requestId: request.requestId,
      ok: true,
      height,
    };
    window.parent.postMessage(response, '*');
  };

  const fail = (requestId: string, message: string, source: string): void => {
    const host = document.getElementById('notes-diagram-host');
    if (host !== null) {
      host.textContent = '';
      const note = document.createElement('p');
      note.className = 'notes-diagram-error';
      note.textContent = message;
      host.appendChild(note);
      const code = document.createElement('pre');
      code.className = 'notes-diagram-source';
      code.textContent = source;
      host.appendChild(code);
    }
    const response: DiagramResponse = {
      requestId,
      ok: false,
      height: diagramLimits.minHeightPx,
    };
    window.parent.postMessage(response, '*');
  };

  window.addEventListener('message', (event: MessageEvent): void => {
    if (!isDiagramRequest(event.data)) return;
    const request = event.data;
    const timer = window.setTimeout(() => {
      fail(request.requestId, 'Diagram rendering timed out.', request.source);
    }, diagramLimits.maxRenderMs);
    void render(request)
      .catch(() => {
        fail(
          request.requestId,
          'This diagram cannot be rendered.',
          request.source,
        );
      })
      .finally(() => {
        window.clearTimeout(timer);
      });
  });
}
