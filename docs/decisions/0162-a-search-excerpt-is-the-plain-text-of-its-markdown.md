# 0162. A search excerpt is the plain text of its Markdown

- Status: Accepted
- Date: 2026-10-02

## Context

A search excerpt reaches the command palette from two sources. The server
cuts it with `ts_headline` from the stored Markdown in `notesapp_search`
(`packages/storage-server/migrations/0022_stored_search_document.sql`), and
the device cuts it from the Markdown in `packages/sync/src/local-search.ts`.
Both keep the source, so a result shows `**` marks, heading marks and whole
link addresses. The contract `SearchExcerptPart` already states that an
excerpt carries no markup. Finding 12 of the
[product audit of 2026-10-02](../audits/2026-10-02/product-audit.md) and
issue 253.

## Decision

- `plainExcerpt` in `packages/markdown/src/plain-text.ts` turns one marked
  excerpt into the text a reader sees. It parses the text of the parts with
  the one grammar (record 0001), so no second parser decides what a mark is.
- It keeps text, the label of a link, the text of an image, code and math. It
  drops a link address, an image address, emphasis marks, the marks of a
  heading, a list, a quote and a table, raw HTML and front matter. A line
  break reads as one space. A block break reads as `·`, or as one space
  after the end of a sentence, so two blocks never read as one sentence.
- The caller names the note. A first block that repeats that name goes,
  because the palette shows the excerpt under the name, unless nothing else
  is left.
- A marked word stays marked: the marks are ranges of the source, and the
  plain text keeps the source offset of each character.
- The search store applies it to the headline of each hit in
  `packages/storage-server/src/workspace-store/search-repository.ts`, and
  `searchLocal` applies it to the window of the device. Each answer is plain
  at its source, so a reader renders the parts as they come.
- The search function, the index and the match stay as they are. A search
  still finds a word of a link address. No migration is needed.

## Consequences

- The palette shows the words of a note and no syntax, from the server and
  from the device alike.
- A construct that the edge of an excerpt cuts in half is no construct to the
  grammar, so its marks stay as text. Each answer cuts at a word boundary,
  which keeps that case rare.
- `packages/markdown/src/plain-text.test.ts` holds the rule,
  `packages/sync/src/local-search.test.ts` the device answer and
  `tests/integration/search.test.ts` the served answer.
