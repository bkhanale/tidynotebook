# 0167. Search reads the words of any language as a reader sees them

- Status: Accepted
- Date: 2026-10-02

## Context

The contract of `searchFiles` states the `simple` text configuration. The
stored vector of `search_index` in `packages/storage-server/src/schema.ts`
and the query of `notesapp_search` use `english`, so a note in another
language is stemmed and cut by English rules
([issue 246](https://github.com/bkhanale/notesapp/issues/246)). The index
holds the raw Markdown, so an excerpt shows emphasis marks and link
addresses ([issue 253](https://github.com/bkhanale/notesapp/issues/253)). A
search for a word in every note spent most of its time in `ts_headline` over
the whole text of a long note
([issue 265](https://github.com/bkhanale/notesapp/issues/265)).

## Decision

- One text search configuration, `public.notesapp_text`, serves the vector,
  the query and the excerpt. It is `simple` with the `unaccent` filter: no
  stemming, no stop words, and a letter with an accent matches the same
  letter without one. The trusted `unaccent` extension needs no superuser.
- Every word of a query matches as a prefix. This takes the place of
  stemming in every language whose word forms add an ending. A word form that
  changes its stem, and a shorter form of a longer query word, do not match.
- The index holds the readable text of a note: `readableText` of
  `packages/markdown` drops the marks, the link addresses and the raw HTML,
  and keeps the words, the code and the alternative text of a picture. Search
  matches and quotes only what a reader sees.
- The excerpt reads a bounded window of the text around the first place of a
  query word, so its cost does not grow with the length of a note.
- A data migration after the SQL rebuilds the row of every live note that has
  none, so an index of an earlier release reaches the new text.

This excludes a configuration for each workspace or note. It needs a stored
language, a choice that a person makes, and one index expression for each
language.

## Consequences

- A note in German, French or Spanish matches by the same rule as a note in
  English. A text with no spaces between words, such as Japanese, matches
  only from the start of a run of letters.
- `tests/integration/search.test.ts` proves the language rule, the accent
  rule, the prefix rule, the readable excerpt, the window of a long note and
  the rebuild. `packages/markdown/src/readable-text.test.ts` proves the text.
