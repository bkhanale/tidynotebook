/**
 * The rows that a line comparison shows a person.
 *
 * History compares a version with the current text and Review compares the
 * text of a save with the note now (records 0087 and 0166). Both read the
 * hunks of `@notesapp/editor`, which keep the terminator of every line, so a
 * line whose only change is its line ending, such as the last line of a note
 * that gained a line after it, came out as removed and added with the same
 * words. A person cannot see a line ending, so this module compares the words
 * of a line and nothing else. The row of a version counts its changes from
 * the same rows, so the row and its comparison never disagree.
 *
 * The module is pure, so `diff-rows.test.ts` states every rule.
 */
import {
  alignLines,
  type DiffHunk,
  type LineChangeCount,
} from '@notesapp/editor';

/** One row of a comparison: a line both sides hold, or a line of one side. */
export type DiffRow = {
  readonly kind: 'context' | 'removed' | 'added';
  /** The words of the line, without its line ending. */
  readonly text: string;
};

/** One changed region of a comparison, as the rows a person reads. */
export type DiffBlock = {
  /** The first line of the region in the older text, from 1. */
  readonly beforeStart: number;
  /** The first line of the region in the newer text, from 1. */
  readonly afterStart: number;
  readonly rows: readonly DiffRow[];
};

/** The words of one line, without the line ending it keeps in a hunk. */
function wordsOf(line: string): string {
  return line.replace(/(?:\r\n|\r|\n)$/u, '');
}

/** The lines of one side, each ended the same way, as one text. */
function uniformText(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

/**
 * Aligns the two sides of one hunk into rows.
 *
 * Every older line shows once, as context or removed, and every newer line
 * once, as context or added. When the alignment passes its bound, every older
 * line shows as removed and every newer line as added.
 */
export function diffRowsOfHunk(hunk: DiffHunk): readonly DiffRow[] {
  const before = hunk.before.map(wordsOf);
  const after = hunk.after.map(wordsOf);
  const aligned = alignLines(uniformText(before), uniformText(after));
  if (aligned === null)
    return [
      ...before.map((text): DiffRow => ({ kind: 'removed', text })),
      ...after.map((text): DiffRow => ({ kind: 'added', text })),
    ];
  return aligned.map((entry): DiffRow => {
    if (entry.kind === 'same')
      return { kind: 'context', text: before[entry.beforeIndex] ?? '' };
    if (entry.kind === 'del')
      return { kind: 'removed', text: before[entry.beforeIndex] ?? '' };
    return { kind: 'added', text: after[entry.afterIndex] ?? '' };
  });
}

/**
 * The regions of a comparison that change a word.
 *
 * A hunk whose only change was a line ending holds context rows alone, and
 * it is left out, so a comparison of two texts with the same words shows no
 * region at all.
 */
export function diffBlocks(hunks: readonly DiffHunk[]): readonly DiffBlock[] {
  return hunks.flatMap((hunk) => {
    const rows = diffRowsOfHunk(hunk);
    return rows.some((row) => row.kind !== 'context')
      ? [{ beforeStart: hunk.beforeStart, afterStart: hunk.afterStart, rows }]
      : [];
  });
}

/** How many lines the regions add and remove. */
export function countDiffRows(blocks: readonly DiffBlock[]): LineChangeCount {
  let added = 0;
  let removed = 0;
  for (const block of blocks)
    for (const row of block.rows) {
      if (row.kind === 'added') added += 1;
      else if (row.kind === 'removed') removed += 1;
    }
  return { added, removed };
}

/** Lowers the first letter of a label that follows a comma. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The heading of one region: where it starts on each side.
 *
 * It names the two sides by the labels of the screen, so a person reads
 * "This version from line 3, current version from line 4" and not the terms
 * of a diff program.
 */
export function diffBlockHeading(
  block: DiffBlock,
  oldLabel: string,
  newLabel: string,
): string {
  return `${oldLabel} from line ${String(block.beforeStart)}, ${lowerFirst(newLabel)} from line ${String(block.afterStart)}`;
}

/** The sign before the words of a row, which states its kind without colour. */
export function diffRowSign(kind: DiffRow['kind']): string {
  return kind === 'removed' ? '−' : kind === 'added' ? '+' : '';
}
