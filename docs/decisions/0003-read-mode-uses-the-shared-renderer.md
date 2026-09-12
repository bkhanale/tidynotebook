# 0003. Read mode is the second consumer of the renderer

- Status: Superseded by [0022](0022-the-live-preview-is-the-one-note-surface.md)
- Date: 2026-09-10

## Context

`renderMarkdown` in `packages/markdown` produced the server side index and
one public share page that no person used. A renderer with no real user
drifts away from the editor.

## Decision

The note screen gets a Write and Read toggle. Read mode renders the current
buffer with `renderMarkdown`. The unused public share page is deleted.

## Consequences

- The renderer gets a real user, so a rendering defect is visible at once.
- The rendered HTML is written into one sanitized host element in
  `apps/web/src/features/note-editor.tsx`. That host is the only place in
  the web application that may set `innerHTML`, and
  `tools/check-design-rules.mjs` holds that rule.
- Read mode keeps the editor mounted and keeps its document, so the switch
  back to Write costs nothing.
