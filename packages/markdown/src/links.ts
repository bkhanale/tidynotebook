/**
 * Reference extraction from stored Markdown.
 *
 * A note points at another note with a normal Markdown link whose destination
 * is `/notes/<file-id>`. The identifier is stable, so a rename never breaks the
 * link. A note points at an image with `/attachments/<revision-id>`, which is
 * immutable, so replacing a file cannot change an image in historic content.
 *
 * Nothing in this module fetches or resolves anything.
 *
 * Every reported range is a pair of offsets into the exact source string that
 * was passed in, so `source.slice(range.from, range.to)` returns the reported
 * `source` text. That includes a document that starts with a byte order mark:
 * the parser removes the mark before it assigns offsets, so its length is
 * added back here.
 */
import type { Nodes, Root } from 'mdast';
import { toString } from 'mdast-util-to-string';
import { visit } from 'unist-util-visit';
import { parseMarkdown } from './parse.ts';
import { classifyUrl, isIdentifier } from './policy.ts';
import { readableTextOf } from './readable-text.ts';

/** A half-open offset range into the parsed source string. */
export type SourceRange = { readonly from: number; readonly to: number };

/**
 * One reference from this note to another note.
 *
 * `targetId` holds the file identifier when the reference names one. It is
 * `null` for a `/notes/` link with a malformed identifier: an unresolved
 * reference is never treated as a target.
 *
 * `label` is the text a reader sees. `source` keeps the raw text.
 */
export type NoteLink = {
  readonly range: SourceRange;
  readonly label: string;
  readonly targetId: string | null;
  /** The resolved portable target, or `null` for a legacy or invalid link. */
  readonly targetPath: string | null;
  readonly source: string;
};

/** One immutable attachment reference from this note. */
export type AttachmentRef = {
  readonly range: SourceRange;
  /** A legacy immutable revision identifier, or `null` for a portable path. */
  readonly revisionId: string | null;
  /** The resolved portable target, or `null` for a legacy reference. */
  readonly targetPath: string | null;
  readonly source: string;
};

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
 * The result holds `/notes/` links, whether or not their identifier is valid.
 * It does not hold external links or attachment references: those never point
 * at a note. References are returned in source order.
 */
export function extractLinks(
  source: string,
  sourcePath = '',
): readonly NoteLink[] {
  return linksOf(parseMarkdown(source), source, sourcePath);
}

/**
 * The note links and the readable text of one note, from one parse.
 *
 * The server index needs both for every accepted note, and a parse of a long
 * note costs more than the two walks of its tree together.
 */
export function indexNote(
  source: string,
  sourcePath = '',
): { readonly links: readonly NoteLink[]; readonly text: string } {
  const tree = parseMarkdown(source);
  return {
    links: linksOf(tree, source, sourcePath),
    text: readableTextOf(tree),
  };
}

/** The note links of a parsed tree of `source`, in source order. */
function linksOf(
  tree: Root,
  source: string,
  sourcePath: string,
): readonly NoteLink[] {
  const shift = markLength(source);
  const links: NoteLink[] = [];
  visit(tree, (node) => {
    if (node.type !== 'link' && node.type !== 'definition') return;
    const url = node.url.trim();
    const target = classifyUrl(url, sourcePath);
    if (
      target.kind !== 'note' &&
      (target.kind !== 'relative' || !target.path.endsWith('.md')) &&
      !url.toLowerCase().startsWith('/notes/')
    )
      return;
    const range = rangeOf(node, shift);
    if (range === null) return;
    const label =
      node.type === 'link' ? toString(node) : (node.label ?? node.identifier);
    links.push({
      range,
      label,
      targetId: target.kind === 'note' ? target.id : null,
      targetPath: target.kind === 'relative' ? target.path : null,
      source: source.slice(range.from, range.to),
    });
  });
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
  sourcePath = '',
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
    const target = classifyUrl(node.url, sourcePath);
    if (
      target.kind !== 'attachment' &&
      (target.kind !== 'relative' || !target.path.startsWith('attachments/'))
    )
      return;
    if (target.kind === 'attachment' && !isIdentifier(target.id)) return;
    const range = rangeOf(node, shift);
    if (range === null) return;
    refs.push({
      range,
      revisionId: target.kind === 'attachment' ? target.id : null,
      targetPath: target.kind === 'relative' ? target.path : null,
      source: source.slice(range.from, range.to),
    });
  });
  return refs.sort(byPosition);
}
