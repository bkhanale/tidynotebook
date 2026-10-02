/**
 * The footnote label rule of the product, in one place (record 0156).
 *
 * remark reads GFM footnotes through `micromark-extension-gfm-footnote`, and
 * the Lezer grammar of `@notesapp/editor` reads them through its own
 * extension. Both must find the same labels, so the rule of the micromark
 * extension is stated here and the editor imports it. `footnote-syntax.test.ts`
 * compares the rule with `parseMarkdown`, so the two cannot drift apart.
 *
 * The rule:
 *
 * - A reference is `[^label]` and a definition starts with `[^label]:`.
 * - A label holds 1 to 999 characters, and no space, no tab, no line break
 *   and no `[`. A backslash before `[`, `\` or `]` escapes it.
 * - Labels match without regard to case.
 *
 * This module holds no parser. It states the rule as data and as two small
 * functions, so a change here reaches both engines.
 */

/** The characters that open a footnote label. */
export const footnoteLabelOpen = '[^';

/** The longest footnote label, in characters. */
export const footnoteLabelMax = 999;

/** The characters that end a label in a reference or a definition. */
const breaking = new Set(['[', ' ', '\t', '\n', '\r']);

/** The characters that a backslash escapes in a label. */
const escapable = new Set(['[', '\\', ']']);

/**
 * Reads a footnote label that starts at `from`, the offset after `[^`.
 *
 * Returns the offset of the `]` that closes the label, or -1 when the text
 * from there holds no label.
 */
export function footnoteLabelEnd(text: string, from: number): number {
  let size = 0;
  for (let at = from; at < text.length; at += 1) {
    if (size > footnoteLabelMax) return -1;
    const character = text[at] ?? '';
    if (character === ']') return size > 0 ? at : -1;
    if (breaking.has(character)) return -1;
    size += 1;
    if (character === '\\' && escapable.has(text[at + 1] ?? '')) {
      at += 1;
      size += 1;
    }
  }
  return -1;
}

/**
 * The identifier of a label, which matches a reference to its definition.
 *
 * A label holds no white space, so the identifier is the label in one case.
 */
export function footnoteIdentifier(label: string): string {
  return label.toLowerCase().toUpperCase();
}
