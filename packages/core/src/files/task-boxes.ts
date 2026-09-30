/**
 * The task boxes that a merge left with more than one state (record 0134).
 *
 * A toggle replaces the one character between the brackets of a task box.
 * Two devices that toggle one box before either sees the other each insert a
 * character, and the document keeps both, so the box reads `[x ]`, `[ x]` or
 * `[xx]`. Such a box is no task box: the Markdown grammar reads one character
 * between the brackets and nothing else. This module names where those boxes
 * are, and the document service keeps one state in each of them.
 */

/** A range of text, as offsets in UTF-16 code units, `to` excluded. */
export type TextSlot = {
  readonly from: number;
  readonly to: number;
};

/**
 * A list item whose box holds two or more state characters.
 *
 * The prefix is any indentation, so a nested item counts, then a bullet or an
 * ordered marker and its gap. The box holds only the characters that a state
 * can hold, so a bracket that a person wrote with other words in it is never
 * a box.
 */
const doubledTaskBox =
  /^([ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+\[)([ xX]{2,})\](?=[ \t]|$)/;

/** The slots between the brackets of every box with more than one state. */
export function doubledTaskBoxes(text: string): readonly TextSlot[] {
  const slots: TextSlot[] = [];
  let lineStart = 0;
  for (const line of text.split('\n')) {
    const match = doubledTaskBox.exec(line);
    if (match !== null) {
      const from = lineStart + (match[1] ?? '').length;
      slots.push({ from, to: from + (match[2] ?? '').length });
    }
    lineStart += line.length + 1;
  }
  return slots;
}
