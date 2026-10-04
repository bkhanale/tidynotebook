/**
 * The counts of one calendar month in UTC, and the limits that hold them
 * (record 0193).
 *
 * The server counts the bytes that it sends for an account and the calls
 * that it makes to an S3 store. Four counts exist for each month: the bytes
 * of the published pages, the bytes of the downloads, and the write calls and
 * the read calls to the object store. An account carries two limits (record
 * 0189), and the installation carries a cap on each of the four counts. A
 * `null` limit or cap is none.
 *
 * A count is a whole number of a JavaScript number. A month cannot send more
 * bytes than `Number.MAX_SAFE_INTEGER`, which is eight petabytes.
 */

/** The four counts of one month. */
export type MonthlyCounts = {
  readonly publishedTransferBytes: number;
  readonly downloadBytes: number;
  readonly objectWrites: number;
  readonly objectReads: number;
};

/** A month with no count. */
export const zeroCounts: MonthlyCounts = Object.freeze({
  publishedTransferBytes: 0,
  downloadBytes: 0,
  objectWrites: 0,
  objectReads: 0,
});

/** The sum of two counts. */
export function sumCounts(
  left: MonthlyCounts,
  right: MonthlyCounts,
): MonthlyCounts {
  return {
    publishedTransferBytes:
      left.publishedTransferBytes + right.publishedTransferBytes,
    downloadBytes: left.downloadBytes + right.downloadBytes,
    objectWrites: left.objectWrites + right.objectWrites,
    objectReads: left.objectReads + right.objectReads,
  };
}

/** Whether a count holds nothing. */
export function isZero(counts: MonthlyCounts): boolean {
  return (
    counts.publishedTransferBytes === 0 &&
    counts.downloadBytes === 0 &&
    counts.objectWrites === 0 &&
    counts.objectReads === 0
  );
}

/** The two limits of one account for one month (record 0189). */
export type TransferLimits = {
  readonly publishedTransferBytes: number | null;
  readonly downloadBytes: number | null;
};

/** An account with no transfer limit. */
export const noTransferLimits: TransferLimits = Object.freeze({
  publishedTransferBytes: null,
  downloadBytes: null,
});

/**
 * The caps of the installation for one month, from
 * `NOTESAPP_PUBLISHED_TRANSFER_CAP_BYTES`, `NOTESAPP_DOWNLOAD_CAP_BYTES`,
 * `NOTESAPP_OBJECT_WRITE_CAP` and `NOTESAPP_OBJECT_READ_CAP`.
 */
export type UsageCaps = {
  readonly publishedTransferBytes: number | null;
  readonly downloadBytes: number | null;
  readonly objectWrites: number | null;
  readonly objectReads: number | null;
};

/** An installation with no cap. */
export const noUsageCaps: UsageCaps = Object.freeze({
  publishedTransferBytes: null,
  downloadBytes: null,
  objectWrites: null,
  objectReads: null,
});
