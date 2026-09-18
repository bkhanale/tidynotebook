# 0067. An external picture loads by itself

- Status: Accepted
- Date: 2026-09-18

## Context

A picture written as `![alt](https://host/photo.png)` never appeared. The
renderer in `packages/markdown/src/render.ts` turned it into a
`data-external-image` placeholder, the sanitizer in
`packages/markdown/src/policy.ts` allowed no scheme on an image source, and
the widget in `packages/editor/src/widgets.ts` drew a Load control that the
reader had to press. The cost of that rule is that a note reads as a row of
grey boxes, and the owner reported it on 2026-09-18. The gain is that the
host of the picture learns nothing until the reader asks.

## Decision

An external picture renders as a picture, in the note surface and on the
published page.

`classifyUrl` still decides the destination. An `external` image source over
HTTPS keeps its address, and the sanitizer accepts `https` on `src` and no
other scheme, so `javascript:`, `data:` and plain HTTP stay refused and keep
the alt text. `allowsExternalImage` in `packages/markdown/src/policy.ts` is
the one place that states the scheme, and the `img-src` list of
`apps/server/src/plugins/security-headers.ts` names the same one, so the
renderer never emits a picture that the page then refuses.

The renderer writes `referrerpolicy="no-referrer"` and `loading="lazy"` on
every external picture, so the host of the picture never learns which note
holds it and a picture below the fold costs nothing until the reader reaches
it. The Load control and the `image-external` widget kind are gone.

## Consequences

- A person who opens a note, and an anonymous reader of a published link,
  each make a request to the host of every external picture in that note.
  That host learns the address of the reader and the time.
- The request carries no referrer, so the host learns nothing about the note.
- An image element runs no script, so the widened scheme list adds no code
  execution surface. `packages/markdown/src/render.test.ts` proves that every
  other scheme still loses the picture and keeps the alt text.
- A picture named over plain HTTP no longer appears at all. It never appeared
  on an HTTPS deployment either, because the browser refuses mixed content.
- `packages/markdown/src/corpus.test.ts` and
  `tests/integration/published-page.test.ts` hold the emitted element.
