# 0170. One dollar opens math by the rule of Pandoc

- Status: Accepted
- Date: 2026-10-02

## Context

Record 0002 refused single dollar math, so `$x$` of GitHub, Obsidian and
Typora stays text in both grammars (issue 240, audit finding 5). The rule of
remark-math for one dollar is the rule of a code span, which reads `$5 and
$10` as a formula. See [design 022](../design/022-markdown-of-other-tools.md).

## Decision

- Inline math opens on one dollar by the rule of Pandoc. The opening dollar
  has no dollar before it and a character after it that is not a space and
  not a dollar. The closing dollar is on the same line, has a character
  before it that is not a space, and has no digit after it. Inside, a
  backslash escapes the next character. `\$` outside math is a dollar.
- `packages/markdown/src/math-syntax.ts` states the rule as data and as small
  predicates, with `dollarMathEnd`, the one scan of the rule.
  `packages/markdown/src/math-dollar.ts` is the micromark construct of remark,
  and `packages/editor/src/math-syntax.ts` the inline parser of the Lezer
  grammar. Both write the same inline math node that `$$...$$` writes.
- The single dollar option of remark-math stays off, because its rule is not
  this rule.
- The text keeps the dollars as the person wrote them. No export, no import
  and no paste rewrites one. A paste of rich text escapes each dollar of its
  text, so text from a web page stays text.

This replaces the sentence of record 0002 that refuses single dollar math.

## Consequences

- A formula from another tool renders, and a note of prices stays text.
- A note that held `$a and b$` as text before holds a formula now. A code
  span or `\$` keeps such text literal.
- `math-syntax.test.ts` compares the rule with `parseMarkdown` case by case,
  the corpus holds money, an escape and a formula, and
  `language-resume.test.ts` holds the parse in slices.
