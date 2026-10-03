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
 * - Every entry point is bounded. The size and nesting checks in `./limits.ts`
 *   run before the parser sees the text, and the depth of the tree and of the
 *   HTML that the author wrote is checked after.
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
  assertNestingDepth,
  assertParseLimits,
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
 * Parses `source` into an mdast tree with position information.
 *
 * The result is the upstream mdast `Root` type, so a caller can use the normal
 * unist utilities. Throws `MarkdownLimitError` when the document is larger
 * than the byte cap or nests deeper than the limit. Every other entry point of
 * this package parses through here, so all of them are bounded.
 */
export function parseMarkdown(source: string): Root {
  assertParseLimits(source);
  const tree = markdownProcessor.parse(source);
  assertNestingDepth(tree);
  assertAuthorHtmlDepth(tree);
  return tree;
}
