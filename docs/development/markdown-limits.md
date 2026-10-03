# Markdown limits

A member of a workspace, or anybody who signs up, can write a note that the
server and every device parse, render and index. The work of each of those
steps stays in proportion to the size of the note, so no note of any shape
holds a server worker or a tab for long. Two records state how:
[decision 0182](../decisions/0182-the-parse-of-a-note-grows-with-its-size.md)
bounds the counts that no single pass can bound, and
[decision 0185](../decisions/0185-a-step-of-the-grammar-that-grows-faster-than-the-note-is-patched.md)
makes every other step one pass.

## Counts before the parse

`packages/markdown/src/limits.ts` states four counts: the size of a note, the
nesting depth, the marks of one inline block, and the table cells of a note.
A mark is a character that can open or close an inline construct; the full
list is in the comment of `inlineMarks` and in record 0182.

One reading of the lines runs before the parse. It checks the size and the
nesting of each line prefix, counts the table cells from a delimiter row to
the next blank line, and counts the marks of each part between blank lines.
Only when a part holds more marks than one block may, a parse with every
inline construct off finds the blocks of the one grammar, and each is held
to the limit (`parse.test.ts`). After the parse, the depth of the tree and of
the HTML of a note is checked. No timeout and no cost score apply, so a note
passes or fails the same way on every machine. Every entry point parses
through `parseMarkdown`.

A refused note is never truncated: a reader shows its source, and the
boundary answers the domain code of each limit with a sentence the person
can read.

## Every other step is one pass

A step that reads a list again for each item of it costs the square of the
note, and no count bounds it without refusing a pasted note: the lines of one
paragraph, the items of one list. Such a step is made one pass with the same
result.

- An upstream step gets a pnpm patch in `patches/`, listed in
  `pnpm-workspace.yaml`. Where upstream fixed the step, the patch is that fix.
  `docs/development/versions.md` states how a patch leaves.
- The literal links of GFM are `packages/markdown/src/autolink-literals.ts`,
  the rules of the step of remark-gfm read in one pass, which
  `autolink-literals.test.ts` holds equal to that step.
- `packages/markdown/src/render.ts` writes each list of children once.

`packages/markdown/test-data/shapes.ts` lists the shapes of note that once
cost the square of their size. `parse.test.ts` counts the work of the parse
and the render of each shape at two sizes: the elements that array splices
move and searches read, and the code units read. A new shape of the same
family gets a row there. `tools/performance/parse-shapes.ts` times the same
shapes on a machine, and `packages/editor/src/language-work.test.ts` counts
the work of the Lezer parse of the editor.

## The editor

The editor keeps its Markdown language only for a note within
`withinParseLimits` (`packages/editor/src/grammar-gate.ts`), and shows another
note as plain text, as a reader shows it. A key reads again only the parts
around it (`packages/editor/src/note-measure.ts`). When that reading is
unsure, the answer of the last whole check stands while the text inserted
since then stays below `checkedInsertLength` and no part holds more marks than
`vouchedPartMarks`. A small change can end or join the blocks of such a part,
so the gate checks the whole note again then. A note shown as plain text is
checked again after a pause in typing.
