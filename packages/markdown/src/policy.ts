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
 * The only identifier shape the renderer may emit.
 *
 * mdast-util-to-hast writes a footnote identifier as `user-content-fn-<label>`
 * or `user-content-fnref-<label>`. Requiring the prefix and one following
 * character keeps every identifier inside that namespace.
 */
const namespacedId = /^user-content-[A-Za-z0-9]/;

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
 * Math renders through `./math.ts`, which sanitizes KaTeX HTML on its own
 * and inserts it after this schema ran. The main pipeline therefore keeps
 * only the `data-math` placeholder. The class and `aria-hidden` entries below
 * exist so that a second pass of this schema over already rendered math, for
 * example on the public share page, keeps the KaTeX layout classes without
 * reopening a style or URL surface: `style` stays dropped here and is owned
 * by the math sanitizer alone.
 *
 * `clobberPrefix` is empty on purpose. The renderer already asks
 * mdast-util-to-hast for the `user-content-` prefix, so a footnote identifier
 * is namespaced before this stage. Prefixing a second time here would rename
 * the identifier without renaming the fragment that points at it, which breaks
 * every footnote back reference. Because this schema does not add the prefix,
 * it requires it instead: an `id` must start with `user-content-` and a
 * character, so a note cannot claim a plain identifier such as `submit` and
 * clobber a form control or a script variable.
 *
 * That prefix is shared by every note. A page that renders one note is
 * therefore safe, which is what the public share page does. A page that
 * renders several notes at once must scope the footnote identifiers itself,
 * for example by rendering each note in its own document fragment; two notes
 * with the same footnote label would otherwise produce the same identifier.
 *
 * A `title` on a link or an image is author text. It is kept, because a reader
 * can see it and losing it would lose content. The serializer escapes it, so
 * it cannot carry markup, and it holds no URL.
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
      'title',
      'ariaDescribedBy',
      'ariaLabel',
      'dataFootnoteBackref',
      'dataFootnoteRef',
      ['className', 'data-footnote-backref'],
      ['id', namespacedId],
      ['rel', 'noopener', 'noreferrer'],
    ],
    code: [['className', /^language-[a-z0-9_-]+$/]],
    h2: [
      ['className', 'sr-only'],
      ['id', 'footnote-label'],
    ],
    img: ['alt', 'src', 'title'],
    input: [
      ['type', 'checkbox'],
      ['disabled', true],
      ['checked', true],
    ],
    li: [
      ['className', 'task-list-item'],
      ['id', namespacedId],
    ],
    ol: ['start', ['className', 'contains-task-list']],
    pre: [['dataDiagram', 'mermaid']],
    section: [
      'dataFootnotes',
      ['className', 'footnotes'],
      ['id', namespacedId],
    ],
    sup: [['id', namespacedId]],
    span: [
      ['dataMath', 'inline', 'display'],
      ['dataBlocked', 'link', 'image'],
      'dataExternalImage',
      'ariaHidden',
      [
        'className',
        'notes-math',
        'notes-math-inline',
        'notes-math-display',
        'katex',
        'katex-display',
        'katex-html',
        'base',
        'strut',
        'mord',
        'mop',
        'mbin',
        'mrel',
        'mopen',
        'mclose',
        'mpunct',
        'minner',
        'vlist-t',
        'vlist-r',
        'vlist',
        'pstrut',
        'mtight',
        'mspace',
        'msupsub',
        'sizing',
        'delimsizing',
        'fontsize-ensurer',
        'svg-align',
        'hide-tail',
        'thinbox',
        'mathnormal',
        'text',
        /^katex[a-z-]*$/,
        /^reset-size[0-9]*$/,
        /^size[0-9]*$/,
      ],
    ],
    td: [['align', 'center', 'left', 'right']],
    th: [['align', 'center', 'left', 'right']],
    ul: [['className', 'contains-task-list']],
    '*': [],
  },
};
