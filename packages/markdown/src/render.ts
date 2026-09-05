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
 * - It never runs unbounded work. `./limits.ts` bounds the document before the
 *   parser sees it and bounds the parsed tree afterwards.
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
import { createMarkdownProcessor, parseMarkdown } from './parse.ts';
import { classifyUrl, sanitizeSchema } from './policy.ts';

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

/**
 * Reports whether the converter generated this link itself.
 *
 * A footnote reference and its back reference are the only links this pipeline
 * creates, and their fragment destinations are not author-supplied. Both the
 * marker attribute and the generated fragment must match, so an author cannot
 * exempt an arbitrary destination by writing a `data-footnote-ref` attribute:
 * raw HTML never reaches this stage, and this check would still refuse it.
 */
function isFootnoteLink(node: Element): boolean {
  const marked =
    'dataFootnoteRef' in node.properties ||
    'dataFootnoteBackref' in node.properties;
  return (
    marked &&
    (stringProperty(node, 'href') ?? '').startsWith('#user-content-fn')
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
        // A title is author text that the serializer escapes, so it is kept:
        // dropping it would lose content that a reader can see on hover.
        // An external destination opens outside the application, so it never
        // gets a window handle back. A `target` attribute is never emitted.
        const title = stringProperty(node, 'title');
        const rest = title === null ? {} : { title };
        node.properties =
          target.kind === 'external'
            ? { href: target.href, ...rest, rel: ['noopener', 'noreferrer'] }
            : { href: target.href, ...rest };
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
 * Rejects with `MarkdownLimitError` when the document exceeds a fixed limit of
 * this package; see `./limits.ts`. Every other document renders, and unknown
 * syntax simply stays text.
 */
export async function renderMarkdown(source: string): Promise<string> {
  // `parseMarkdown` applies the pre-scan and the depth guard, and it uses the
  // same Markdown plugins as this processor, so the tree it returns is the
  // tree this processor would have produced.
  const tree = parseMarkdown(source);
  return renderProcessor.stringify(await renderProcessor.run(tree));
}
