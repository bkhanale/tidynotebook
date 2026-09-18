/**
 * The alert rule of a block quote.
 *
 * A block quote whose first line holds one marker, for example `[!NOTE]`, is
 * an alert. The construct comes from GitHub, and a document that a person
 * wrote there must read the same way here. The marker is not content: it
 * names the tone of the quote, so both readers of a note hide it and draw the
 * tone instead.
 *
 * This module holds the marker and the tone alone, so the renderer and the
 * live preview read one rule. Neither side repeats the pattern, which is the
 * same reason the math delimiters live in `./math-syntax.ts`.
 *
 * The rule is deliberately narrow. The marker stands alone on the first line
 * of the quote, and the name is one of the five below. Anything else is an
 * ordinary block quote, so a line that starts with a bracket keeps its text.
 */

/** The five tones of an alert. */
export const alertTones = [
  'note',
  'tip',
  'important',
  'warning',
  'caution',
] as const;

/** The tone of one alert. */
export type AlertTone = (typeof alertTones)[number];

/**
 * The marker of an alert, anchored to the start of the first quoted line.
 *
 * The name is matched without regard to case, because GitHub accepts both,
 * and trailing spaces are allowed because an editor strips them late.
 */
const markerPattern =
  /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n|$)/i;

/** Whether a name is one of the five tones. */
function isAlertTone(value: string): value is AlertTone {
  return alertTones.some((tone) => tone === value);
}

/**
 * The tone that one block quote opens with, or `null`.
 *
 * `text` is the content of the quote with the `>` marks already removed, so a
 * caller passes the text of the first paragraph or the text that follows the
 * quote marks of the first line.
 */
export function alertToneOf(text: string): AlertTone | null {
  const name = markerPattern.exec(text)?.[1]?.toLowerCase();
  return name !== undefined && isAlertTone(name) ? name : null;
}

/** The length of the marker at the start of `text`, or 0 when there is none. */
export function alertMarkerLength(text: string): number {
  const match = markerPattern.exec(text);
  if (match === null) return 0;
  const whole = match[0];
  // The line break after the marker belongs to the marker, so the text of the
  // alert starts on its own line. A marker that ends the text has none.
  return whole.length;
}

/** The title a reader sees in place of the marker of one tone. */
export function alertTitle(tone: AlertTone): string {
  return `${tone.slice(0, 1).toUpperCase()}${tone.slice(1)}`;
}
