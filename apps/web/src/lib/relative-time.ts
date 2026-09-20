/**
 * Time written the way a reader says it.
 *
 * A stored instant is an ISO 8601 string, which is a storage detail. The
 * interface shows how long ago it was, because a person who looks at the trash
 * wants to know whether a note went there a minute ago or last month. The
 * function is pure and takes the current instant, so a test states both ends.
 */

/** One step of the scale, from the smallest to the largest. */
const steps: readonly {
  readonly unit: Intl.RelativeTimeFormatUnit;
  readonly ms: number;
}[] = [
  { unit: 'second', ms: 1000 },
  { unit: 'minute', ms: 60_000 },
  { unit: 'hour', ms: 3_600_000 },
  { unit: 'day', ms: 86_400_000 },
  { unit: 'month', ms: 2_592_000_000 },
  { unit: 'year', ms: 31_536_000_000 },
];

/**
 * How often a screen reads the clock again, in milliseconds.
 *
 * A phrase of this scale is only true for the instant it was built from, so a
 * screen that stays open has to read the clock again. The smallest step of the
 * scale is one minute, which is also when the first phrase changes, from
 * `just now` to `1 minute ago`. The step below is half of that minute, so no
 * phrase of the scale is ever skipped and no phrase stands for longer than
 * half a minute after it stopped being true.
 *
 * `useNow` in `apps/web/src/shell/now.ts` is the one reader of this value.
 */
export const relativeTimeStepMs = 30_000;

/** The name of one folder path, or `null` when the note is at the top. */
export function folderOf(path: string): string | null {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? null : path.slice(0, cut);
}

/**
 * How long ago one instant was, in words.
 *
 * An instant that the browser cannot read answers an empty string, so a
 * damaged value never reaches the reader as an error code. Anything under a
 * minute reads as `just now`, because a smaller number tells a person nothing
 * and would change while they read it.
 */
export function relativeTime(instant: string, now: number): string {
  const at = Date.parse(instant);
  if (!Number.isFinite(at)) return '';
  const elapsed = now - at;
  if (elapsed < 60_000 && elapsed > -60_000) return 'just now';
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  let chosen = steps[0] ?? { unit: 'second' as const, ms: 1000 };
  for (const step of steps) if (Math.abs(elapsed) >= step.ms) chosen = step;
  return format.format(-Math.round(elapsed / chosen.ms), chosen.unit);
}
