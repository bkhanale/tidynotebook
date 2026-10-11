/**
 * The calendar month in UTC of record 0193.
 *
 * Every count and every limit of a month starts again at the first instant of
 * the next month in UTC. `usageMonth` of `identity/operator.ts` names a month
 * as `YYYY-MM`, and this file answers its first day and its end.
 */
import { usageMonth } from '../identity/operator.ts';

export { usageMonth };

/** The first day of a month `YYYY-MM`, as the date `YYYY-MM-01`. */
export function monthFirstDay(month: string): string {
  return `${month}-01`;
}

/** The first instant of the month after the month of `now`, in UTC. */
export function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * The whole seconds from `now` to the next month, at least one, for the
 * `retry-after` header of a refusal that holds until then.
 */
export function secondsToNextMonth(now: Date): number {
  return Math.max(
    1,
    Math.ceil((nextMonthStart(now).getTime() - now.getTime()) / 1000),
  );
}
