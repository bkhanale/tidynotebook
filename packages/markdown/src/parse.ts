/**
 * Markdown parsing.
 *
 * One parser configuration serves the editor, the server, and the public share
 * page, so all three agree on what a document means. The flavor is CommonMark
 * plus the GFM set (tables, task list items, strikethrough, autolinks, and
 * footnotes) plus inline and display math.
 *
 * Three rules matter for the rest of the package:
 *
 * - Position information is kept. Every node carries the source offsets that
 *   link extraction and the editor decorations rely on.
 * - Front matter is document content. No front matter extension is installed,
 *   so a leading `---` block parses as ordinary Markdown and cannot set
 *   metadata, permissions, or rendering options.
 * - Unknown syntax stays text. Raw HTML is parsed into `html` nodes so that
 *   the source stays addressable, but the renderer never emits it.
 *
 * Parsing does not change the source. A JavaScript string is immutable, and
 * this module keeps only offsets into it, so `source.slice(from, to)` of any
 * reported range is still the original text.
 */
import type { Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

/**
 * Builds the shared Markdown half of a processor.
 *
 * The renderer continues this chain with the HTML stages. Nothing here loads a
 * plugin that executes document content: there is no MDX support, no raw HTML
 * pass, and no plugin that reads a directive out of a note.
 */
export function createMarkdownProcessor() {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMath);
}

const markdownProcessor = createMarkdownProcessor().freeze();

/**
 * Parses `source` into an mdast tree with position information.
 *
 * The result is the upstream mdast `Root` type, so a caller can use the normal
 * unist utilities. Parsing applies no size limit; `renderMarkdown` owns the
 * resource limits, because it is the stage that produces output.
 */
export function parseMarkdown(source: string): Root {
  return markdownProcessor.parse(source);
}
