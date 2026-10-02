/**
 * The two resource limits of Markdown work.
 *
 * NotesApp is one self hosted deployment with one author, and that author is
 * the only person who can put text in front of this parser. The limits here
 * therefore protect the reader from an accident, not from an attacker: a
 * pasted database dump, a generated file, or a runaway loop that wrote a
 * million block quote markers on one line.
 *
 * There are two limits and nothing else:
 *
 * - The size of the document. The parser is fast on prose, and one mebibyte
 *   is far above any note a person writes.
 * - The nesting depth. Nesting is the one shape that can stop the parser
 *   rather than slow it down, so it is checked twice: on the line prefixes
 *   before the parse, because a line of a million `>` characters must never
 *   reach the parser, and on the tree after the parse, which also covers
 *   inline nesting such as repeated emphasis.
 *
 * There is no wall-clock timeout. A timeout would bound one render on one
 * machine and would make the outcome depend on the load of that machine, so
 * the same note could render for one reader and fail for another.
 *
 * A refused document is not truncated. The caller catches `MarkdownLimitError`
 * and shows the source as plain text, because cutting a note in half would
 * look like data loss. The server maps the error to a domain failure with a
 * message for the author; see `packages/storage-server/src/markdown-limits.ts`.
 */

/** The fixed resource limits of this package. */
export const markdownLimits = {
  /**
   * Largest accepted document, in UTF-8 bytes.
   *
   * The design budgets typical notes of 5 to 20 KiB and a 1 MiB stress file,
   * so this is the stress file size and nothing more.
   */
  maxInputBytes: 1024 * 1024,
  /**
   * Deepest accepted nesting written by an author.
   *
   * Before parsing this counts the block quote markers, the list markers, and
   * the indentation levels at the start of one line. After parsing it is the
   * depth of the tree, less the levels every document has. Real documents stay
   * far below it.
   */
  maxNestingDepth: 100,
} as const;

/**
 * Tree levels that every document has, whatever its author wrote.
 *
 * The shallowest document holds one leaf block and its text under the root.
 * Those two are subtracted, and the root itself is level zero, so a document
 * of one hundred nested block quotes reports one hundred levels.
 */
const documentDepth = 2;

/**
 * Columns of leading white space that count as one nesting level.
 *
 * CommonMark allows at most four columns of indentation before a block becomes
 * indented code, so four columns is the widest one list level can be.
 */
const columnsPerLevel = 4;

/** Why a document was refused. */
export type MarkdownLimitReason = 'input-size' | 'nesting-depth';

/** The sentence that explains one refusal. */
const reasons: Record<MarkdownLimitReason, string> = {
  'input-size': 'Markdown input is %actual bytes and the limit is %limit.',
  'nesting-depth':
    'Markdown nesting reaches %actual levels and the limit is %limit.',
};

/**
 * A document that exceeds a fixed limit of this package.
 *
 * Every public entry point throws it, so a caller has one error to handle. It
 * carries the limit and the measured value, so a message can be specific.
 */
export class MarkdownLimitError extends Error {
  readonly reason: MarkdownLimitReason;
  readonly limit: number;
  readonly actual: number;

  constructor(reason: MarkdownLimitReason, limit: number, actual: number) {
    super(
      reasons[reason]
        .replace('%actual', String(actual))
        .replace('%limit', String(limit)),
    );
    this.name = 'MarkdownLimitError';
    this.reason = reason;
    this.limit = limit;
    this.actual = actual;
  }
}

/** Throws when `actual` is above `limit`. */
function assertAtMost(
  reason: MarkdownLimitReason,
  limit: number,
  actual: number,
): void {
  if (actual > limit) throw new MarkdownLimitError(reason, limit, actual);
}

/**
 * The UTF-8 size of the character at `index`, and 4 for a surrogate pair.
 *
 * The package must run in a browser and in Node, so it cannot use a Node
 * buffer, and it stays independent of the DOM type library.
 */
function byteSizeAt(text: string, index: number): number {
  const code = text.charCodeAt(index);
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
    const next = text.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return 4;
  }
  return 3;
}

/** Counts the UTF-8 bytes of `text`. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const size = byteSizeAt(text, index);
    bytes += size;
    if (size === 4) index += 1;
  }
  return bytes;
}

/** A line marker that opens a bullet list item. */
const bulletMarkers = new Set(['-', '+', '*']);

/** Reports whether the character at `index` is a space or a tab. */
function isSpace(source: string, index: number): boolean {
  const char = source[index];
  return char === ' ' || char === '\t';
}

/** Reports whether the character at `index` is an ASCII digit. */
function isDigit(source: string, index: number): boolean {
  const code = source.charCodeAt(index);
  return code >= 0x30 && code <= 0x39;
}

/**
 * Checks the block nesting that one line opens.
 *
 * The scan reads the line prefix the way the parser does: white space, block
 * quote markers, and list markers, in any order, until ordinary content
 * starts. Every block quote marker, every list marker, and every group of
 * indentation columns is one level.
 */
function assertLineNesting(source: string, from: number, to: number): void {
  let index = from;
  let levels = 0;
  let columns = 0;
  while (index < to) {
    const char = source[index];
    if (char === ' ') {
      columns += 1;
      index += 1;
      continue;
    }
    if (char === '\t') {
      columns += columnsPerLevel;
      index += 1;
      continue;
    }
    if (char === '>') {
      levels += 1;
      assertAtMost('nesting-depth', markdownLimits.maxNestingDepth, levels);
      columns = 0;
      index += 1;
      continue;
    }
    if (
      char !== undefined &&
      bulletMarkers.has(char) &&
      index + 1 < to &&
      isSpace(source, index + 1)
    ) {
      levels += 1;
      assertAtMost('nesting-depth', markdownLimits.maxNestingDepth, levels);
      columns = 0;
      index += 1;
      continue;
    }
    let digits = index;
    while (digits < to && isDigit(source, digits)) digits += 1;
    const ordered = source[digits];
    if (
      digits > index &&
      (ordered === '.' || ordered === ')') &&
      digits + 1 < to &&
      isSpace(source, digits + 1)
    ) {
      levels += 1;
      assertAtMost('nesting-depth', markdownLimits.maxNestingDepth, levels);
      columns = 0;
      index = digits + 1;
      continue;
    }
    break;
  }
  assertAtMost(
    'nesting-depth',
    markdownLimits.maxNestingDepth,
    levels + Math.floor(columns / columnsPerLevel),
  );
}

/**
 * Rejects a document that is too large or that opens too much nesting.
 *
 * Runs before any parse. The size is measured first, then one pass reads the
 * prefix of each line. A line that opens more nesting than the limit is
 * refused as soon as it is read, so a million block quote markers cost one
 * hundred comparisons rather than a parse that never ends.
 */
export function assertParseLimits(source: string): void {
  assertAtMost(
    'input-size',
    markdownLimits.maxInputBytes,
    utf8ByteLength(source),
  );
  let lineStart = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char !== '\n' && char !== '\r') continue;
    assertLineNesting(source, lineStart, index);
    lineStart = index + 1;
  }
  assertLineNesting(source, lineStart, source.length);
}

/**
 * Whether a document passes the checks that run before a parse.
 *
 * A surface that offers an action on the parse of a note, such as the copy
 * of a code block, asks this first, so it offers no action that the parse
 * would refuse. A tree that a parse finds too deep is refused after the
 * parse, so the action keeps its own path for that refusal.
 */
export function withinParseLimits(source: string): boolean {
  try {
    assertParseLimits(source);
    return true;
  } catch (error) {
    if (error instanceof MarkdownLimitError) return false;
    throw error;
  }
}

/** A tree node that may hold children, in mdast or in hast. */
type TreeNode = {
  readonly type: string;
  readonly children?: readonly TreeNode[];
};

/**
 * Node types that add no level of their own.
 *
 * A list and its items are one level to an author, but two nodes in the tree:
 * `list` holds `listItem`. Counting the item and not the list makes one
 * written level count once, so a list and a block quote cost the same.
 */
const transparentNodes = new Set(['list']);

/**
 * Rejects a parsed tree that is nested deeper than the limit.
 *
 * The pre-scan bounds the nesting one line can open, and this bounds what a
 * whole document can build, including inline nesting such as repeated
 * emphasis. The count is in written levels: the root is level zero, a `list`
 * wrapper adds nothing, and the leaf block with its text is subtracted, so one
 * hundred nested block quotes and one hundred nested list items both report
 * one hundred. The walk is iterative on purpose: a recursive check would
 * itself run out of stack on the trees this guard exists to refuse.
 */
export function assertNestingDepth(tree: TreeNode): void {
  let deepest = 0;
  const pending: Array<{ node: TreeNode; level: number }> = [
    { node: tree, level: 0 },
  ];
  let item = pending.pop();
  while (item !== undefined) {
    if (item.level > deepest) deepest = item.level;
    // Stop one level past the point where the limit is already exceeded. The
    // bound includes the levels subtracted below, otherwise the walk would
    // stop before it can report a document that is too deep.
    if (item.level <= markdownLimits.maxNestingDepth + documentDepth)
      for (const child of item.node.children ?? [])
        pending.push({
          node: child,
          level: item.level + (transparentNodes.has(child.type) ? 0 : 1),
        });
    item = pending.pop();
  }
  assertAtMost(
    'nesting-depth',
    markdownLimits.maxNestingDepth,
    Math.max(0, deepest - documentDepth),
  );
}
