/**
 * The frame side of the diagram renderer.
 *
 * This module is the entry point of `frame.html` and runs inside the
 * sandboxed iframe. The sandbox has no `allow-same-origin`, so the frame has
 * an opaque origin and every request it makes is cross origin. That is why
 * Mermaid is imported statically here and the build inlines this whole
 * module into the frame document: a self-contained page needs no network at
 * all, so no chunk can be refused (QA-04).
 *
 * The frame answers exactly one request. A second message is ignored, and
 * every answer carries the request identifier back, so a stray frame cannot
 * answer for this one.
 */
import mermaid from 'mermaid';
import {
  diagramLimits,
  diagramThemeOptions,
  isParentMessage,
  isDiagramRequest,
  paletteNames,
  type DiagramRequest,
  type DiagramResponse,
} from './frame.ts';

/**
 * Paints the frame with the palette that the request carries.
 *
 * The frame holds no colour of its own, so a new theme reaches it with no
 * change here. Every value was checked as a hex colour before it arrives.
 */
function paint(request: DiagramRequest): void {
  const element = document.documentElement;
  element.setAttribute('data-theme', request.theme);
  paletteNames.forEach((name, index) => {
    element.style.setProperty(name, request.palette[index] ?? '');
  });
}

/** Renders one validated request and answers with its height. */
async function render(request: DiagramRequest): Promise<void> {
  paint(request);
  // The colours come from the palette of the request, in light and in dark,
  // so a diagram takes the theme of the page and never one of Mermaid.
  const themed = diagramThemeOptions(request);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: themed.theme,
    darkMode: themed.darkMode,
    themeVariables: { ...themed.themeVariables },
  });
  const id = `notes-diagram-${request.requestId.replace(/[^a-zA-Z0-9-]/g, '')}`;
  const outcome = await mermaid.render(id, request.source);
  const host = document.getElementById('notes-diagram-host');
  if (host === null) throw new Error('The diagram host is missing.');
  host.innerHTML = outcome.svg;
  const response: DiagramResponse = {
    requestId: request.requestId,
    ok: true,
    height: host.scrollHeight,
  };
  window.parent.postMessage(response, '*');
}

/** Shows the source in the frame and answers that rendering failed. */
function fail(requestId: string, message: string, source: string): void {
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
}

/**
 * Starts the frame and waits for exactly one request.
 *
 * The listener is registered with `{ once: true }`, so a second request is
 * never rendered. An invalid message is not a request, so the listener stays
 * registered until a valid one arrives. A message that does not come from the
 * parent of the frame is no request either, and a frame with no parent takes
 * none.
 */
export function startDiagramFrame(): void {
  const onMessage = (event: MessageEvent): void => {
    if (
      !isParentMessage(window, event.source) ||
      !isDiagramRequest(event.data)
    ) {
      window.addEventListener('message', onMessage, { once: true });
      return;
    }
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
  };
  window.addEventListener('message', onMessage, { once: true });
}

startDiagramFrame();
