# 0001. One Markdown grammar

- Status: Accepted
- Date: 2026-09-10

## Context

The editor and the reader must never disagree about what a document means.
Before this decision `packages/editor` scanned the Markdown source with
regular expressions in `live-preview.ts` and `widgets.ts`, while
`packages/markdown` parsed the same text with remark. Two scanners give two
answers for the same document.

## Decision

`packages/markdown` is the only definition of the language: remark with
CommonMark and GFM, plus math, a sanitizer, and a URL policy.
`packages/editor` keeps the Markdown source as the CodeMirror document and
builds every decoration from the Lezer Markdown syntax tree that CodeMirror
already parses through `syntaxTree(state)`. The outline reads the same tree.
The regular expression scanners are deleted.

## Consequences

- A new syntax rule is added in one place and both surfaces get it.
- `packages/editor` cannot add a second parser or a marker scanner.
- One corpus document in `packages/markdown/test-data/content.ts` is
  rendered through both paths in a test, and the two results must agree on
  structure. A change that moves one path away from the other fails that
  test.
