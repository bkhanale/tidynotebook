/**
 * The marker a reader shows for one ordered list item (record 0089).
 *
 * The source of a note keeps numeric CommonMark markers at every depth, so the
 * file stays portable. A reader shows each item by its value, which is the
 * start of its list plus its place in the list, and by a style that follows
 * the number of ordered lists around it. The styles cycle so that a list and
 * the list inside it never look the same: decimal, then upper alpha, then
 * lower roman, then decimal again.
 *
 * The names are the CSS list style names, so the published page draws the
 * same cycle with the stylesheet, and the live preview draws it with the
 * label below. Both follow the counter rules of CSS: an alphabetic style has
 * no zero and no negative value, and a roman style stops at 3999, so a value
 * outside a range falls back to decimal as a browser does.
 */

/** The ordered styles, from the outer list inward. */
export const orderedMarkerStyles = [
  'decimal',
  'upper-alpha',
  'lower-roman',
] as const;

/** One ordered marker style, named as CSS names it. */
export type OrderedMarkerStyle = (typeof orderedMarkerStyles)[number];

/**
 * The style of an ordered list at one level.
 *
 * `level` counts the ordered lists that hold the list, so a list with no
 * ordered list around it is level 0. A bullet list between two ordered lists
 * does not count, which is also what the descendant selector of the published
 * page counts.
 */
export function orderedMarkerStyle(level: number): OrderedMarkerStyle {
  const count = orderedMarkerStyles.length;
  const index = ((Math.floor(level) % count) + count) % count;
  return orderedMarkerStyles[index] ?? 'decimal';
}

/** The letters of an alphabetic value, as CSS counts them: A to Z, then AA. */
function alphabetic(value: number): string {
  let rest = value;
  let text = '';
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    text = String.fromCharCode(65 + digit) + text;
    rest = Math.floor((rest - 1) / 26);
  }
  return text;
}

/** The roman numerals of one value from 1 to 3999, in lower case. */
function roman(value: number): string {
  const steps: readonly (readonly [number, string])[] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let rest = value;
  let text = '';
  for (const [size, numeral] of steps)
    while (rest >= size) {
      text += numeral;
      rest -= size;
    }
  return text;
}

/**
 * The label a reader shows for one ordered item, with its trailing period.
 *
 * `value` is the value CommonMark gives the item and `level` is the level of
 * its list, as {@link orderedMarkerStyle} counts it.
 */
export function orderedMarkerLabel(value: number, level: number): string {
  const style = orderedMarkerStyle(level);
  const whole = Math.trunc(value);
  if (style === 'upper-alpha' && whole >= 1) return `${alphabetic(whole)}.`;
  if (style === 'lower-roman' && whole >= 1 && whole <= 3999)
    return `${roman(whole)}.`;
  return `${String(whole)}.`;
}
