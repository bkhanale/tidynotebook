# 0160. An unclosed tag never takes the rest of a note

- Status: Accepted
- Date: 2026-10-02

## Context

Record 0157 parses the HTML of a note with parse5 and keeps the safe set of
`packages/markdown/src/html-elements.ts`. A review of the merged branch found
three gaps. An unclosed `<template>` or `<object>` took every later block of
the note and left with it, `<plaintext>` and `<select>` flattened the rest,
and `<title>`, `<textarea>` and `<xmp>` read every later tag as text. An HTML
block is one node of the Markdown tree, so a deep nest of elements passed the
depth guard of `limits.ts` and the parse ran out of stack. And a source of a
content policy has no form for an IPv6 literal, so the page of record 0158
drew no diagram at a bracketed IPv6 host. See
[design 021](../design/021-the-published-page-draws-what-the-editor-draws.md).

## Decision

- The tags of `neutralAuthorTags` are never tags: the tags of GFM tagfilter
  and `select`. `neutralizeAuthorTags` writes the opening bracket of each as
  text before the parse, so the tag reads as the author typed it, and a
  script or a style runs nothing and loses no word.
- A `template` and an `object` lose their tags and keep their content, as
  every element outside the list does.
- `authorNestingDepth` bounds the nesting that the HTML of a note can open,
  before the parse, and `renderMarkdown` refuses a deeper note with the
  `nesting-depth` error of every other deep note.
- A published page at a bracketed IPv6 host names the diagram script and the
  frame with `'self'`, because no other source names that host.

This refines records 0157 and 0158.

## Consequences

- A note keeps every word and every block after an unclosed tag, and a deep
  note fails with `MarkdownLimitError` and never with a stack error.
- At an IPv6 literal the policy admits every script of the origin. The
  published origin serves no other script (record 0118).
- `render.test.ts`, `limits.test.ts`, `html-elements.test.ts`,
  `security-headers.test.ts` and `tests/integration/published-page.test.ts`
  prove each case.
