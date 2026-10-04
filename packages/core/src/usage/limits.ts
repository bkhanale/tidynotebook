/**
 * What the limits and the caps of record 0193 close, and which operation each
 * closure refuses.
 *
 * A count closes its part of the product once it reaches the limit of the
 * account or the cap of the installation, and the part opens again at the
 * next month in UTC:
 *
 * - **Published transfer.** Every link of the account answers the closed page
 *   of record 0146.
 * - **Downloads.** An export, an attachment and a sync snapshot answer
 *   `download_limit`. A small answer of the API and a sync change still
 *   answer, so the application keeps working.
 * - **Object writes.** An upload and an import answer `storage_busy`.
 * - **Object reads.** An attachment answers `download_limit`, and the reader
 *   path shows a page without its images.
 *
 * With no limit and no cap nothing is checked: `checksNothing` answers true,
 * and a caller then reads no total.
 */
import type { MonthlyCounts, TransferLimits, UsageCaps } from './model.ts';

/** What the limits close now. Each member is true while it is closed. */
export type UsageState = {
  readonly publishedPagesClosed: boolean;
  readonly downloadsPaused: boolean;
  readonly uploadsPaused: boolean;
  readonly imagesPaused: boolean;
};

/** Nothing is closed. */
export const openUsage: UsageState = Object.freeze({
  publishedPagesClosed: false,
  downloadsPaused: false,
  uploadsPaused: false,
  imagesPaused: false,
});

/** Whether a count has reached a limit. A `null` limit is never reached. */
export function reached(count: number, limit: number | null): boolean {
  return limit !== null && count >= limit;
}

/** Whether no limit of the account and no cap of the installation is set. */
export function checksNothing(
  limits: TransferLimits,
  caps: UsageCaps,
): boolean {
  return (
    limits.publishedTransferBytes === null &&
    limits.downloadBytes === null &&
    caps.publishedTransferBytes === null &&
    caps.downloadBytes === null &&
    caps.objectWrites === null &&
    caps.objectReads === null
  );
}

/**
 * What the counts of one month close.
 *
 * `account` is the count of the account and `installation` the count of the
 * whole installation, each the stored total with the sum of this process.
 */
export function usageState(input: {
  readonly limits: TransferLimits;
  readonly caps: UsageCaps;
  readonly account: MonthlyCounts;
  readonly installation: MonthlyCounts;
}): UsageState {
  const { limits, caps, account, installation } = input;
  return {
    publishedPagesClosed:
      reached(account.publishedTransferBytes, limits.publishedTransferBytes) ||
      reached(installation.publishedTransferBytes, caps.publishedTransferBytes),
    downloadsPaused:
      reached(account.downloadBytes, limits.downloadBytes) ||
      reached(installation.downloadBytes, caps.downloadBytes),
    uploadsPaused: reached(installation.objectWrites, caps.objectWrites),
    imagesPaused: reached(installation.objectReads, caps.objectReads),
  };
}

/** What a refused operation answers. */
export type UsageRefusal = 'download_limit' | 'storage_busy';

/**
 * The operations that a closure refuses, by operation id of the contract.
 *
 * - `download`: an export and a sync snapshot, refused past the download
 *   limit or cap.
 * - `attachment`: the bytes of an attachment, refused past the download
 *   limit or cap and past the object read cap.
 * - `upload`: an upload and an import, refused past the object write cap.
 *
 * `apps/server/src/usage/gates.test.ts` holds the list to the contract.
 */
export const usageGates = {
  exportNote: 'download',
  inspectWorkspaceExport: 'download',
  exportWorkspace: 'download',
  startSnapshot: 'download',
  getSnapshotPage: 'download',
  getAttachmentRevision: 'attachment',
  uploadAttachment: 'upload',
  startWorkspaceImport: 'upload',
  sendWorkspaceImportPart: 'upload',
  completeWorkspaceImport: 'upload',
} as const;

/** The kind of one gate. */
export type UsageGate = (typeof usageGates)[keyof typeof usageGates];

/** The gate of one operation, or `null` when no closure refuses it. */
export function usageGateOf(operationId: string): UsageGate | null {
  for (const [id, gate] of Object.entries(usageGates))
    if (id === operationId) return gate;
  return null;
}

/** What one gate answers in one state, or `null` when it lets it pass. */
export function gateRefusal(
  gate: UsageGate,
  state: UsageState,
): UsageRefusal | null {
  if (gate === 'upload') return state.uploadsPaused ? 'storage_busy' : null;
  if (state.downloadsPaused) return 'download_limit';
  if (gate === 'attachment' && state.imagesPaused) return 'download_limit';
  return null;
}
