/**
 * When each version of a note was saved, as History shows it.
 *
 * A row used to read "Saved" and a relative time, so the versions of one
 * minute all read "Saved just now" and a person could not tell two of them
 * apart (issue 254). The versions now group by the day of the device, and
 * each row names its time of day. A row shows the seconds when another row of
 * its day falls in the same minute, so two versions of one minute read as two
 * times (record 0166).
 *
 * The time is the clock of the device in its own words, which is not a raw
 * timestamp. The functions are pure and take the instant of now, the locale
 * and the time zone, so `history-times.test.ts` states every edge.
 */

/** One version, as the rule needs it. */
export type HistoryInstant = {
  readonly id: string;
  /** The instant the server accepted the version, as ISO 8601. */
  readonly instant: string;
};

/** One row of a day: the version and the time it reads. */
export type HistoryTime = {
  readonly id: string;
  /** The time of day, for example `14:32` or `14:32:05`, or empty. */
  readonly time: string;
};

/** The versions of one day, newest first, under the label of that day. */
export type HistoryDay = {
  /** A key that is unique among the days of one list. */
  readonly key: string;
  /** `Today`, `Yesterday`, or the date, for example `Monday 28 September`. */
  readonly label: string;
  readonly rows: readonly HistoryTime[];
};

/** Where and in which words the clock reads. */
export type ClockOptions = {
  /** The locale of the words, or `undefined` for the device. */
  readonly locale?: string | undefined;
  /** The time zone of the day, or `undefined` for the device. */
  readonly timeZone?: string | undefined;
};

/** The calendar day of one instant in one time zone, as `YYYY-MM-DD`. */
function dayKey(at: number, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The year of one instant in one time zone. */
function yearOf(at: number, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(
    at,
  );
}

/**
 * The calendar day before the day of an instant, in one time zone.
 *
 * The step is one day of the calendar and not 24 hours of the clock. A day
 * that a change of the clock makes 23 or 25 hours long otherwise names the
 * day before that one, or the same day, as yesterday.
 */
function dayBefore(at: number, timeZone: string | undefined): string {
  const [year, month, day] = dayKey(at, timeZone).split('-').map(Number);
  const previous = new Date(
    Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) - 1),
  );
  return previous.toISOString().slice(0, 10);
}

/** The label of the day of one instant, seen from now. */
function dayLabel(at: number, now: number, options: ClockOptions): string {
  const key = dayKey(at, options.timeZone);
  if (key === dayKey(now, options.timeZone)) return 'Today';
  if (key === dayBefore(now, options.timeZone)) return 'Yesterday';
  const sameYear =
    yearOf(at, options.timeZone) === yearOf(now, options.timeZone);
  return new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
  }).format(at);
}

/** The time of day of one instant, with or without its seconds. */
function clockOf(at: number, seconds: boolean, options: ClockOptions): string {
  return new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: seconds ? '2-digit' : undefined,
  }).format(at);
}

/**
 * Groups the versions by day and names the time of each one.
 *
 * The order of the input is kept, so the newest version stays first. A day
 * holds every version of that calendar day of the time zone. A version whose
 * instant does not read is a day of its own with no time, so a damaged value
 * never reaches the person as an error.
 */
export function historyDays(
  items: readonly HistoryInstant[],
  now: number,
  options: ClockOptions = {},
): readonly HistoryDay[] {
  const days: {
    key: string;
    label: string;
    items: { id: string; at: number }[];
  }[] = [];
  for (const item of items) {
    const at = Date.parse(item.instant);
    const key = Number.isFinite(at) ? dayKey(at, options.timeZone) : 'unknown';
    const last = days.at(-1);
    if (last !== undefined && last.key === key) {
      last.items.push({ id: item.id, at });
      continue;
    }
    days.push({
      key: days.some((day) => day.key === key)
        ? `${key}-${String(days.length)}`
        : key,
      label: Number.isFinite(at) ? dayLabel(at, now, options) : 'Saved',
      items: [{ id: item.id, at }],
    });
  }
  return days.map((day) => {
    const minutes = day.items.map((entry) =>
      Number.isFinite(entry.at) ? clockOf(entry.at, false, options) : '',
    );
    return {
      key: day.key,
      label: day.label,
      rows: day.items.map((entry, index) => {
        if (!Number.isFinite(entry.at)) return { id: entry.id, time: '' };
        const minute = minutes[index] ?? '';
        const shared = minutes.filter((other) => other === minute).length > 1;
        return { id: entry.id, time: clockOf(entry.at, shared, options) };
      }),
    };
  });
}

/** The words of a row: when the version was saved. */
export function savedAtLabel(time: string): string {
  return time === '' ? 'Saved' : `Saved at ${time}`;
}
