/**
 * The resource limits of Markdown work (record 0186).
 *
 * A workspace has members, sign-up can be open, and a note can be published,
 * so the person who writes a note is not always the person whose server or
 * device parses it. Every limit here keeps the work of one parse in
 * proportion to the size of the note, so no note of any shape holds a server
 * worker or a tab for long.
 *
 * There are four limits:
 *
 * - The size of the document. The parser is fast on prose, and one mebibyte
 *   is far above any note a person writes.
 * - The nesting depth. Nesting is the one shape that can stop the parser
 *   rather than slow it down, so it is checked twice: on the line prefixes
 *   before the parse, because a line of a million `>` characters must never
 *   reach the parser, and on the tree after the parse, which also covers
 *   inline nesting such as repeated emphasis. The HTML that the author wrote
 *   is one node of that tree, so its own nesting is measured as well.
 * - The marks of one inline block. micromark matches emphasis, labels,
 *   inline HTML and inline math inside one paragraph, heading or table cell,
 *   and that work grows with the square of the marks of the block.
 * - The table cells of one note. The table extension keeps one list of edits
 *   for the whole document, so its work grows with the square of the cells.
 *
 * Each limit is a count. There is no wall-clock timeout and no cost score. A
 * timeout would bound one render on one machine and would make the outcome
 * depend on the load of that machine, so the same note could render for one
 * reader and fail for another.
 *
 * A refused document is not truncated. The caller catches `MarkdownLimitError`
 * and shows the source as plain text, because cutting a note in half would
 * look like data loss. The server maps the error to a domain failure with a
 * message for the author; see `packages/storage-server/src/markdown-limits.ts`.
 */

import { authorNestingDepth, neutralizeAuthorTags } from './html-elements.ts';

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
  /**
   * Most marks of one inline block: a paragraph, a heading or a table cell.
   *
   * A mark is a character that can open or close an inline construct; see
   * `inlineMarks`. Notes and documentation hold far fewer in one block, and
   * a block at the limit parses in time that grows with its size.
   */
  maxBlockMarks: 128,
  /**
   * Most table cells of one note, counted by `assertLineLimits`.
   *
   * Each line of a table counts its pipes and itself, so the count is never
   * below the cells of the table, and a large table of a note stays far below
   * the limit.
   */
  maxTableCells: 10_000,
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
export type MarkdownLimitReason =
  'input-size' | 'nesting-depth' | 'block-marks' | 'table-cells';

/** The sentence that explains one refusal. */
const reasons: Record<MarkdownLimitReason, string> = {
  'input-size': 'Markdown input is %actual bytes and the limit is %limit.',
  'nesting-depth':
    'Markdown nesting reaches %actual levels and the limit is %limit.',
  'block-marks':
    'One Markdown block holds %actual marks and the limit is %limit.',
  'table-cells': 'Markdown tables reach %actual cells and the limit is %limit.',
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

/** The characters that can open or close an inline construct. */
const markCharacters = new Set(['*', '_', '~', '[', ']', '$', '<']);

/** What one reading of a line counts. */
type LineCounts = {
  /** The marks of the line, as `inlineMarks` counts them. */
  readonly marks: number;
  /** The pipes that are not escaped, each of which can end a table cell. */
  readonly pipes: number;
};

/**
 * Counts the marks and the pipes of `text` from `from` to `to`.
 *
 * A backslash escapes the character after it, so neither is a mark, except
 * `\(` and `\)`, which open and close inline math (`./math-parens.ts`). Where
 * micromark reads a backslash as a plain character, in code, in an address
 * or in math, the character after it is plain as well, so the count is
 * never below the marks that micromark matches.
 */
function countLine(text: string, from: number, to: number): LineCounts {
  let marks = 0;
  let pipes = 0;
  for (let index = from; index < to; index += 1) {
    const char = text[index];
    if (char === '\\') {
      const next = text[index + 1];
      if (index + 1 < to && (next === '(' || next === ')')) marks += 1;
      index += 1;
      continue;
    }
    if (char === '|') pipes += 1;
    else if (char !== undefined && markCharacters.has(char)) marks += 1;
  }
  return { marks, pipes };
}

/**
 * The marks of `text`: the characters that can open or close an inline
 * construct, which are `*`, `_`, `~`, `[`, `]`, `$` and `<`, and the pairs
 * `\(` and `\)`. An escaped character is no mark.
 */
export function inlineMarks(text: string, from = 0, to = text.length): number {
  return countLine(text, from, to).marks;
}

/** Whether a line holds only spaces and tabs. */
function isBlank(line: string): boolean {
  for (const char of line) if (char !== ' ' && char !== '\t') return false;
  return true;
}

/** The index after the block quote markers and the white space of a line. */
function afterQuotes(line: string): number {
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char !== ' ' && char !== '\t' && char !== '>') break;
    index += 1;
  }
  return index;
}

/** The index after one list marker and its space at `from`, or `from`. */
function afterListMarker(line: string, from: number): number {
  let index = from;
  const char = line[index];
  if (char !== undefined && bulletMarkers.has(char)) index += 1;
  else {
    while (index < line.length && isDigit(line, index)) index += 1;
    if (index === from || (line[index] !== '.' && line[index] !== ')'))
      return from;
    index += 1;
  }
  if (index < line.length && !isSpace(line, index)) return from;
  while (index < line.length && isSpace(line, index)) index += 1;
  return index;
}

/** Whether the rest of a line from `from` holds only a delimiter row. */
function delimiterFrom(line: string, from: number): boolean {
  let dash = false;
  for (let index = from; index < line.length; index += 1) {
    const char = line[index];
    if (char === '-') dash = true;
    else if (char !== '|' && char !== ':' && char !== ' ' && char !== '\t')
      return false;
  }
  return dash;
}

/**
 * Whether a line can be the delimiter row of a table.
 *
 * A GFM delimiter row holds only pipes, dashes, colons and white space after
 * its container markers. The test is wider than the rule, so it never misses
 * a row that micromark reads as one.
 */
function delimiterLike(line: string): boolean {
  const content = afterQuotes(line);
  return (
    delimiterFrom(line, content) ||
    delimiterFrom(line, afterListMarker(line, content))
  );
}

/** What one reading of the lines of a note measures. */
export type LineMeasure = {
  /** The most marks of one part of the note between two blank lines. */
  readonly partMarks: number;
  /** The table cells of the note, never below the cells of its tables. */
  readonly tableCells: number;
};

/**
 * Measures the lines of a note in one reading, before any parse.
 *
 * Each line is read once: its size, the nesting that its prefix opens, its
 * marks and its table cells. A line ends at `\n`, at `\r\n` or at `\r`, as
 * micromark and CodeMirror end it. Throws `MarkdownLimitError` as soon as the
 * size or the nesting of a line is over its limit.
 *
 * - A part of the note between two blank lines holds every inline block in
 *   it, because no paragraph, heading or table cell reaches past a blank
 *   line. The marks of a part are never below the marks of a block in it.
 * - A table starts at a delimiter row, ends at a blank line, and its header
 *   is the line above the delimiter row. From that header to the next blank
 *   line, each line counts its pipes and itself, which is never below its
 *   cells.
 */
export function measureLines(lines: Iterable<string>): LineMeasure {
  let bytes = 0;
  let first = true;
  let marks = 0;
  let partMarks = 0;
  let tableCells = 0;
  let inTable = false;
  // The counts of the line above, when it is in the same part.
  let above: LineCounts | null = null;
  for (const line of lines) {
    bytes += utf8ByteLength(line) + (first ? 0 : 1);
    first = false;
    assertAtMost('input-size', markdownLimits.maxInputBytes, bytes);
    assertLineNesting(line, 0, line.length);
    if (isBlank(line)) {
      marks = 0;
      inTable = false;
      above = null;
      continue;
    }
    const counts = countLine(line, 0, line.length);
    marks += counts.marks;
    if (marks > partMarks) partMarks = marks;
    if (
      !inTable &&
      delimiterLike(line) &&
      (counts.pipes > 0 || (above !== null && above.pipes > 0))
    ) {
      inTable = true;
      if (above !== null) tableCells += above.pipes + 1;
    }
    if (inTable) tableCells += counts.pipes + 1;
    above = counts;
  }
  return { partMarks, tableCells };
}

/**
 * Checks the limits that one reading of the lines decides.
 *
 * Throws `MarkdownLimitError`. Answers whether a part holds more marks than
 * `maxBlockMarks`, in which case only a parse of the blocks can tell whether
 * one block does (`parse.ts`). A part within the limit holds no block above
 * it.
 */
export function assertLineLimits(lines: Iterable<string>): boolean {
  const measured = measureLines(lines);
  assertAtMost(
    'table-cells',
    markdownLimits.maxTableCells,
    measured.tableCells,
  );
  return measured.partMarks > markdownLimits.maxBlockMarks;
}

/** The lines of a text, split as micromark splits them. */
export function* linesOf(source: string): Generator<string> {
  let lineStart = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char !== '\n' && char !== '\r') continue;
    yield source.slice(lineStart, index);
    if (char === '\r' && source[index + 1] === '\n') index += 1;
    lineStart = index + 1;
  }
  yield source.slice(lineStart);
}

/**
 * Rejects a document that the reading of its lines refuses.
 *
 * Runs before any parse. The size is measured first, then one pass reads
 * each line. A line that opens more nesting than the limit is refused as
 * soon as it is read, so a million block quote markers cost one hundred
 * comparisons rather than a parse that never ends. Answers whether the
 * blocks need the check of `assertBlockMarks`.
 */
export function assertParseLimits(source: string): boolean {
  assertAtMost(
    'input-size',
    markdownLimits.maxInputBytes,
    utf8ByteLength(source),
  );
  return assertLineLimits(linesOf(source));
}

/** A node of a parsed tree with its source offsets. */
type PlacedNode = {
  readonly type: string;
  readonly position?:
    | {
        readonly start: { readonly offset?: number | undefined };
        readonly end: { readonly offset?: number | undefined };
      }
    | undefined;
  readonly children?: readonly PlacedNode[];
};

/** The nodes whose content micromark reads as one inline block. */
const inlineBlocks = new Set(['paragraph', 'heading', 'tableCell']);

/**
 * Rejects a tree with an inline block of more marks than the limit.
 *
 * The tree is the parse of the blocks alone that `parse.ts` makes, so each
 * paragraph, heading and table cell is exactly the inline block of the one
 * grammar. `source` is the text that the parser read, after a byte order
 * mark. The walk is iterative, as in `assertNestingDepth`.
 */
export function assertBlockMarks(tree: PlacedNode, source: string): void {
  const pending: PlacedNode[] = [tree];
  let node = pending.pop();
  while (node !== undefined) {
    if (inlineBlocks.has(node.type)) {
      const from = node.position?.start.offset ?? 0;
      const to = node.position?.end.offset ?? from;
      assertAtMost(
        'block-marks',
        markdownLimits.maxBlockMarks,
        inlineMarks(source, from, to),
      );
    } else for (const child of node.children ?? []) pending.push(child);
    node = pending.pop();
  }
}

/** A tree node that may hold children or a value, in mdast or in hast. */
type TreeNode = {
  readonly type: string;
  readonly value?: unknown;
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

/**
 * Rejects a parsed tree whose author HTML nests deeper than the limit.
 *
 * An HTML block is one node of the Markdown tree, so `assertNestingDepth`
 * never sees the elements inside it. Every reader of that HTML parses it
 * with `hast-util-raw` and recurses on the result: the renderer of
 * `./render.ts` and the plain text of `./plain-text.ts`. The depth is
 * measured here, once, over the HTML of the whole note in document order and
 * with each neutral tag written as text, which is how both readers read it
 * (record 0157). `parseMarkdown` runs this check, so every entry point
 * refuses the same notes with the same error, and no reader recurses deeper
 * than the limit. The walk is iterative for the reason that
 * `assertNestingDepth` states.
 */
export function assertAuthorHtmlDepth(tree: TreeNode): void {
  const values: string[] = [];
  const pending: TreeNode[] = [tree];
  let node = pending.pop();
  while (node !== undefined) {
    if (node.type === 'html' && typeof node.value === 'string')
      values.push(neutralizeAuthorTags(node.value));
    // The children go on the stack last first, so they leave it in document
    // order, which the count of opening and closing tags needs.
    for (const child of node.children?.toReversed() ?? []) pending.push(child);
    node = pending.pop();
  }
  if (values.length === 0) return;
  assertAtMost(
    'nesting-depth',
    markdownLimits.maxNestingDepth,
    authorNestingDepth(values),
  );
}
