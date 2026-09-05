/**
 * Fixed resource limits for Markdown work.
 *
 * A note is untrusted input. The parser this package uses is fast on ordinary
 * documents, but several of its constructs cost time that grows faster than
 * the document does. A document of 80 KB built only from `[` and `]` takes
 * many seconds, and a line of one million `>` characters does not finish at
 * all. A byte cap alone therefore does not bound the work.
 *
 * The answer is a pre-scan that runs before any parse, in every public entry
 * point of this package. It is a single pass over the text, so it costs a few
 * milliseconds on the largest accepted document, and it rejects the shapes
 * that make the parser slow: an over-long delimiter run, an over-long line,
 * deep block nesting on one line, and a document made almost entirely of link
 * openings. Ordinary prose, lists, tables, and code stay far inside every
 * limit.
 *
 * A rejected document is not truncated. The caller catches the error and shows
 * the source as plain text, because cutting a note in half would look like
 * data loss.
 */

/** The fixed resource limits of this package. */
export const markdownLimits = {
  /**
   * Largest accepted document, in UTF-8 bytes.
   *
   * The design budgets typical notes of 5 to 20 KiB and a 1 MiB stress file,
   * so this leaves headroom while keeping one render bounded.
   */
  maxInputBytes: 2 * 1024 * 1024,
  /**
   * Longest accepted line, in UTF-8 bytes.
   *
   * Several parser constructs scan a line repeatedly. A real line of prose,
   * a table row, and a minified line of code all stay well below this.
   */
  maxLineBytes: 64 * 1024,
  /**
   * Longest accepted run of one delimiter character.
   *
   * A run of thousands of identical delimiters is the cheapest way to make
   * the parser do work that grows faster than the input. No real document
   * needs a thousand identical delimiters in a row.
   */
  maxDelimiterRun: 1000,
  /**
   * Deepest accepted block nesting, measured before parsing and again on the
   * parsed tree.
   *
   * Before parsing this counts the block quote markers, the list markers, and
   * the indentation levels at the start of one line. After parsing it is the
   * depth of the tree. Real documents stay far below it.
   */
  maxNestingDepth: 100,
  /**
   * Largest accepted number of link openings in one document.
   *
   * Every `[` and `![` starts a candidate the parser must keep until it can
   * decide. A document of 10,000 links is already far past what a note holds.
   */
  maxLinkOpenings: 20000,
} as const;

/**
 * Columns of leading white space that count as one nesting level.
 *
 * CommonMark allows at most four columns of indentation before a block becomes
 * indented code, so four columns is the widest one list level can be.
 */
const columnsPerLevel = 4;

/** Why a document was refused. */
export type MarkdownLimitReason =
  | 'input-size'
  | 'line-length'
  | 'delimiter-run'
  | 'nesting-depth'
  | 'link-count';

/** The sentence that explains one refusal. */
const reasons: Record<MarkdownLimitReason, string> = {
  'input-size': 'Markdown input is %actual bytes and the limit is %limit.',
  'line-length': 'A Markdown line is %actual bytes and the limit is %limit.',
  'delimiter-run':
    'A Markdown delimiter repeats %actual times and the limit is %limit.',
  'nesting-depth':
    'Markdown nesting reaches %actual levels and the limit is %limit.',
  'link-count': 'Markdown holds %actual link openings and the limit is %limit.',
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

/** The delimiter characters whose repetition drives parser cost. */
const delimiters = new Set([
  '[',
  ']',
  '*',
  '_',
  '`',
  '~',
  '>',
  '#',
  '-',
  '+',
  '=',
  '|',
  '$',
  '!',
  '(',
  ')',
  '<',
]);

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
 * Rejects a document whose shape makes parsing cost more than its size.
 *
 * Runs before any parse. The checks are, in order: total bytes, then one pass
 * that measures each line, each delimiter run, and the number of link
 * openings. The first failure wins, so a hostile document is refused after a
 * few thousand characters rather than after the whole file.
 */
export function assertParseCost(source: string): void {
  assertAtMost(
    'input-size',
    markdownLimits.maxInputBytes,
    utf8ByteLength(source),
  );
  let lineStart = 0;
  let lineBytes = 0;
  let linkOpenings = 0;
  let runChar = '';
  let runLength = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (char === '\n' || char === '\r') {
      assertAtMost('line-length', markdownLimits.maxLineBytes, lineBytes);
      assertLineNesting(source, lineStart, index);
      lineStart = index + 1;
      lineBytes = 0;
      runChar = '';
      runLength = 0;
      continue;
    }
    const size = byteSizeAt(source, index);
    lineBytes += size;
    if (size === 4) index += 1;
    if (char === runChar) runLength += 1;
    else {
      runChar = char;
      runLength = 1;
    }
    if (delimiters.has(char))
      assertAtMost('delimiter-run', markdownLimits.maxDelimiterRun, runLength);
    if (char === '[') {
      linkOpenings += 1;
      assertAtMost('link-count', markdownLimits.maxLinkOpenings, linkOpenings);
    }
  }
  assertAtMost('line-length', markdownLimits.maxLineBytes, lineBytes);
  assertLineNesting(source, lineStart, source.length);
}

/** A tree node that may hold children, in mdast or in hast. */
type TreeNode = {
  readonly type: string;
  readonly children?: readonly TreeNode[];
};

/**
 * Rejects a parsed tree that is nested deeper than the limit.
 *
 * The pre-scan bounds the nesting one line can open, and this bounds what a
 * whole document can build, including inline nesting such as repeated
 * emphasis. The walk is iterative on purpose: a recursive check would itself
 * run out of stack on the trees this guard exists to refuse.
 */
export function assertNestingDepth(tree: TreeNode): void {
  let deepest = 0;
  const pending: Array<{ node: TreeNode; depth: number }> = [
    { node: tree, depth: 1 },
  ];
  let item = pending.pop();
  while (item !== undefined) {
    if (item.depth > deepest) deepest = item.depth;
    if (item.depth <= markdownLimits.maxNestingDepth)
      for (const child of item.node.children ?? [])
        pending.push({ node: child, depth: item.depth + 1 });
    item = pending.pop();
  }
  assertAtMost('nesting-depth', markdownLimits.maxNestingDepth, deepest);
}
