/**
 * The marker of one list line, read from its text.
 *
 * The commands of `keymaps.ts` shape whole lines from their text, and the
 * renumber of `list-numbering.ts` asks whether an edit touched a marker. Both
 * read this one parser, so the two never disagree about where a marker ends.
 */

/** Everything one list line marker holds, with offsets inside the line. */
export type ListLine = {
  /** Leading white space of the line. */
  readonly indent: string;
  /** The bullet or the number with its delimiter, for example `-` or `2.`. */
  readonly bullet: string;
  /** White space between the bullet and the content or the task box. */
  readonly gap: string;
  /** The task box with its trailing white space, or the empty string. */
  readonly task: string;
  /** Whether the bullet counts items. */
  readonly kind: 'bullet' | 'ordered';
  /** The counted value of an ordered bullet, or null for a plain bullet. */
  readonly value: number | null;
  /** Length of everything before the content of the line. */
  readonly prefixLength: number;
};

/** Matches the marker of one list line, with or without a task box. */
const listLinePattern =
  /^([ \t]*)(?:([-+*])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;

/** Reads the list marker of one line, or null when the line holds none. */
export function parseListLine(lineText: string): ListLine | null {
  const match = listLinePattern.exec(lineText);
  if (match === null) return null;
  const indent = match[1] ?? '';
  const plain = match[2];
  const digits = match[3] ?? '';
  const delimiter = match[4] ?? '';
  const gap = match[5] ?? '';
  const task = match[6] ?? '';
  const bullet = plain === undefined ? `${digits}${delimiter}` : plain;
  return {
    indent,
    bullet,
    gap,
    task,
    kind: plain === undefined ? 'ordered' : 'bullet',
    value: plain === undefined ? Number.parseInt(digits, 10) : null,
    prefixLength: indent.length + bullet.length + gap.length + task.length,
  };
}
