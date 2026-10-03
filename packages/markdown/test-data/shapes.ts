/**
 * Shapes of note that once cost the square of their size to parse or to
 * render, and the shapes of the same family (records 0182 and 0185).
 *
 * Each shape is a unit that a note repeats until it reaches a size. The
 * review of 2026-10-03 found the first of them, and the probe of that review
 * the rest. `src/parse.test.ts` holds the work of each shape in proportion to
 * its size, or the refusal of a count before the parse, and
 * `tools/performance/parse-shapes.ts` times them at sizes that double.
 */
export const noteShapes: Readonly<Record<string, string>> = {
  'trailing spaces': 'a  \n',
  'one trailing space': 'some words \n',
  'trailing tab': 'a\t\n',
  'backslash break': 'a\\\n',
  'prose lines': 'a b\n',
  'one character lines': 'a\n',
  'web literals': 'www.a ',
  'mail literals': 'a@b.c ',
  'protocol literals': 'http://a.b ',
  'web literal after a colon': ' :www.a.b',
  'dotted word': 'a.',
  'web literals in a word': 'xwww.a',
  'mail after a comma': 'a@b.co,',
  'code spans': '`a` ',
  'unclosed code spans': '`a ',
  'line break tags': 'a<br> ',
  entities: '&amp; b c ',
  escapes: '\\. some words ',
  shortcodes: ':smile: ',
  'footnote calls': '[^1] ',
  'short links': '[a](b) ',
  images: '![a](b) ',
  paragraphs: 'a\n\n',
  headings: '# a\n',
  'quoted paragraphs': '> a\n\n',
  'list items': '- a\n',
  'task items': '- [ ] a\n',
  'nested lists of one item': '- - - - a\n',
  'link definitions': '[a]: b\n\n',
  'html blocks': '<div>a</div>\n\n',
};

/** The note of `unit` repeated to at most `size` characters. */
export function noteOfShape(unit: string, size: number): string {
  return unit.repeat(Math.max(1, Math.floor(size / unit.length)));
}
