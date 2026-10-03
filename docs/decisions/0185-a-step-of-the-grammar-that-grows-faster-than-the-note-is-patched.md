# 0185. A step of the grammar that grows faster than the note is patched

- Status: Accepted
- Date: 2026-10-03

## Context

- Record 0182 bounds the marks of a block and the table cells of a note, and
  states that the rest of the parse grows with the size of the note. The
  review of 2026-10-03 found shapes with no mark that take the square of
  their size: one paragraph of lines that end in white space or of plain
  lines, many code spans or literal links in a paragraph, a long dotted word,
  many paragraphs, a long list. The render and the Lezer parse of the editor
  had more. Some ran a step out of stack, an error that is no limit, so each
  reader of the note failed with it.
- Each cause is one step of a package that reads its input again for each
  part of it: a splice or a search of a list for each item, or a regular
  expression that scans again from each place a match may start. Upstream
  fixed some of them, in releases that are not yet usable here: one release
  brings a new step of the same kind, and one is younger than the release
  age of the lockfile.
- A count cannot bound these steps. Each costs the product of two counts that
  a real note reaches, the lines of a paragraph or the items of a list, so a
  limit low enough to bound it refuses a pasted note.

## Decision

- `patches/` holds one pnpm patch for each such package version, and
  `pnpm-workspace.yaml` lists it under `patchedDependencies`. A patch turns
  one step into a single pass with the same result, and nothing else. Where
  upstream fixed the step, the patch is that fix. The patched steps: the
  merge of text and of code text and the line suffixes of `micromark` and
  `micromark-core-commonmark`, the list items of `mdast-util-from-markdown`,
  the place of a node of `unist-util-visit`, the loose list, the footnote
  order and the head row of `mdast-util-to-hast`, the adoption of children
  of `parse5`, and the open link of `@lezer/markdown`.
- The literal link step of GFM is `packages/markdown/src/autolink-literals.ts`,
  the same rules read in one pass. It takes the place of the step of
  remark-gfm, and fails when it does not find that step once.
- `packages/markdown/src/render.ts` writes each list of children once.
- A patch leaves when a release with the fix passes the release age of the
  lockfile. pnpm refuses an install whose patch names no installed version,
  so an upgrade of a patched package meets its patch.
- This corrects record 0182, which excluded a patch of an upstream package.
  No limit is added: the marks of record 0182 stay as they are.

## Consequences

- The parse, the render and the editor parse of each shape grow with the
  size of the note, and no note is refused for that.
- An upgrade of a patched package moves or drops its patch.
- `parse.test.ts` counts the work of the parse and the render of each shape
  at two sizes. `autolink-literals.test.ts` holds the links equal to those of
  the GFM step. `language-work.test.ts` counts the parts that the Lezer
  parse reads. `limits.test.ts` keeps the marks of record 0182.
