/**
 * Bounded line comparison for the history and conflict screens.
 *
 * The comparison runs on jsdiff's line differ with a 10,000-edit bound, so a
 * pathological pair of texts resolves to a limit instead of blocking the
 * caller. Whitespace and line endings stay significant: lines are compared
 * exactly as stored, `\r\n` is not equal to `\n`, and a missing final newline
 * is a change. No normalization, trimming, or case folding happens here.
 *
 * A line keeps its terminator inside a hunk (`'text\n'`, `'text\r\n'`, or a
 * bare `'\n'`), except for a final line without one. Joining the lines of one
 * side therefore reproduces that side exactly, which is what the merge helper
 * below relies on.
 *
 * Hunk positions are 1-based line numbers. Each hunk covers one maximal run
 * of changed lines plus up to three context lines on each side, in the style
 * of a unified diff. Two changed runs separated by more than six unchanged
 * lines become two hunks.
 *
 * This module knows text only. It never imports endpoints, storage, or the
 * generated API client.
 */
import { diffArrays, type ArrayChange } from 'diff';

/** The largest edit distance the comparison explores before giving up. */
export const maxDiffEdits = 10_000;

/**
 * The largest trimmed middle, in lines on both sides together, that the
 * comparison hands to jsdiff.
 *
 * Common prefix and suffix lines are removed before the comparison, so a
 * large file with a small change never reaches the differ. The remaining
 * middle holds the changed region; handing more than this many lines to the
 * differ risks seconds of work and gigabytes of retained paths instead of an
 * early abort, so a larger middle resolves to a limit. A rewrite of this size
 * is served better by whole-version selection than by hunk picking.
 */
export const maxDiffMiddleLines = 4_000;

/** The context lines kept on each side of a changed run. */
export const diffContextLines = 3;

/** One changed region with its surrounding context. */
export type DiffHunk = {
  /** The before lines of the hunk range, context included. */
  readonly before: readonly string[];
  /** The after lines of the hunk range, context included. */
  readonly after: readonly string[];
  /** The 1-based line number where the hunk starts in the before text. */
  readonly beforeStart: number;
  /** The 1-based line number where the hunk starts in the after text. */
  readonly afterStart: number;
};

/** The outcome of comparing two texts line by line. */
export type DiffResult =
  | { readonly kind: 'complete'; readonly hunks: readonly DiffHunk[] }
  | { readonly kind: 'limit' };

/** How one hunk contributes to a merged result. */
export type HunkDecision =
  | { readonly take: 'before' }
  | { readonly take: 'after' }
  | { readonly take: 'custom'; readonly text: string };

/** Splits text into lines that keep their terminators. */
const linePattern = /[^\r\n]*(?:\r\n|\r|\n)?/g;

/**
 * Splits text into lines without losing information.
 *
 * Every line keeps its `\n`, `\r\n`, or `\r` terminator, except for a final
 * line that has none. An empty text yields no lines. Joining the result with
 * `''` reproduces the input exactly.
 */
function splitLines(text: string): string[] {
  if (text === '') return [];
  return (text.match(linePattern) ?? []).filter((line) => line !== '');
}

/** One aligned line pair position of the comparison. */
type LineOp = {
  readonly kind: 'same' | 'del' | 'add';
  readonly beforeIndex: number | null;
  readonly afterIndex: number | null;
};

/** One aligned line of a two-text comparison, without hunk grouping. */
export type AlignedLine =
  | {
      readonly kind: 'same';
      readonly beforeIndex: number;
      readonly afterIndex: number;
    }
  | { readonly kind: 'del'; readonly beforeIndex: number }
  | { readonly kind: 'add'; readonly afterIndex: number };

/**
 * Runs the bounded differ over two line arrays.
 *
 * Returns null when the input is too large or the edit distance passes the
 * bound, so callers show a limit instead of blocking.
 */
function diffLineOps(
  beforeLines: readonly string[],
  afterLines: readonly string[],
): LineOp[] | null {
  if (beforeLines.length + afterLines.length > maxDiffMiddleLines) return null;
  const changes: readonly ArrayChange<string>[] | undefined = diffArrays(
    [...beforeLines],
    [...afterLines],
    { maxEditLength: maxDiffEdits, oneChangePerToken: true },
  );
  if (changes === undefined) return null;
  const ops: LineOp[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  for (const change of changes) {
    const count = change.count ?? 0;
    if (change.added === true) {
      for (let i = 0; i < count; i += 1) {
        ops.push({ kind: 'add', beforeIndex: null, afterIndex });
        afterIndex += 1;
      }
    } else if (change.removed === true) {
      for (let i = 0; i < count; i += 1) {
        ops.push({ kind: 'del', beforeIndex, afterIndex: null });
        beforeIndex += 1;
      }
    } else {
      for (let i = 0; i < count; i += 1) {
        ops.push({ kind: 'same', beforeIndex, afterIndex });
        beforeIndex += 1;
        afterIndex += 1;
      }
    }
  }
  return ops;
}

/**
 * Compares two texts line by line.
 *
 * Common prefix and suffix lines are trimmed first, so a large file with a
 * small change compares quickly. Returns every hunk on success, or a limit
 * when the trimmed middle passes {@link maxDiffMiddleLines} or the edit
 * distance passes {@link maxDiffEdits}. Identical texts yield no hunks.
 */
export function compareLines(before: string, after: string): DiffResult {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  let commonPrefix = 0;
  while (
    commonPrefix < beforeLines.length &&
    commonPrefix < afterLines.length &&
    beforeLines[commonPrefix] === afterLines[commonPrefix]
  )
    commonPrefix += 1;
  let beforeEnd = beforeLines.length;
  let afterEnd = afterLines.length;
  while (
    beforeEnd > commonPrefix &&
    afterEnd > commonPrefix &&
    beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const middleBefore = beforeLines.slice(commonPrefix, beforeEnd);
  const middleAfter = afterLines.slice(commonPrefix, afterEnd);
  if (middleBefore.length === 0 && middleAfter.length === 0)
    return { kind: 'complete', hunks: [] };
  const ops = diffLineOps(middleBefore, middleAfter);
  if (ops === null) return { kind: 'limit' };

  // The before lines consumed before each op position, for hunk starts.
  const beforePrefix: number[] = [0];
  const afterPrefix: number[] = [0];
  for (const op of ops) {
    const lastBefore = beforePrefix[beforePrefix.length - 1] ?? 0;
    const lastAfter = afterPrefix[afterPrefix.length - 1] ?? 0;
    beforePrefix.push(lastBefore + (op.beforeIndex === null ? 0 : 1));
    afterPrefix.push(lastAfter + (op.afterIndex === null ? 0 : 1));
  }

  // Group changed ops that share context: runs separated by more than twice
  // the context stay apart, the rest merge into one hunk. Context itself is
  // added from the full texts below, so it can reach into the trimmed prefix
  // and suffix as well.
  const groups: Array<{ readonly start: number; readonly end: number }> = [];
  let groupStart: number | null = null;
  let lastChange = -1;
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];
    if (op === undefined || op.kind === 'same') continue;
    if (groupStart === null || index - lastChange - 1 > diffContextLines * 2) {
      if (groupStart !== null)
        groups.push({ start: groupStart, end: lastChange + 1 });
      groupStart = index;
    }
    lastChange = index;
  }
  if (groupStart !== null)
    groups.push({ start: groupStart, end: lastChange + 1 });

  // Separate hunks always have at least seven unchanged middle lines between
  // them, so extending each side by three lines can never overlap a neighbor.
  const hunks: DiffHunk[] = groups.map((group) => {
    const changedBeforeStart = commonPrefix + (beforePrefix[group.start] ?? 0);
    const changedBeforeEnd = commonPrefix + (beforePrefix[group.end] ?? 0);
    const changedAfterStart = commonPrefix + (afterPrefix[group.start] ?? 0);
    const changedAfterEnd = commonPrefix + (afterPrefix[group.end] ?? 0);
    const lead = Math.min(
      diffContextLines,
      changedBeforeStart,
      changedAfterStart,
    );
    const tail = Math.min(
      diffContextLines,
      beforeLines.length - changedBeforeEnd,
      afterLines.length - changedAfterEnd,
    );
    return {
      before: beforeLines.slice(
        changedBeforeStart - lead,
        changedBeforeEnd + tail,
      ),
      after: afterLines.slice(changedAfterStart - lead, changedAfterEnd + tail),
      beforeStart: changedBeforeStart - lead + 1,
      afterStart: changedAfterStart - lead + 1,
    };
  });
  return { kind: 'complete', hunks };
}

/**
 * Aligns two texts line by line without grouping into hunks.
 *
 * Each entry names the exact line positions on its sides, so an inline view
 * can mark context, removals, and additions precisely, including unchanged
 * lines inside a changed region. Returns null under the same bounds as
 * {@link compareLines}.
 */
export function alignLines(
  before: string,
  after: string,
): readonly AlignedLine[] | null {
  const ops = diffLineOps(splitLines(before), splitLines(after));
  if (ops === null) return null;
  const aligned: AlignedLine[] = [];
  for (const op of ops) {
    if (op.kind === 'same' && op.beforeIndex !== null && op.afterIndex !== null)
      aligned.push({
        kind: 'same',
        beforeIndex: op.beforeIndex,
        afterIndex: op.afterIndex,
      });
    else if (op.kind === 'del' && op.beforeIndex !== null)
      aligned.push({ kind: 'del', beforeIndex: op.beforeIndex });
    else if (op.kind === 'add' && op.afterIndex !== null)
      aligned.push({ kind: 'add', afterIndex: op.afterIndex });
    else return null;
  }
  return aligned;
}

/**
 * Merges one decision per hunk back into a single text.
 *
 * Lines outside every hunk are identical on both sides and are taken from the
 * before text. A `before` decision emits the hunk's before lines, an `after`
 * decision emits its after lines, and a `custom` decision emits the supplied
 * replacement text split into lines. Choosing `before` for every hunk
 * reproduces the before text exactly; choosing `after` reproduces the after
 * text.
 *
 * Throws when the decisions do not name exactly one choice per hunk.
 */
export function mergeHunks(
  before: string,
  after: string,
  hunks: readonly DiffHunk[],
  decisions: readonly HunkDecision[],
): string {
  if (decisions.length !== hunks.length)
    throw new Error(
      `notesapp diff: ${String(decisions.length)} decisions cannot cover ${String(hunks.length)} hunks`,
    );
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const out: string[] = [];
  // The before coordinates already emitted, as a count of lines.
  let emittedBefore = 0;
  // The after coordinates already emitted, as a count of lines.
  let emittedAfter = 0;
  for (let index = 0; index < hunks.length; index += 1) {
    const hunk = hunks[index];
    const decision = decisions[index];
    if (hunk === undefined || decision === undefined)
      throw new Error('notesapp diff: a hunk or decision is missing');
    const beforeFrom = hunk.beforeStart - 1;
    const afterFrom = hunk.afterStart - 1;
    if (beforeFrom < emittedBefore || afterFrom < emittedAfter)
      throw new Error('notesapp diff: hunks must be ordered and disjoint');
    const gapBefore = beforeLines.slice(emittedBefore, beforeFrom);
    const gapAfter = afterLines.slice(emittedAfter, afterFrom);
    const gapMatches =
      gapBefore.length === gapAfter.length &&
      gapBefore.every((line, offset) => line === gapAfter[offset]);
    if (!gapMatches)
      throw new Error('notesapp diff: a hunk gap differs between versions');
    out.push(...gapBefore);
    if (decision.take === 'before') out.push(...hunk.before);
    else if (decision.take === 'after') out.push(...hunk.after);
    else out.push(...splitLines(decision.text));
    emittedBefore = beforeFrom + hunk.before.length;
    emittedAfter = afterFrom + hunk.after.length;
  }
  const tailBefore = beforeLines.slice(emittedBefore);
  const tailAfter = afterLines.slice(emittedAfter);
  const tailMatches =
    tailBefore.length === tailAfter.length &&
    tailBefore.every((line, offset) => line === tailAfter[offset]);
  if (!tailMatches)
    throw new Error('notesapp diff: a hunk gap differs between versions');
  out.push(...tailBefore);
  return out.join('');
}
