/**
 * Content policy for stored Markdown.
 *
 * This module owns two decisions that every reader of a note depends on: which
 * URL a rendered document may point at, and which HTML elements and attributes
 * may survive rendering. The editor, the server, and the public share page all
 * import the same policy, so a note renders under identical rules everywhere.
 *
 * The policy is an allow list. An unknown scheme, an unknown path shape, an
 * unknown element, and an unknown attribute are all removed. Nothing here
 * fetches anything; a caller resolves an internal reference through the
 * generated API operations.
 */
import type { Options as SanitizeSchema } from 'rehype-sanitize';

/**
 * Shape of a canonical identifier, as written in stored Markdown.
 *
 * The check is a shape check only. It accepts the RFC 9562 text form with a
 * version between 1 and 8 and a variant of 8, 9, a, or b. It rejects the nil
 * and maximum identifiers, so a placeholder cannot become a link target.
 */
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Reports whether `value` has the canonical identifier shape. */
export function isIdentifier(value: string): boolean {
  return uuidPattern.test(value.toLowerCase());
}

/** A classified link or image destination. */
export type ContentUrl =
  | { readonly kind: 'note'; readonly id: string; readonly href: string }
  | { readonly kind: 'attachment'; readonly id: string; readonly href: string }
  | { readonly kind: 'external'; readonly href: string }
  | { readonly kind: 'blocked' };

const blocked: ContentUrl = { kind: 'blocked' };
/**
 * Reports whether the text holds a control character.
 *
 * A control character can hide a scheme from a reader and from a simple check,
 * for example a tab inside `java<tab>script:`, so a destination that holds one
 * is blocked. The scan is a loop and not a regular expression, because a
 * control character inside a pattern is invisible to a reviewer.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** The only schemes an author may write. */
const allowedScheme = /^(?:https?|mailto):/i;
const notePath = /^\/notes\/([^/?#]+)$/;
const attachmentPath = /^\/attachments\/([^/?#]+)$/;

/**
 * Classifies an author-supplied destination.
 *
 * Accepted forms are `https:`, `http:`, `mailto:`, `/notes/<id>`, and
 * `/attachments/<id>`. Everything else is blocked, including `javascript:`,
 * `data:`, `vbscript:`, `file:`, a protocol-relative `//host/path`, a bare
 * fragment, and any other relative path. A malformed identifier is blocked
 * too, so a broken reference can never become a working target.
 */
export function classifyUrl(raw: string): ContentUrl {
  const url = raw.trim();
  if (url === '' || hasControlCharacter(url)) return blocked;
  if (url.startsWith('//')) return blocked;
  if (url.startsWith('/')) {
    const note = notePath.exec(url)?.[1];
    if (note !== undefined) {
      const id = note.toLowerCase();
      return isIdentifier(id)
        ? { kind: 'note', id, href: `/notes/${id}` }
        : blocked;
    }
    const attachment = attachmentPath.exec(url)?.[1];
    if (attachment !== undefined) {
      const id = attachment.toLowerCase();
      return isIdentifier(id)
        ? { kind: 'attachment', id, href: `/attachments/${id}` }
        : blocked;
    }
    return blocked;
  }
  return allowedScheme.test(url) ? { kind: 'external', href: url } : blocked;
}

/**
 * The sanitization schema for rendered notes.
 *
 * It is written out rather than derived from the rehype-sanitize GitHub
 * schema. That schema keeps elements and attributes that only raw HTML can
 * produce, and raw HTML never reaches this stage. An explicit list is also
 * easier to review: every element below is one that the renderer itself emits.
 *
 * Additions over the plain CommonMark set are the GFM table elements, the
 * disabled task-list checkbox, the footnote section with its back references,
 * and the placeholder elements for math and diagrams.
 *
 * Math is a placeholder in this task. KaTeX arrives with Task 15 and needs
 * more elements and attributes. That task extends this schema at this point;
 * it does not relax the URL rules above.
 *
 * `clobberPrefix` is empty on purpose. The renderer already asks
 * mdast-util-to-hast for the `user-content-` prefix, so a footnote identifier
 * is namespaced before this stage. Prefixing a second time here would rename
 * the identifier without renaming the fragment that points at it, which breaks
 * every footnote back reference.
 */
export const sanitizeSchema: SanitizeSchema = {
  strip: ['script', 'style'],
  clobber: [],
  clobberPrefix: '',
  protocols: {
    href: ['http', 'https', 'mailto'],
    // An image source is always an internal attachment path, which carries no
    // scheme. An external image becomes a placeholder before this stage.
    src: [],
    dataExternalImage: ['http', 'https'],
  },
  ancestors: {
    input: ['li'],
    li: ['ol', 'ul'],
    tbody: ['table'],
    td: ['table'],
    th: ['table'],
    thead: ['table'],
    tr: ['table'],
  },
  required: { input: { type: 'checkbox', disabled: true } },
  tagNames: [
    'a',
    'blockquote',
    'br',
    'code',
    'del',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'img',
    'input',
    'li',
    'ol',
    'p',
    'pre',
    'section',
    'span',
    'strong',
    'sup',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'ul',
  ],
  attributes: {
    a: [
      'href',
      'id',
      'ariaDescribedBy',
      'ariaLabel',
      'dataFootnoteBackref',
      'dataFootnoteRef',
      ['className', 'data-footnote-backref'],
      ['rel', 'noopener', 'noreferrer'],
    ],
    code: [['className', /^language-[a-z0-9_-]+$/]],
    h2: ['id', ['className', 'sr-only']],
    img: ['alt', 'src', 'title'],
    input: [
      ['type', 'checkbox'],
      ['disabled', true],
      ['checked', true],
    ],
    li: ['id', ['className', 'task-list-item']],
    ol: ['start', ['className', 'contains-task-list']],
    pre: [['dataDiagram', 'mermaid']],
    section: ['dataFootnotes', ['className', 'footnotes']],
    span: [
      ['dataMath', 'inline', 'display'],
      ['dataBlocked', 'link', 'image'],
      'dataExternalImage',
    ],
    td: [['align', 'center', 'left', 'right']],
    th: [['align', 'center', 'left', 'right']],
    ul: [['className', 'contains-task-list']],
    '*': [],
  },
};
