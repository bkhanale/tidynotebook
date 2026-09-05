/**
 * Safe HTML rendering of stored Markdown.
 *
 * The pipeline is: parse Markdown, convert to HTML nodes with the handlers
 * below, apply the URL policy to every link and image, sanitize with the
 * shared schema, and serialize. Each stage narrows what can reach a reader.
 *
 * What this renderer never does:
 *
 * - It never emits raw HTML. The Markdown to HTML stage runs with
 *   `allowDangerousHtml` off, so an `html` node is dropped with its content.
 *   A `<script>` block, an `onerror` attribute, and an inline `<b>` all
 *   disappear; the text around them stays.
 * - It never fetches anything. An internal reference stays a path that the
 *   caller resolves through the generated API operations, and an external
 *   image becomes a placeholder that needs an explicit user action.
 * - It never runs unbounded work. Input size and nesting depth are capped.
 *
 * Math and Mermaid are placeholders in this task. KaTeX and the isolated
 * diagram frame arrive with Task 15. Until then the source is preserved
 * verbatim inside the placeholder, so no content is lost and the editor can
 * still show the region as text.
 */
import type { Element, ElementContent, Root as HastRoot } from 'hast';
import type { Code, Nodes } from 'mdast';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkRehype from 'remark-rehype';
import { visit } from 'unist-util-visit';
import { createMarkdownProcessor } from './parse.ts';
import { classifyUrl, sanitizeSchema } from './policy.ts';

/** The fixed resource limits of the renderer. */
export const markdownLimits = {
  /**
   * Largest accepted document, in UTF-8 bytes.
   *
   * The design budgets typical notes of 5 to 20 KiB and a 1 MiB stress file,
   * so this leaves headroom while keeping one render bounded.
   */
  maxInputBytes: 2 * 1024 * 1024,
  /**
   * Deepest accepted block or inline nesting.
   *
   * Real documents stay far below this. The cap stops a document built only to
   * make the converter and the browser layout do deeply recursive work.
   */
  maxNestingDepth: 100,
} as const;

/** Why a document was refused. */
export type MarkdownLimitReason = 'input-size' | 'nesting-depth';

/**
 * A document that exceeds a fixed renderer limit.
 *
 * `renderMarkdown` rejects with this error instead of returning partial or
 * truncated HTML: silently cutting a note in half would look like data loss.
 * A caller catches it and shows the source as plain text. The error carries the
 * limit and the measured value so the message can be specific.
 */
export class MarkdownLimitError extends Error {
  readonly reason: MarkdownLimitReason;
  readonly limit: number;
  readonly actual: number;

  constructor(reason: MarkdownLimitReason, limit: number, actual: number) {
    super(
      reason === 'input-size'
        ? `Markdown input is ${actual} bytes and the limit is ${limit} bytes.`
        : `Markdown nesting reaches at least ${actual} levels and the limit is ${limit} levels.`,
    );
    this.name = 'MarkdownLimitError';
    this.reason = reason;
    this.limit = limit;
    this.actual = actual;
  }
}

/**
 * Counts the UTF-8 bytes of `text`.
 *
 * The package must run in a browser and in Node, so it cannot use a Node
 * buffer, and it stays independent of the DOM type library.
 */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Walks the tree without recursion and reports the deepest level reached.
 *
 * The walk is iterative on purpose: a recursive check would itself run out of
 * stack on the documents this guard exists to refuse.
 */
function nestingDepth(tree: Nodes): number {
  let deepest = 0;
  const pending: Array<{ node: Nodes; depth: number }> = [
    { node: tree, depth: 1 },
  ];
  let item = pending.pop();
  while (item !== undefined) {
    if (item.depth > deepest) deepest = item.depth;
    if (
      item.depth <= markdownLimits.maxNestingDepth &&
      'children' in item.node
    ) {
      for (const child of item.node.children)
        pending.push({ node: child, depth: item.depth + 1 });
    }
    item = pending.pop();
  }
  return deepest;
}

/** Builds a text-only HTML element. */
function textElement(
  tagName: string,
  properties: Record<string, string>,
  value: string,
): Element {
  return {
    type: 'element',
    tagName,
    properties,
    children: [{ type: 'text', value }],
  };
}

/**
 * The math node types that remark-math registers on the mdast tree.
 *
 * They are read out of the registry rather than imported from the utility
 * package, so this package declares no dependency on an internal package of
 * remark-math.
 */
type InlineMathNode = Extract<Nodes, { type: 'inlineMath' }>;
type MathNode = Extract<Nodes, { type: 'math' }>;

/**
 * Turns a math node into a placeholder that keeps its source.
 *
 * Task 15 replaces this with sanitized KaTeX output. The placeholder holds the
 * source as text, so it is escaped on serialization and cannot inject markup.
 */
function mathPlaceholder(node: InlineMathNode | MathNode): Element {
  return textElement(
    'span',
    { dataMath: node.type === 'math' ? 'display' : 'inline' },
    node.value,
  );
}

/** Info strings that are safe to repeat in a class name. */
const languagePattern = /^[a-z0-9_-]+$/;

/**
 * Renders a fenced or indented code block.
 *
 * A `mermaid` fence becomes a diagram placeholder that keeps its source. Task
 * 15 renders it inside an isolated frame. Every other block becomes normal
 * preformatted code with a language class when the info string is a plain
 * word.
 */
function codeBlock(node: Code): Element {
  const language = (node.lang ?? '').toLowerCase();
  if (language === 'mermaid')
    return textElement('pre', { dataDiagram: 'mermaid' }, node.value);
  const code: Element = {
    type: 'element',
    tagName: 'code',
    properties: languagePattern.test(language)
      ? { className: [`language-${language}`] }
      : {},
    children: [{ type: 'text', value: `${node.value}\n` }],
  };
  return { type: 'element', tagName: 'pre', properties: {}, children: [code] };
}

/** Reads a string property, or `null` when it is absent or not a string. */
function stringProperty(node: Element, name: string): string | null {
  const value = node.properties[name];
  return typeof value === 'string' ? value : null;
}

/** Replaces an element with a text-only placeholder, keeping its position. */
function replaceWith(
  node: Element,
  tagName: string,
  properties: Record<string, string>,
  children: ElementContent[],
): void {
  node.tagName = tagName;
  node.properties = properties;
  node.children = children;
}

/** A footnote link is generated by the converter, not written by an author. */
function isFootnoteLink(node: Element): boolean {
  return (
    'dataFootnoteRef' in node.properties ||
    'dataFootnoteBackref' in node.properties
  );
}

/**
 * Applies the URL policy to every link and image in the HTML tree.
 *
 * This runs on HTML nodes rather than Markdown nodes so that one pass covers
 * inline links, reference links, autolinks, images, and reference images. A
 * blocked destination keeps its visible text and loses its destination, so the
 * reader still sees what the author wrote.
 */
function applyUrlPolicy() {
  return (tree: HastRoot): undefined => {
    visit(tree, 'element', (node) => {
      if (node.tagName === 'a') {
        if (isFootnoteLink(node)) return;
        const href = stringProperty(node, 'href');
        const target =
          href === null ? { kind: 'blocked' as const } : classifyUrl(href);
        if (target.kind === 'blocked') {
          replaceWith(node, 'span', { dataBlocked: 'link' }, node.children);
          return;
        }
        // An external destination opens outside the application, so it never
        // gets a window handle back. A `target` attribute is never emitted.
        node.properties =
          target.kind === 'external'
            ? { href: target.href, rel: ['noopener', 'noreferrer'] }
            : { href: target.href };
        return;
      }
      if (node.tagName !== 'img') return;
      const source = stringProperty(node, 'src');
      const alt = stringProperty(node, 'alt') ?? '';
      const target =
        source === null ? { kind: 'blocked' as const } : classifyUrl(source);
      if (target.kind === 'attachment') {
        const title = stringProperty(node, 'title');
        node.properties =
          title === null
            ? { src: target.href, alt }
            : { src: target.href, alt, title };
        return;
      }
      // The design requires an explicit user action before an external image
      // loads, so the renderer emits a placeholder and never an `img` element.
      if (target.kind === 'external') {
        replaceWith(node, 'span', { dataExternalImage: target.href }, [
          { type: 'text', value: alt },
        ]);
        return;
      }
      replaceWith(node, 'span', { dataBlocked: 'image' }, [
        { type: 'text', value: alt },
      ]);
    });
  };
}

const renderProcessor = createMarkdownProcessor()
  .use(remarkRehype, {
    // Raw HTML is dropped here. This is the reason the renderer needs no raw
    // HTML pass and no dangerous-HTML option anywhere later.
    allowDangerousHtml: false,
    // Footnote identifiers are namespaced here, so the sanitizer does not have
    // to namespace them a second time. See `sanitizeSchema`.
    clobberPrefix: 'user-content-',
    handlers: {
      code: (_state, node: Code) => codeBlock(node),
      inlineMath: (_state, node: InlineMathNode) => mathPlaceholder(node),
      math: (_state, node: MathNode) => mathPlaceholder(node),
    },
  })
  .use(applyUrlPolicy)
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStringify)
  .freeze();

/**
 * Renders `source` into sanitized HTML.
 *
 * Rejects with `MarkdownLimitError` when the document is larger than
 * `markdownLimits.maxInputBytes` or nested deeper than
 * `markdownLimits.maxNestingDepth`. Every other document renders; unknown
 * syntax simply stays text.
 */
export async function renderMarkdown(source: string): Promise<string> {
  const bytes = utf8ByteLength(source);
  if (bytes > markdownLimits.maxInputBytes)
    throw new MarkdownLimitError(
      'input-size',
      markdownLimits.maxInputBytes,
      bytes,
    );
  const tree = renderProcessor.parse(source);
  const depth = nestingDepth(tree);
  if (depth > markdownLimits.maxNestingDepth)
    throw new MarkdownLimitError(
      'nesting-depth',
      markdownLimits.maxNestingDepth,
      depth,
    );
  return renderProcessor.stringify(await renderProcessor.run(tree));
}
