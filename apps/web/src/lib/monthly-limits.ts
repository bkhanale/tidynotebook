/**
 * What the account page says about the limits of the month (record 0193).
 *
 * The server counts what the published pages of an account send and what the
 * account downloads in each calendar month in UTC. Past a limit of the
 * account or a cap of the installation, a part of the product stops until
 * the first day of the next month. The account page states each part that
 * stopped in one notice, with the cause, the date when it starts again, and
 * what still works. Every word is decided here, so the screen holds no rule.
 */
import type { Account } from '@notesapp/api-client';
import { formatBytes } from './accounts.ts';

/** The month of an account, as the account answer states it. */
export type AccountMonth = Account['month'];

/** The first instant of the month after `now`, in UTC. */
function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * The month of an account that the server has not answered yet, for example
 * an account that this device kept from an earlier session. It states no
 * closure, because a closure that this device kept can be over.
 */
export function openMonth(now: Date): AccountMonth {
  return {
    month: now.toISOString().slice(0, 7),
    endsAt: nextMonthStart(now).toISOString(),
    publishedTransferBytes: 0,
    downloadBytes: 0,
    publishedPagesClosed: false,
    downloadsPaused: false,
    uploadsPaused: false,
    imagesPaused: false,
  };
}

/**
 * The day when a closure ends, as a plain date such as `1 November 2026`.
 *
 * The month ends in UTC, so the date is the date in UTC. An instant that the
 * browser cannot read answers `the next month`, so a damaged value never
 * reaches the person.
 */
export function monthEndText(endsAt: string, locale?: string): string {
  const at = Date.parse(endsAt);
  if (!Number.isFinite(at)) return 'the next month';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(at);
}

/**
 * One notice for each part of the product that a limit of the month stopped,
 * in the order of their weight to the person. An account that nothing stopped
 * has no notice.
 */
export function monthNotices(
  month: AccountMonth,
  locale?: string,
): readonly string[] {
  const end = monthEndText(month.endsAt, locale);
  const notices: string[] = [];
  if (month.downloadsPaused)
    notices.push(
      `Exports, images and the first sync of a new device wait until ${end}, because the download limit of this month is used. You can still write and save notes.`,
    );
  if (month.uploadsPaused)
    notices.push(
      `New images and imports wait until ${end}, because the file storage of this server is busy this month. You can still write and save notes.`,
    );
  if (month.imagesPaused)
    notices.push(
      `Images do not load until ${end}, because the file storage of this server is busy this month. Your published pages show no images.`,
    );
  if (month.publishedPagesClosed)
    notices.push(
      `Your published pages show a closed page until ${end}, because they sent the most data that one month allows.`,
    );
  return notices;
}

/**
 * The transfer line of the account, such as
 * `This month: 1.2 MB of 5 GB sent by published pages`.
 *
 * A line shows only for a limit that the account has, because a count with
 * no limit tells a person nothing that they can act on.
 */
export function transferLines(
  month: AccountMonth,
  controls: Pick<
    Account['controls'],
    'publishedTransferLimitBytes' | 'downloadLimitBytes'
  >,
): readonly string[] {
  return transferUsage(month, controls).map((usage) => usage.text);
}

/** The text and the numbers of one known transfer limit. */
export type TransferUsage = {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly text: string;
};

/** Each transfer line and its meter read the same use and limit. */
export function transferUsage(
  month: AccountMonth,
  controls: Pick<
    Account['controls'],
    'publishedTransferLimitBytes' | 'downloadLimitBytes'
  >,
): readonly TransferUsage[] {
  const lines: TransferUsage[] = [];
  if (controls.publishedTransferLimitBytes !== null)
    lines.push({
      label: 'Published pages transfer this month',
      value: month.publishedTransferBytes,
      max: controls.publishedTransferLimitBytes,
      text: `This month: ${formatBytes(month.publishedTransferBytes)} of ${formatBytes(controls.publishedTransferLimitBytes)} sent by published pages`,
    });
  if (controls.downloadLimitBytes !== null)
    lines.push({
      label: 'Downloads this month',
      value: month.downloadBytes,
      max: controls.downloadLimitBytes,
      text: `This month: ${formatBytes(month.downloadBytes)} of ${formatBytes(controls.downloadLimitBytes)} downloaded`,
    });
  return lines;
}
