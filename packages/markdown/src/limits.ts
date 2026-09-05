/**
 * Fixed resource limits for Markdown work.
 *
 * A note is untrusted input. The parser this package uses is fast on ordinary
 * prose, but several of its constructs cost time that grows faster than the
 * document does. Measured before these limits existed: 80 KB of `[` and `]`
 * took 16 seconds, a 220 KB table took 83 seconds, a line of one million `>`
 * characters never finished, one megabyte of prose written as a single
 * paragraph took 12 seconds, 250 KB of tiny headings took 2.7 seconds, and
 * 64 KiB of dense emphasis took 2.2 seconds. A byte cap alone therefore does
 * not bound the work.
 *
 * The answer is a pre-scan that runs before any parse, in every public entry
 * point of this package. It is a single pass over the text, so it costs a few
 * milliseconds on the largest accepted document, and it caps every shape whose
 * cost grows faster than its size: the size of the document, the size of a
 * line, the size of one plain block, the length of a delimiter run, the
 * nesting one line opens, the number of inline delimiters in a block and in
 * the document, and the number of link openings, table rows, list lines, and
 * blocks.
 *
 * There is no wall-clock timeout anywhere in this package. A timeout would
 * bound one render on one machine and would make the outcome depend on the
 * load of that machine, so the same note could render for one reader and fail
 * for another. The shape caps are the bound instead: every accepted document
 * has a measured worst case, and the numbers are recorded in
 * `docs/development/toolchain.md` and asserted in `limits.test.ts`.
 *
 * The scan recognizes one Markdown construct: a fenced code block. It does so
 * only to exempt the two plain block caps, because the parser never reads the
 * content of a fence as inline text, so a long fence is cheap. Every other cap
 * keeps counting inside a fence: a line of code is still a line, a `|` line
 * inside a fence is still a table row, a bullet inside a fence is still a list
 * line, and the fence is still one block. An opening fence therefore cannot
 * turn a cap off for the rest of the document. The scan also refuses to read
 * a backtick fence whose info string holds a backtick, because CommonMark
 * calls that a paragraph rather than a fence.
 *
 * A rejected document is not truncated. The caller catches `MarkdownLimitError`
 * and shows the source as plain text, because cutting a note in half would look
 * like data loss. The message on the error names the limit in technical terms;
 * a caller that shows it to an author should phrase it for that author, for
 * example "this note has more table rows than the editor can display" with the
 * limit from `markdownLimits`.
 */

/**
 * The fixed resource limits of this package.
 *
 * Every value is calibrated by measurement, not chosen by feel. The test
 * `limits.test.ts` builds each capped shape at exactly its cap and asserts
 * that it renders inside the budget, so a change to a value here shows up as
 * a failed measurement rather than as a slow page.
 */
export const markdownLimits = {
  /**
   * Largest accepted document, in UTF-8 bytes.
   *
   * The design budgets typical notes of 5 to 20 KiB and a 1 MiB stress file,
   * so this is the stress file size and nothing more.
   */
  maxInputBytes: 1024 * 1024,
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
   * Deepest accepted nesting written by an author.
   *
   * Before parsing this counts the block quote markers, the list markers, and
   * the indentation levels at the start of one line. After parsing it is the
   * depth of the tree, less the levels every document has. Real documents stay
   * far below it.
   */
  maxNestingDepth: 100,
  /**
   * Largest accepted number of link openings in one document.
   *
   * Every `[` and `![` starts a candidate the parser must keep until it can
   * decide, and the cost of resolving them grows faster than their number.
   */
  maxLinkOpenings: 2000,
  /**
   * Largest accepted number of table rows in one document.
   *
   * A table row is a line that starts with `|`. The table parser re-reads the
   * rows it has collected, so a long table costs more than its size suggests.
   */
  maxTableRows: 2000,
  /**
   * Largest accepted number of list lines in one document.
   *
   * A list line is a line that starts with a bullet or an ordered marker. The
   * cost of a list grows a little faster than its length, so this is the
   * measured value rather than a round one: 10,000 lines took between 0.8 and
   * 1.9 seconds depending on the load of the machine, and 5000 stays near a
   * third of a second.
   */
  maxListItems: 5000,
  /**
   * Largest accepted number of inline delimiter characters in one plain block.
   *
   * The parser pairs the inline delimiters of a paragraph against each other,
   * and that cost grows faster than their number. A run of one character is
   * already capped, but alternating characters such as `*_ *_` never form a
   * run, so the count is capped as well. Calibrated by measurement; see
   * `limits.test.ts`.
   */
  maxBlockInlineDelimiters: 2000,
  /**
   * Largest accepted number of inline delimiter characters in one document.
   *
   * The per-block cap alone does not bound a whole document: one megabyte of
   * short paragraphs, each inside the block cap, still costs about four
   * seconds. Measured on the development machine, 100,000 delimiters cost 0.8
   * seconds, 200,000 cost 1.5, and 300,000 cost 2.2. This value keeps the
   * worst case near three quarters of a second, and one megabyte of ordinary
   * prose holds about 47,000, so a real note keeps room to spare.
   */
  maxInlineDelimiters: 100000,
  /**
   * Largest accepted number of blocks in one document.
   *
   * A block is a run of neighbouring lines: one paragraph, one fenced code
   * block, one whole table, or one whole list. Each block carries a fixed
   * setup cost, so a document of tiny blocks costs more than its size
   * suggests: 50,000 of the smallest possible blocks took 2.7 seconds.
   *
   * One megabyte of ordinary prose holds about 7900 paragraphs, so this leaves
   * a real note room to spare. One megabyte spread over this many blocks
   * renders in about 0.75 seconds; over 20,000 it reaches 1.4 seconds inside
   * the test run, which is too close to the budget to be a stable bound.
   */
  maxBlocks: 15000,
  /**
   * Largest accepted plain block, in UTF-8 bytes.
   *
   * A plain block is a run of neighbouring lines that is not blank, not a
   * table row, not a list line, and not inside a code fence: in practice, one
   * paragraph. The parser reads the inline content of a paragraph as one unit,
   * and that cost grows faster than the paragraph does. One megabyte of prose
   * written as one paragraph took 12 seconds; the same text with blank lines
   * between its paragraphs took under a second.
   */
  maxBlockBytes: 64 * 1024,
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
  | 'input-size'
  | 'line-length'
  | 'delimiter-run'
  | 'nesting-depth'
  | 'link-count'
  | 'table-rows'
  | 'list-items'
  | 'block-size'
  | 'block-count'
  | 'inline-delimiters';

/** The sentence that explains one refusal. */
const reasons: Record<MarkdownLimitReason, string> = {
  'input-size': 'Markdown input is %actual bytes and the limit is %limit.',
  'line-length': 'A Markdown line is %actual bytes and the limit is %limit.',
  'delimiter-run':
    'A Markdown delimiter repeats %actual times and the limit is %limit.',
  'nesting-depth':
    'Markdown nesting reaches %actual levels and the limit is %limit.',
  'link-count': 'Markdown holds %actual link openings and the limit is %limit.',
  'table-rows': 'Markdown holds %actual table rows and the limit is %limit.',
  'list-items': 'Markdown holds %actual list lines and the limit is %limit.',
  'block-size':
    'A Markdown paragraph is %actual bytes and the limit is %limit.',
  'block-count': 'Markdown holds %actual blocks and the limit is %limit.',
  'inline-delimiters':
    'A Markdown paragraph holds %actual inline delimiters and the limit is %limit.',
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

/**
 * The characters that can open an inline construct.
 *
 * These are the characters micromark tries to pair inside a paragraph:
 * attention (`*`, `_`, `~`), math (`$`), a code span (`` ` ``), a link or an
 * image (`[`, `]`, `!`), and an autolink or raw span (`<`, `>`). A line marker
 * such as `-` is a block construct and costs nothing to pair, so it is not
 * counted here.
 */
const inlineDelimiters = new Set([
  '*',
  '_',
  '~',
  '$',
  '`',
  '[',
  ']',
  '!',
  '<',
  '>',
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

/** What one line contributes to the structural counts of the document. */
type LineShape = { readonly tableRow: boolean; readonly listItem: boolean };

/**
 * The kind of block a line belongs to.
 *
 * Neighbouring lines of the same kind are one block: a run of table rows is
 * one table, a run of list lines is one list, and a fence is one block from
 * its opener to its closer. A blank line closes whatever was open.
 */
type BlockKind = 'none' | 'plain' | 'table' | 'list' | 'fence';

/** The shortest run of characters that opens or closes a code fence. */
const fenceRun = 3;

/**
 * The fence marker on this line, or `null` when the line carries none.
 *
 * A fence is the one construct the scan recognizes, and it recognizes it only
 * to exempt the plain block cap: a long code fence is cheap to parse because
 * the parser never reads its content as inline text. Every other cap keeps
 * counting inside a fence.
 *
 * CommonMark forbids a backtick in the info string of a backtick fence, so a
 * line such as ```` ```a`b ```` is a paragraph and not a fence. Reading it as
 * a fence here would hand an author a way to turn the block cap off for the
 * rest of the document, so that shape returns no marker.
 */
function fenceMarker(
  source: string,
  from: number,
  to: number,
): { readonly char: string; readonly length: number } | null {
  let index = from;
  while (index < to && index - from < tableRowIndent && source[index] === ' ')
    index += 1;
  const char = source[index];
  if (char !== '`' && char !== '~') return null;
  let length = 0;
  while (index + length < to && source[index + length] === char) length += 1;
  if (length < fenceRun) return null;
  if (char === '`')
    for (let rest = index + length; rest < to; rest += 1)
      if (source[rest] === '`') return null;
  return { char, length };
}

/** Reports whether the line holds nothing but white space. */
function isBlank(source: string, from: number, to: number): boolean {
  for (let index = from; index < to; index += 1)
    if (!isSpace(source, index)) return false;
  return true;
}

/** Columns of indentation a table row may carry before it stops being one. */
const tableRowIndent = 3;

/**
 * Reports whether the line is a table row.
 *
 * A row of a GFM table starts with `|` after at most three spaces. The check
 * runs on the raw line, so a row inside a block quote is not counted; a table
 * that long inside a quote is not a shape this cap has to cover.
 */
function isTableRow(source: string, from: number, to: number): boolean {
  let index = from;
  while (index < to && index - from < tableRowIndent && source[index] === ' ')
    index += 1;
  return source[index] === '|' && index < to;
}

/**
 * Checks the block nesting that one line opens and reports its shape.
 *
 * The scan reads the line prefix the way the parser does: white space, block
 * quote markers, and list markers, in any order, until ordinary content
 * starts. Every block quote marker, every list marker, and every group of
 * indentation columns is one level.
 */
function assertLineNesting(
  source: string,
  from: number,
  to: number,
): LineShape {
  let index = from;
  let levels = 0;
  let columns = 0;
  let listItem = false;
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
      listItem = true;
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
      listItem = true;
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
  return { tableRow: isTableRow(source, from, to), listItem };
}

/**
 * Rejects a document whose shape makes parsing cost more than its size.
 *
 * Runs before any parse. The checks are, in order: total bytes, then one pass
 * that measures each line, each delimiter run, and the number of link
 * openings, table rows, and list lines. Each cap is asserted as soon as it is
 * passed, so a hostile document is refused after a few thousand characters
 * rather than after the whole file.
 */
export function assertParseCost(source: string): void {
  assertAtMost(
    'input-size',
    markdownLimits.maxInputBytes,
    utf8ByteLength(source),
  );
  let lineStart = 0;
  let lineBytes = 0;
  let lineDelimiters = 0;
  let linkOpenings = 0;
  let tableRows = 0;
  let listItems = 0;
  let blocks = 0;
  let blockBytes = 0;
  let blockDelimiters = 0;
  let documentDelimiters = 0;
  let openBlock: BlockKind = 'none';
  let fence: { char: string; length: number } | null = null;
  let runChar = '';
  let runLength = 0;
  /** Opens a block when the previous line did not already open this kind. */
  const openBlockOfKind = (kind: BlockKind): void => {
    if (openBlock !== kind) {
      blocks += 1;
      assertAtMost('block-count', markdownLimits.maxBlocks, blocks);
    }
    openBlock = kind;
  };
  /** Ends the run of plain lines that the block caps measure. */
  const endPlainBlock = (): void => {
    blockBytes = 0;
    blockDelimiters = 0;
  };
  /**
   * Counts what one finished line contributes to the document.
   *
   * A fenced line is exempt from the two plain block caps only. Nesting, table
   * rows, list lines, and the block count all keep counting inside a fence,
   * because a fence opener must never be able to turn a cap off for the rest
   * of the document.
   */
  const finishLine = (end: number): void => {
    assertAtMost('line-length', markdownLimits.maxLineBytes, lineBytes);
    const marker = fenceMarker(source, lineStart, end);
    const wasFenced = fence !== null;
    if (fence === null) {
      if (marker !== null) fence = { char: marker.char, length: marker.length };
    } else if (
      marker !== null &&
      marker.char === fence.char &&
      marker.length >= fence.length
    )
      fence = null;
    const fenced = wasFenced || marker !== null;
    const shape = assertLineNesting(source, lineStart, end);
    if (shape.tableRow) {
      tableRows += 1;
      assertAtMost('table-rows', markdownLimits.maxTableRows, tableRows);
    }
    if (shape.listItem) {
      listItems += 1;
      assertAtMost('list-items', markdownLimits.maxListItems, listItems);
    }
    if (fenced) {
      // The opening line starts one block; the rest of the fence continues it.
      openBlockOfKind('fence');
      endPlainBlock();
      return;
    }
    if (isBlank(source, lineStart, end)) {
      openBlock = 'none';
      endPlainBlock();
      return;
    }
    if (shape.tableRow) {
      openBlockOfKind('table');
      endPlainBlock();
      return;
    }
    if (shape.listItem) {
      openBlockOfKind('list');
      endPlainBlock();
      return;
    }
    openBlockOfKind('plain');
    blockBytes += lineBytes;
    assertAtMost('block-size', markdownLimits.maxBlockBytes, blockBytes);
    blockDelimiters += lineDelimiters;
    assertAtMost(
      'inline-delimiters',
      markdownLimits.maxBlockInlineDelimiters,
      blockDelimiters,
    );
    documentDelimiters += lineDelimiters;
    assertAtMost(
      'inline-delimiters',
      markdownLimits.maxInlineDelimiters,
      documentDelimiters,
    );
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (char === '\n' || char === '\r') {
      finishLine(index);
      lineStart = index + 1;
      lineBytes = 0;
      lineDelimiters = 0;
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
    if (inlineDelimiters.has(char)) lineDelimiters += 1;
    if (char === '[') {
      linkOpenings += 1;
      assertAtMost('link-count', markdownLimits.maxLinkOpenings, linkOpenings);
    }
  }
  finishLine(source.length);
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
