/**
 * The monthly counts of record 0193 between the domain and the functions of
 * migration 0031.
 *
 * PostgreSQL answers a `bigint` as a decimal text, so each reader here turns
 * one into a safe integer, and a value that is not one is a defect of a
 * writer: the reader throws `OperationalError`, and no undeclared value
 * reaches the domain. A write sends each sum as one position of six arrays,
 * which one statement adds.
 */
import {
  monthFirstDay,
  OperationalError,
  type MonthlyCounts,
  type StoredUsage,
  type UsageEntry,
  type UsageSubject,
} from '@notesapp/core';

/** One count that the driver answered. */
function countOf(value: unknown): number {
  const count =
    typeof value === 'string' && /^\d{1,16}$/.test(value)
      ? Number(value)
      : typeof value === 'number'
        ? value
        : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 0)
    throw new OperationalError(
      'unexpected',
      'notesapp: the monthly table holds a count that no answer can carry.',
    );
  return count;
}

/** One limit that the driver answered, or `null` for no limit. */
function limitOf(value: unknown): number | null {
  return value === null || value === undefined ? null : countOf(value);
}

/** The four counts of one prefix of a row of `notesapp_stored_usage`. */
function countsOf(
  row: Readonly<Record<string, unknown>>,
  prefix: 'account' | 'installation',
): MonthlyCounts {
  return {
    publishedTransferBytes: countOf(row[`${prefix}_published_transfer_bytes`]),
    downloadBytes: countOf(row[`${prefix}_download_bytes`]),
    objectWrites: countOf(row[`${prefix}_object_writes`]),
    objectReads: countOf(row[`${prefix}_object_reads`]),
  };
}

/** The stored totals of the one row of `notesapp_stored_usage`. */
export function storedUsageOf(
  row: Readonly<Record<string, unknown>> | undefined,
): StoredUsage {
  if (row === undefined)
    throw new OperationalError(
      'unexpected',
      'notesapp: the stored totals of a month answered no row.',
    );
  return {
    account: countsOf(row, 'account'),
    installation: countsOf(row, 'installation'),
  };
}

/** The account of one row of `notesapp_usage_subject`, or `null`. */
export function usageSubjectOf(
  row: Readonly<Record<string, unknown>> | undefined,
): UsageSubject | null {
  if (row === undefined) return null;
  const accountId = row['account_id'];
  if (typeof accountId !== 'string')
    throw new OperationalError(
      'unexpected',
      'notesapp: the account of a monthly limit has no identifier.',
    );
  return {
    accountId,
    limits: {
      publishedTransferBytes: limitOf(row['published_transfer_limit_bytes']),
      downloadBytes: limitOf(row['download_limit_bytes']),
    },
  };
}

/** The six arrays of `notesapp_add_monthly_usage`, in the order it takes. */
export function usageArrays(
  entries: readonly UsageEntry[],
): readonly [
  string[],
  (string | null)[],
  number[],
  number[],
  number[],
  number[],
] {
  return [
    entries.map((entry) => monthFirstDay(entry.month)),
    entries.map((entry) => entry.accountId),
    entries.map((entry) => entry.counts.publishedTransferBytes),
    entries.map((entry) => entry.counts.downloadBytes),
    entries.map((entry) => entry.counts.objectWrites),
    entries.map((entry) => entry.counts.objectReads),
  ];
}
