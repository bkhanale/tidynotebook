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
 *   person never loses words they wrote.
 * - A tag that would change how the parser reads the rest of the note is no
 *   tag at all. `neutralAuthorTags` lists the tags of GFM tagfilter and the
 *   select of a form: each one switches the parser into text, a raw text or
 *   a form mode, so one unclosed tag took or flattened every later block.
 *   `neutralizeAuthorTags` writes its opening bracket as text before the
 *   parse, so the tag and every word after it read as words.
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
 * Each one holds a script, a style, or a document of its own. The tags of the
 * author never build one, because `neutralizeAuthorTags` turns each into text
 * first, so the list is the second gate behind that rule. Every other element
 * outside `authorElements`, a `template` and an `object` among them, keeps
 * its children.
 */
export const authorStrippedElements: readonly string[] = [
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'script',
  'style',
];

/**
 * The tags that the parser never reads as tags (GFM tagfilter and `select`).
 *
 * Each one switches the HTML parser into a mode that reads the rest of the
 * document another way: `title`, `textarea` and `xmp` and the raw text
 * elements read every later tag as text, `plaintext` never ends, and `select`
 * drops every later tag that is not an option.
 */
export const neutralAuthorTags: readonly string[] = [
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'plaintext',
  'script',
  'select',
  'style',
  'textarea',
  'title',
  'xmp',
];

/** An opening or a closing tag of one of `neutralAuthorTags`. */
const neutralTag = new RegExp(
  `<(/?)(${neutralAuthorTags.join('|')})(?=[\\s/>]|$)`,
  'gi',
);

/**
 * The HTML of one raw node with each neutral tag written as text.
 *
 * Only the opening bracket changes, to the entity that the parser reads as a
 * plain `<`, so the reader sees the tag as the author typed it, and the words
 * after it stay words of the note.
 */
export function neutralizeAuthorTags(html: string): string {
  return html.replace(neutralTag, '&lt;$1$2');
}

/**
 * Elements whose end tag the author may leave out, or that hold no content.
 *
 * Neither can nest without an element that does need its end tag, so neither
 * adds to the depth that `authorNestingDepth` measures.
 */
const shallowElements = new Set([
  'area',
  'base',
  'br',
  'caption',
  'col',
  'colgroup',
  'dd',
  'dt',
  'embed',
  'hr',
  'img',
  'input',
  'li',
  'link',
  'meta',
  'optgroup',
  'option',
  'p',
  'param',
  'rp',
  'rt',
  'source',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'track',
  'wbr',
]);

/** One opening or closing tag, with a self closing slash or not. */
const anyTag =
  /<(\/?)([A-Za-z][A-Za-z0-9-]*)\b(?:"[^"]*"|'[^']*'|[^>"'])*?(\/?)>/g;

/**
 * The deepest nesting that the HTML of a note can open, as an upper bound.
 *
 * An HTML block is one node of the Markdown tree, so the depth guard of
 * `./limits.ts` never sees the elements inside it, and the HTML parse and the
 * serializer recurse on them. The values are the raw nodes in document order.
 * Each opening tag opens a level and each closing tag closes one, whether or
 * not the parser pairs them later, so the answer is never less than the depth
 * that the parse builds. A tag of `shallowElements` and a self closing tag
 * open nothing.
 */
export function authorNestingDepth(values: readonly string[]): number {
  let depth = 0;
  let deepest = 0;
  for (const value of values)
    for (const match of value.matchAll(anyTag)) {
      const name = (match[2] ?? '').toLowerCase();
      if (shallowElements.has(name) || match[3] === '/') continue;
      if (match[1] === '/') depth = Math.max(0, depth - 1);
      else {
        depth += 1;
        if (depth > deepest) deepest = depth;
      }
    }
  return deepest;
}

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
