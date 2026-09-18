/**
 * The one letter that stands for a name in a small square or a circle.
 *
 * The workspace mark of the sidebar and the account avatar of the header both
 * show it. A name starts with one grapheme, which can be more than one code
 * point, so the letter comes from the segmenter and never from an index into
 * the string. An empty name gives an empty mark, and the control keeps its
 * whole accessible name (WCAG 2.5.3).
 */
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The first grapheme of a name in upper case, or an empty string. */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') return '';
  const first = graphemes.segment(trimmed)[Symbol.iterator]().next();
  return first.done ? '' : first.value.segment.toLocaleUpperCase();
}
