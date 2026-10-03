/**
 * Markdown parsing.
 *
 * One parser configuration serves the editor, the server, and the reading
 * surface, so all three agree on what a document means. The flavor is CommonMark
 * plus the GFM set (tables, task list items, strikethrough, autolinks, and
 * footnotes), YAML front matter, and inline and display math. A strike opens
 * on two tildes and never on one, which is what the Lezer grammar of the
 * editor does.
 *
 * Four rules matter for the rest of the package:
 *
 * - Position information is kept. Every node carries the source offsets that
 *   link extraction and the editor decorations rely on.
 * - Front matter is inert metadata. A leading YAML block has its own syntax
 *   node, but this package does not parse its values or let it set permissions,
 *   rendering options, or application behavior.
 * - Unknown syntax stays text. Raw HTML is parsed into `html` nodes so that
 *   the source stays addressable, but the renderer never emits it.
 * - A price is money, not math. The math delimiter rule comes from
 *   `./math-syntax.ts`, which the live preview parser reads as well, so both
 *   engines open math at the same place. remark-math gives `$$...$$` only, so
 *   `./math-parens.ts` adds the `\(...\)` pair and `./math-dollar.ts` the
 *   one dollar of the rule of Pandoc (record 0171).
 * - Every entry point is bounded. The size, nesting, mark and table checks in
 *   `./limits.ts` run before the parser sees the text, and the depth of the
 *   tree and of the HTML that the author wrote is checked after (record
 *   0182).
 *
 * Parsing does not change the source. A JavaScript string is immutable, and
 * this module keeps only offsets into it, so `source.slice(from, to)` of any
 * reported range is still the original text. One detail belongs to the caller:
 * the parser removes a leading byte order mark before it assigns offsets, so
 * the offsets in this tree are relative to the text after that mark. The
 * extraction functions in `./links.ts` add it back, and their ranges always
 * address the string the caller passed in.
 */
import type { Root } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified, type Processor } from 'unified';
import {
  assertAuthorHtmlDepth,
  assertBlockMarks,
  assertLineLimits,
  assertNestingDepth,
  assertParseLimits,
  MarkdownLimitError,
  measureOverLimit,
  type PartsMeasure,
} from './limits.ts';
import { mathTextDollarExtension } from './math-dollar.ts';
import { mathTextParensExtension } from './math-parens.ts';
import { singleDollarTextMath } from './math-syntax.ts';

/**
 * Builds the shared Markdown half of a processor.
 *
 * The renderer continues this chain with the HTML stages. Nothing here loads a
 * plugin that executes document content: there is no MDX support, no raw HTML
 * pass, and no plugin that reads a directive out of a note.
 */
export function createMarkdownProcessor() {
  return (
    unified()
      .use(remarkParse)
      .use(remarkFrontmatter, 'yaml')
      // One tilde is not a strike. The Lezer grammar of the editor opens a
      // strike on `~~` alone, and remark opens one on a single `~` as well, so
      // `H~2~O` struck its own subscript on the published page and stayed text
      // in the note. The editor is the stricter of the two, so remark follows
      // it and one grammar answers both surfaces.
      .use(remarkGfm, { singleTilde: false })
      .use(remarkMath, { singleDollarTextMath })
      .use(remarkMathParens)
  );
}

/**
 * Adds the `\(...\)` pair and the one dollar of inline math to the parser.
 *
 * It runs after remark-math, so the mdast handlers of remark-math are already
 * installed and they read the tokens these constructs write.
 */
function remarkMathParens(this: Processor): undefined {
  const data = this.data();
  const extensions = data.micromarkExtensions ?? [];
  extensions.push(mathTextParensExtension, mathTextDollarExtension);
  data.micromarkExtensions = extensions;
}

const markdownProcessor = createMarkdownProcessor().freeze();

/**
 * The names of the inline constructs that a parse of the blocks alone turns
 * off. Each block construct stays, so that parse gives the paragraphs,
 * headings and table cells of the one grammar. The task box of a list item
 * stays too: it reads only the start of the item, and it decides where the
 * paragraph of the item starts.
 */
const inlineConstructs = [
  // CommonMark.
  'attention',
  'autolink',
  'characterEscape',
  'characterReference',
  'codeText',
  'hardBreakEscape',
  'htmlText',
  'labelEnd',
  'labelStartImage',
  'labelStartLink',
  // GFM.
  'emailAutolink',
  'gfmFootnoteCall',
  'gfmPotentialFootnoteCall',
  'protocolAutolink',
  'strikethrough',
  'wwwAutolink',
  // Math, with the two constructs of this package.
  'mathText',
  'mathTextDollar',
  'mathTextParens',
];

/** Turns off every inline construct, so a parse reads the blocks alone. */
function remarkBlocksOnly(this: Processor): undefined {
  const data = this.data();
  const extensions = data.micromarkExtensions ?? [];
  extensions.push({ disable: { null: inlineConstructs } });
  data.micromarkExtensions = extensions;
}

/**
 * The parser of the blocks of a note.
 *
 * Its work grows with the size of the note, because every construct whose
 * work grows faster is an inline one, and the table cells are bounded before
 * it runs.
 */
const blockProcessor = createMarkdownProcessor().use(remarkBlocksOnly).freeze();

/**
 * The tree of the blocks of `source`, with no inline construct read.
 *
 * Only `assertBeforeParse` and the test of this module read it. It is no
 * entry point of the package, because it applies no limit of its own.
 */
export function parseBlocks(source: string): Root {
  return blockProcessor.parse(source);
}

/**
 * Checks every limit that holds before the parse of a note (record 0182).
 *
 * The reading of the lines decides the size, the nesting of a line prefix,
 * the table cells, and, for most notes, the marks of each block. When a part
 * of the note holds more marks than the limit, the parse of its blocks
 * decides whether one block does. Throws `MarkdownLimitError`.
 */
function assertBeforeParse(source: string): void {
  if (!assertParseLimits(source)) return;
  // The parser removes a leading byte order mark before it counts offsets.
  const text = source.startsWith('\uFEFF') ? source.slice(1) : source;
  assertBlockMarks(parseBlocks(source), text);
}

/**
 * Whether a document passes every check that runs before its parse.
 *
 * A surface that offers an action on the parse of a note, such as the copy
 * of a code block, asks this first, so it offers no action that the parse
 * would refuse, and the editor keeps its Markdown language only for such a
 * note. A tree that a parse finds too deep is refused after the parse, so an
 * action keeps its own path for that refusal.
 */
export function withinParseLimits(source: string): boolean {
  try {
    assertBeforeParse(source);
    return true;
  } catch (error) {
    if (error instanceof MarkdownLimitError) return false;
    throw error;
  }
}

/**
 * What the reading of the lines of a note decides, with no copy of the note.
 *
 * `within` and `outside` are the answer of `withinParseLimits`. `unsure` means
 * that a part of the note holds more marks than the limit, so only
 * `withinParseLimits` of the whole text can tell. The editor reads its lines
 * on each change and copies the note only when this is unsure.
 */
export type LineLimits = 'within' | 'outside' | 'unsure';

/** Reads the lines of a note against the limits; see {@link LineLimits}. */
export function lineLimits(lines: Iterable<string>): LineLimits {
  try {
    return assertLineLimits(lines) ? 'unsure' : 'within';
  } catch (error) {
    if (error instanceof MarkdownLimitError) return 'outside';
    throw error;
  }
}

/**
 * The answer of `lineLimits` for a note, from the counts of `measureParts`
 * over all of its lines. The editor keeps those counts as the note changes,
 * so a key reads only the lines around it.
 */
export function limitsOfMeasure(measure: PartsMeasure): LineLimits {
  if (measureOverLimit(measure)) return 'outside';
  return measure.fullParts > 0 ? 'unsure' : 'within';
}

/**
 * Parses `source` into an mdast tree with position information.
 *
 * The result is the upstream mdast `Root` type, so a caller can use the normal
 * unist utilities. Throws `MarkdownLimitError` when the document is over a
 * limit of `./limits.ts`. Every other entry point of this package parses
 * through here, so all of them are bounded.
 */
export function parseMarkdown(source: string): Root {
  assertBeforeParse(source);
  const tree = markdownProcessor.parse(source);
  assertNestingDepth(tree);
  assertAuthorHtmlDepth(tree);
  return tree;
}
