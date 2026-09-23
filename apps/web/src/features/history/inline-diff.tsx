/**
 * One unified line comparison of two texts.
 *
 * History compares a version with the newest one, and Review compares the
 * text that caused it with the note now (record 0087). Both read the same
 * hunks of `@notesapp/editor`, so the two screens show a change the same way.
 */
import { useMemo, type ReactNode } from 'react';
import { alignLines, type DiffHunk } from '@notesapp/editor';

/** One classified row of an inline hunk for screen readers and sighted users. */
type DiffRow = {
  readonly kind: 'context' | 'removed' | 'added';
  readonly text: string;
};

/**
 * Aligns the two sides of one hunk into display rows.
 *
 * The alignment is exact: every before line shows once as context or
 * removed, and every after line once as context or added, including
 * unchanged lines inside the changed region. When even that small alignment
 * exceeds its bound, every before line shows as removed and every after line
 * as added.
 */
function rowsOfHunk(hunk: DiffHunk): readonly DiffRow[] {
  const before = [...hunk.before];
  const after = [...hunk.after];
  const aligned = alignLines(before.join(''), after.join(''));
  if (aligned === null)
    return [
      ...before.map((line): DiffRow => ({ kind: 'removed', text: line })),
      ...after.map((line): DiffRow => ({ kind: 'added', text: line })),
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
 * One unified inline diff in the main pane.
 *
 * Hunks render in order with their 1-based line ranges. Removed lines carry a
 * minus prefix, added lines a plus prefix, and context lines a blank prefix.
 * The text of every line renders verbatim, including whitespace.
 */
export function InlineDiff({
  hunks,
  idPrefix,
  oldLabel,
  newLabel,
  sameText,
}: {
  readonly hunks: readonly DiffHunk[];
  readonly idPrefix: string;
  readonly oldLabel: string;
  readonly newLabel: string;
  /** What the comparison says when the two texts hold the same lines. */
  readonly sameText: string;
}): ReactNode {
  const rendered = useMemo(
    () =>
      hunks.map((hunk) => ({
        hunk,
        rows: rowsOfHunk(hunk),
      })),
    [hunks],
  );
  if (rendered.length === 0)
    return <p className="m-0 text-control text-muted">{sameText}</p>;
  return (
    <ol className="m-0 list-none space-y-4 p-0" aria-label="Line differences">
      {rendered.map((entry, index) => {
        const beforeCount = entry.hunk.before.length;
        const afterCount = entry.hunk.after.length;
        return (
          <li
            className="overflow-hidden rounded-lg border border-edge-subtle"
            key={`${idPrefix}-hunk-${String(index)}`}
          >
            <h4 className="m-0 bg-surface px-3 py-2 text-control font-medium text-strong">
              {`Hunk ${String(index + 1)}: ${oldLabel} from line ${String(entry.hunk.beforeStart)} (${String(beforeCount)} lines), ${newLabel} from line ${String(entry.hunk.afterStart)} (${String(afterCount)} lines)`}
            </h4>
            <ol className="m-0 list-none p-0 font-mono text-control">
              {entry.rows.map((row, rowIndex) => (
                <li
                  // The tone of a changed line is a fill from the palette and
                  // never a fade of a text colour (decisions 0057 and 0065).
                  // The text on a tone surface is the strong text, which the
                  // contrast test holds on each of the three surfaces, and
                  // the sign in front of the line states the change as well.
                  className={`flex gap-cluster px-3 py-0.5 ${row.kind === 'removed' ? 'bg-danger-surface text-strong' : row.kind === 'added' ? 'bg-success-surface text-strong' : 'text-muted'}`}
                  key={`${idPrefix}-hunk-${String(index)}-row-${String(rowIndex)}`}
                >
                  <span>
                    {row.kind === 'removed'
                      ? '− '
                      : row.kind === 'added'
                        ? '+ '
                        : '  '}
                  </span>
                  <code className="whitespace-pre-wrap">
                    {row.text === '' ? '(empty line)' : row.text}
                  </code>
                </li>
              ))}
            </ol>
          </li>
        );
      })}
    </ol>
  );
}
