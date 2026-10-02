# 0155. The editor grammar parses the same in slices

- Status: Accepted
- Date: 2026-10-02

## Context

A view parses a note in slices. `@codemirror/language` stops the parse at
the end of the viewport or when its time runs out, keeps the partial tree as
fragments, and a later parse reuses them. A block parser whose result depends
on where a parse stopped draws a wrong note only after a reload or a scroll.
The audit of 2026-10-02 (finding 1, issue 233) reports that a display math
block of `packages/editor/src/math-syntax.ts` became two paragraphs after a
parse that resumed. No test stopped a parse of the grammar of
`packages/editor/src/language.ts` and continued it.

The grammar has custom block syntax (display math, and the footnote
definition of record 0156) and blocks of other packages that the live
preview draws: fences, tables, task items, quotes, alerts and front matter.

## Decision

- `packages/editor/src/language-resume.test.ts` holds the rule. It parses
  each note of the resume set in one pass and again in slices, and the two
  trees must be equal, node by node with positions, mounted trees included.
- The slices are the three ways a view resumes: a parse stopped at an offset
  before it starts, a parse stopped at an offset after the front matter
  wrapper has read the note, each continued from the fragments of its partial
  tree, and a note typed up to an offset and completed by one insert of an
  editor state.
- The test stops at every offset of the shared corpus of
  `packages/markdown/test-data/content.ts` and of its note of block syntax,
  which holds display math, fences, tables, alerts, front matter and
  footnotes in containers and at the end of the note.
- A new block syntax of the editor grammar adds its cases to that note. The
  test names each block node that the set must contain, so a case that
  leaves the note fails the test.
- A test file of any package may import `packages/markdown/test-data/`.
  `tools/check-boundaries.mjs` allows that one relative import out of a
  package, and only from a test file, so the editor reads the one corpus and
  no private copy of it.

## Consequences

- A block parser that reads past its block, keeps state between calls, or
  ends at the place a parse stopped fails the unit tests before it ships.
- At commit 242648d the check found no difference for display math through
  the public parse API, through the parse context of a state, and in the
  browser. The record makes the check a part of the gate, so the defect of
  finding 1 cannot return in silence.
- The test parses the corpus some thousands of times, which costs seconds of
  the unit run and no browser.
