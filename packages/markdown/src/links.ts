/**
 * Reference extraction from stored Markdown.
 *
 * A note points at another note with a normal Markdown link whose destination
 * is `/notes/<file-id>`. The identifier is stable, so a rename never breaks the
 * link. A note points at an image with `/attachments/<revision-id>`, which is
 * immutable, so replacing a file cannot change an image in historic content.
 *
 * An author can also write a wiki reference, `[[Title]]` or `[[Title|label]]`.
 * That form names a title, not an identifier, so it stays unresolved here.
 * Resolution needs the workspace file list and happens in the caller. Nothing
 * in this module fetches or resolves anything.
 *
 * Every reported range is a pair of offsets into the exact source string that
 * was passed in, so `source.slice(range.from, range.to)` returns the reported
 * `source` text. That includes a document that starts with a byte order mark:
 * the parser removes the mark before it assigns offsets, so its length is
 * added back here.
 */
import type { Nodes } from 'mdast';
import { toString } from 'mdast-util-to-string';
import { visit } from 'unist-util-visit';
import { parseMarkdown } from './parse.ts';
import { classifyUrl, isIdentifier } from './policy.ts';

/** A half-open offset range into the parsed source string. */
export type SourceRange = { readonly from: number; readonly to: number };

/**
 * One reference from this note to another note.
 *
 * `targetId` holds the file identifier when the reference names one. It is
 * `null` for a wiki reference and for a `/notes/` link with a malformed
 * identifier: an unresolved reference is never treated as a target.
 *
 * `label` is the text a reader sees. For a wiki reference that is the label
 * part when the author wrote one, otherwise the title. `source` keeps the raw
 * text, so a caller that needs the title of `[[Title|label]]` can read it back
 * with `parseWikiLink`.
 */
export type NoteLink = {
  readonly range: SourceRange;
  readonly label: string;
  readonly targetId: string | null;
  readonly source: string;
};

/** One immutable attachment reference from this note. */
export type AttachmentRef = {
  readonly range: SourceRange;
  readonly revisionId: string;
  readonly source: string;
};

/** The two parts of a wiki reference. */
export type WikiLink = { readonly title: string; readonly label: string };

/**
 * A wiki reference: `[[Title]]` or `[[Title|label]]`.
 *
 * A title cannot contain a bracket, a pipe, or a line break, so a stray
 * bracket in running text cannot swallow the rest of a paragraph.
 */
const wikiPattern = /\[\[([^[\]|\n\r]*)(?:\|([^[\]|\n\r]*))?\]\]/g;

/**
 * Reads the title and the label out of the raw text of a wiki reference.
 *
 * Returns `null` when the text is not a single complete wiki reference.
 */
export function parseWikiLink(source: string): WikiLink | null {
  const match = /^\[\[([^[\]|\n\r]*)(?:\|([^[\]|\n\r]*))?\]\]$/.exec(source);
  if (!match) return null;
  const title = (match[1] ?? '').trim();
  const label = (match[2] ?? '').trim();
  if (title === '') return null;
  return { title, label: label === '' ? title : label };
}

/**
 * The length of a leading byte order mark, which the parser does not count.
 *
 * The mark is one character of the source string, and the parser strips it
 * before it assigns offsets. Adding this back to every reported offset keeps a
 * range addressing the string the caller holds.
 */
function markLength(source: string): number {
  return source.startsWith('\ufeff') ? 1 : 0;
}

/** The offsets of a node in the caller's string, or `null` when it has none. */
function rangeOf(node: Nodes, shift: number): SourceRange | null {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  if (from === undefined || to === undefined) return null;
  return { from: from + shift, to: to + shift };
}

/**
 * Merges the offsets of every plain text node into as few ranges as possible.
 *
 * Wiki syntax is not Markdown syntax, so the parser reports it as text. The
 * parser may still split one run of text into several nodes while it tries and
 * rejects a link, so neighboring ranges are joined before scanning. Scanning
 * text ranges only is what keeps a wiki reference inside a code span or a
 * fenced code block from counting.
 */
function textRanges(tree: Nodes, shift: number): SourceRange[] {
  const ranges: SourceRange[] = [];
  visit(tree, 'text', (node) => {
    const range = rangeOf(node, shift);
    if (range === null) return;
    const last = ranges.at(-1);
    if (last !== undefined && last.to === range.from) {
      ranges[ranges.length - 1] = { from: last.from, to: range.to };
      return;
    }
    ranges.push(range);
  });
  return ranges;
}

/**
 * Reports whether the character before `index` escapes it.
 *
 * An odd number of backslashes escapes the bracket, so `\[[Title]]` is text
 * that the author asked to keep, not a reference.
 */
function isEscaped(source: string, index: number): boolean {
  let count = 0;
  let position = index - 1;
  while (position >= 0 && source[position] === '\\') {
    count += 1;
    position -= 1;
  }
  return count % 2 === 1;
}

/** Collects the wiki references inside one merged text range. */
function wikiLinksIn(source: string, range: SourceRange): NoteLink[] {
  const slice = source.slice(range.from, range.to);
  const links: NoteLink[] = [];
  wikiPattern.lastIndex = 0;
  let match = wikiPattern.exec(slice);
  while (match !== null) {
    const start = range.from + match.index;
    const raw = match[0];
    const parsed = parseWikiLink(raw);
    if (parsed !== null && !isEscaped(source, start)) {
      links.push({
        range: { from: start, to: start + raw.length },
        label: parsed.label,
        targetId: null,
        source: raw,
      });
    }
    match = wikiPattern.exec(slice);
  }
  return links;
}

/** Orders references by their position in the source. */
function byPosition(
  left: { range: SourceRange },
  right: { range: SourceRange },
) {
  return left.range.from - right.range.from || left.range.to - right.range.to;
}

/**
 * Extracts every reference from this note to another note.
 *
 * The result holds `/notes/` links, whether or not their identifier is valid,
 * and wiki references. It does not hold external links or attachment
 * references: those never produce a backlink. References are returned in
 * source order.
 */
export function extractLinks(source: string): readonly NoteLink[] {
  const tree = parseMarkdown(source);
  const shift = markLength(source);
  const links: NoteLink[] = [];
  visit(tree, (node) => {
    if (node.type !== 'link' && node.type !== 'definition') return;
    const url = node.url.trim();
    if (!url.toLowerCase().startsWith('/notes/')) return;
    const range = rangeOf(node, shift);
    if (range === null) return;
    const target = classifyUrl(url);
    const label =
      node.type === 'link' ? toString(node) : (node.label ?? node.identifier);
    links.push({
      range,
      label,
      targetId: target.kind === 'note' ? target.id : null,
      source: source.slice(range.from, range.to),
    });
  });
  for (const range of textRanges(tree, shift))
    links.push(...wikiLinksIn(source, range));
  return links.sort(byPosition);
}

/**
 * Extracts every immutable attachment reference from this note.
 *
 * Only a well-formed `/attachments/<revision-id>` reference is reported. A
 * malformed identifier is not an attachment, and the renderer does not turn it
 * into an image either. Images, plain links, and link reference definitions
 * are all inspected, so a reference-style image and a plain link to an
 * attachment are found too.
 */
export function extractAttachmentRefs(
  source: string,
): readonly AttachmentRef[] {
  const tree = parseMarkdown(source);
  const shift = markLength(source);
  const refs: AttachmentRef[] = [];
  visit(tree, (node) => {
    if (
      node.type !== 'image' &&
      node.type !== 'link' &&
      node.type !== 'definition'
    )
      return;
    const target = classifyUrl(node.url);
    if (target.kind !== 'attachment' || !isIdentifier(target.id)) return;
    const range = rangeOf(node, shift);
    if (range === null) return;
    refs.push({
      range,
      revisionId: target.id,
      source: source.slice(range.from, range.to),
    });
  });
  return refs.sort(byPosition);
}
