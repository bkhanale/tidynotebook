# 0158. A published diagram draws in the frame of the editor

- Status: Accepted
- Date: 2026-10-02

## Context

`renderMarkdown` writes a Mermaid fence as a `pre` with `data-diagram`. The
editor draws it in the sandboxed frame of `apps/web/src/diagram/`, and the
published page shows the source, because records 0031 and 0047 give the
reader path no script. Mermaid measures text in a live document, so a server
can draw a diagram only with a browser engine of its own. Audit of
2026-10-02, finding 4, and
[issue 236](https://github.com/bkhanale/notesapp/issues/236). See
[design 021](../design/021-the-published-page-draws-what-the-editor-draws.md).

## Decision

- A published page whose note holds a diagram loads one script file of the
  build. `apps/web/src/published/diagrams.ts` is its entry, and
  `publishedDiagramScript` in `apps/web/vite.config.ts` builds it alone, with
  no import, as `assets/published-diagrams-<hash>.js`.
- The script puts the frame of `createDiagramFrame` in place of each
  placeholder, with the palette and the appearance that the page shows. The
  frame document is `src/diagram/frame.html`, the one that the editor uses,
  sandboxed with no origin of its own. A frame that cannot draw leaves the
  source in place.
- The content policy of that page names the script and the frame document by
  their exact address on the host of the request, in `script-src` and
  `frame-src`. It permits no inline script, no other file of the origin and
  no third party, and `frame-ancestors 'none'` stays. A page with no diagram
  keeps `script-src 'none'` and no frame.
- The published origin of record 0118 serves that one script and the frame
  document, and no other script.
- With no script, the page shows the source of the diagram as a code block.

This refines records 0031, 0047 and 0118.

## Consequences

- A reader sees the diagram that the editor draws, in light and in dark.
- A note with a diagram loads the frame document, which holds the whole
  diagram engine. A note with no diagram loads nothing more.
- `security-headers.test.ts` and `published-document.test.ts` prove the
  policy and the page, `published-origin.test.ts` what the origin serves, and
  `tests/integration/published-page.test.ts` and `web-build.test.ts` the
  served page and the built script.
