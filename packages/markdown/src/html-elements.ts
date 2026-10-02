/**
 * The HTML that an author may write in a note (record 0157).
 *
 * A note is Markdown, and CommonMark keeps HTML inside it. The GitHub renderer
 * keeps a safe subset of that HTML, and a note that comes from GitHub, from
 * Obsidian or from a README holds the same subset: a key in `<kbd>`, a
 * subscript, a mark, a line break, and a block that folds with `<details>`.
 *
 * This module is the one list of that subset. `render.ts` applies it to every
 * element that the author wrote, right after the HTML parse, and `policy.ts`
 * names the same elements and attributes in the schema of the sanitizer,
 * which stays the last gate behind it. The live preview reads
 * `previewHtmlElements` and draws the same inline elements in the note.
 *
 * Three rules hold the list safe.
 *
 * - No element runs a script or loads a resource. A link and a picture are
 *   Markdown constructs, so the URL policy reads them there. Their HTML form
 *   is not on the list and keeps its text only.
 * - No attribute holds a style, an event, a class, an identifier or an
 *   address. Each attribute below states the one shape of value it keeps.
 * - An element outside the list loses its tags and keeps its children, so a
 *   person never loses words they wrote. The elements of
 *   `authorStrippedElements` are the exception: they hold code or a document
 *   of their own, so they leave with their content.
 */

/** The shape of value that one kept attribute may hold. */
export type AuthorAttributeValue =
  /** Any text. The serializer escapes it, and no text here is an address. */
  | { readonly kind: 'text' }
  /** The attribute is present or absent and holds no value. */
  | { readonly kind: 'flag' }
  /** A whole number of at least one and at most `max`. */
  | { readonly kind: 'count'; readonly max: number }
  /** One of a closed set of words. */
  | { readonly kind: 'word'; readonly words: readonly string[] };

/** One kept attribute, by its hast property name. */
export type AuthorAttribute = {
  readonly name: string;
  readonly value: AuthorAttributeValue;
};

const text: AuthorAttributeValue = { kind: 'text' };
const flag: AuthorAttributeValue = { kind: 'flag' };

/** The alignment of a cell, as GFM writes it. */
const alignment: AuthorAttribute = {
  name: 'align',
  value: { kind: 'word', words: ['left', 'center', 'right'] },
};

/** The span of a cell across columns or rows. */
const cellSpan = (name: string): AuthorAttribute => ({
  name,
  value: { kind: 'count', max: 1000 },
});

/** The attributes of one table cell. */
const cellAttributes: readonly AuthorAttribute[] = [
  alignment,
  cellSpan('colSpan'),
  cellSpan('rowSpan'),
];

/**
 * Every element an author may write, with the attributes it keeps.
 *
 * The keys are the tag names of the HTML standard in lower case, which is how
 * the parser reports them. An element with an empty list keeps no attribute.
 */
export const authorElements: ReadonlyMap<string, readonly AuthorAttribute[]> =
  new Map<string, readonly AuthorAttribute[]>([
    // Text level elements.
    ['abbr', [{ name: 'title', value: text }]],
    ['b', []],
    ['bdi', []],
    ['br', []],
    ['cite', []],
    ['code', []],
    ['del', []],
    ['dfn', [{ name: 'title', value: text }]],
    ['em', []],
    ['i', []],
    ['ins', []],
    ['kbd', []],
    ['mark', []],
    ['q', []],
    ['rp', []],
    ['rt', []],
    ['ruby', []],
    ['s', []],
    ['samp', []],
    ['small', []],
    ['span', []],
    ['strike', []],
    ['strong', []],
    ['sub', []],
    ['sup', []],
    ['time', [{ name: 'dateTime', value: text }]],
    ['u', []],
    ['var', []],
    ['wbr', []],
    // Block elements.
    ['blockquote', []],
    ['caption', []],
    ['dd', []],
    ['details', [{ name: 'open', value: flag }]],
    ['div', []],
    ['dl', []],
    ['dt', []],
    ['figcaption', []],
    ['figure', []],
    ['h1', []],
    ['h2', []],
    ['h3', []],
    ['h4', []],
    ['h5', []],
    ['h6', []],
    ['hr', []],
    ['li', []],
    [
      'ol',
      [
        { name: 'start', value: { kind: 'count', max: 1000000 } },
        { name: 'reversed', value: flag },
      ],
    ],
    ['p', []],
    ['pre', []],
    ['summary', []],
    ['table', []],
    ['tbody', []],
    ['td', cellAttributes],
    ['tfoot', []],
    ['th', cellAttributes],
    ['thead', []],
    ['tr', []],
    ['ul', []],
  ]);

/**
 * The elements that leave with their content.
 *
 * Each one holds a script, a style, or a document of its own, whose text is
 * not words of the note. Every other element outside `authorElements` keeps
 * its children.
 */
export const authorStrippedElements: readonly string[] = [
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'object',
  'script',
  'style',
  'template',
];

/**
 * The inline elements that the live preview draws between their tags.
 *
 * Each one changes how its words look and nothing else, so a mark decoration
 * over the text between the two tags draws it, and the source stays editable
 * at every position. A block element and `<br>` stay source in the editor,
 * because the closed widget set of record 0002 has no widget for them.
 */
export const previewHtmlElements: readonly string[] = [
  'abbr',
  'b',
  'cite',
  'code',
  'del',
  'dfn',
  'em',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'strike',
  'strong',
  'sub',
  'sup',
  'u',
  'var',
];

/** One HTML tag as the live preview reads it from one `HTMLTag` node. */
export type HtmlTag = {
  /** The tag name in lower case. */
  readonly name: string;
  /** Whether the tag closes an element. */
  readonly closing: boolean;
};

/**
 * A plain opening or closing tag of one previewed element.
 *
 * The editor reads the text of one `HTMLTag` node of the Lezer tree, never
 * the document, so this is a shape check on one token and not a scanner. An
 * opening tag that carries an attribute is not drawn: its source stays.
 */
const plainTag = /^<(\/?)([A-Za-z][A-Za-z0-9]*)\s*>$/;

/**
 * Reads one `HTMLTag` token as a tag of a previewed element, or `null`.
 *
 * A tag of an element outside `previewHtmlElements`, a self-closing tag, and
 * a tag with an attribute all answer `null`, so the preview leaves them as
 * source.
 */
export function previewHtmlTag(token: string): HtmlTag | null {
  const match = plainTag.exec(token);
  if (match === null) return null;
  const name = (match[2] ?? '').toLowerCase();
  if (!previewHtmlElements.includes(name)) return null;
  return { name, closing: match[1] === '/' };
}

/** Whether one value of an author attribute keeps its shape. */
function keepsShape(value: unknown, shape: AuthorAttributeValue): boolean {
  if (shape.kind === 'text') return typeof value === 'string';
  if (shape.kind === 'flag') return value === true || value === '';
  if (shape.kind === 'count')
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= shape.max
    );
  return typeof value === 'string' && shape.words.includes(value);
}

/**
 * The attributes of one author element that the list keeps.
 *
 * The input is the hast property map that the HTML parser wrote. A property
 * that the element does not list, or whose value has another shape, leaves.
 */
export function authorProperties(
  tagName: string,
  properties: Readonly<Record<string, unknown>>,
): Record<string, string | number | boolean> {
  const kept: Record<string, string | number | boolean> = {};
  for (const attribute of authorElements.get(tagName) ?? []) {
    const value = properties[attribute.name];
    if (!keepsShape(value, attribute.value)) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    )
      kept[attribute.name] = value;
  }
  return kept;
}
