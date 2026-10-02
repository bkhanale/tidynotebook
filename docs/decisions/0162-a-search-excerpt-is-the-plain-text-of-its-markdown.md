# 0162. A search excerpt is the plain text of its Markdown

- Status: Accepted
- Date: 2026-10-02

## Context

A search excerpt reaches the command palette from two sources. The server
cuts it with `ts_headline` in `notesapp_search`, and the device cuts it in
`packages/sync/src/local-search.ts`. Both cut the Markdown, so a result shows
`**` marks, heading marks and whole link addresses. The contract
`SearchExcerptPart` already states that an excerpt carries no markup. Finding
12 of the [product audit of 2026-10-02](../audits/2026-10-02/product-audit.md)
and issue 253. Record
[0167](0167-search-reads-the-words-of-any-language-as-a-reader-sees-them.md)
states the search configuration and what the index holds.

## Decision

- An excerpt is a window of the readable text of a note. `readableText` in
  `packages/markdown/src/plain-text.ts` is the one plain text rule of
  Markdown. It parses with the one grammar (record 0001), so no second parser
  decides what a mark is.
- It keeps text, the label of a link, the text of an image, code and math. It
  drops a link address, an image address, emphasis marks, the marks of a
  heading, a list, a quote and a table, raw HTML and front matter. A line
  break reads as one space. A block break reads as `·`, or as one space
  after the end of a sentence, so two blocks never read as one sentence.
- The caller names the note. A first block that repeats that name goes,
  because the palette shows the excerpt under the name, unless nothing else
  is left.
- The server index holds that text (record 0167), so the headline is plain
  as it leaves the database. `searchLocal` reads the same text of the
  Markdown on the device, and matches and marks words in it. Each answer is
  plain at its source, so a reader renders the parts as they come.

## Consequences

- The palette shows the words of a note and no syntax, from the server and
  from the device alike, and both find a word by one rule.
- A word of a link address is not a word of the note, so neither search
  finds it.
- `packages/markdown/src/plain-text.test.ts` holds the rule,
  `packages/sync/src/local-search.test.ts` the device answer and
  `tests/integration/search.test.ts` the served answer.
