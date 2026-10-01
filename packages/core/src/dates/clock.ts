/**
 * A time of the day, as data (record 0149).
 *
 * A template writes the time at which a device fills it. Like a calendar
 * date, the time is what the clock of the device reads, and not an instant,
 * so this module never reads a clock either: the caller states the time.
 */

/** One time of the day on a clock of 24 hours. */
export type ClockTime = {
  /** `0` to `23`. */
  readonly hour: number;
  /** `0` to `59`. */
  readonly minute: number;
  /** `0` to `59`. */
  readonly second: number;
};
