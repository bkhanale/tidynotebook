/**
 * The head that History names after a restore.
 *
 * A restore names the head it builds on, and the server refuses a restore
 * that names a head the file already passed. History read the head once,
 * when it opened, so the second restore of one visit named the head from
 * before the first one, and the server refused it with a precondition
 * failure (issue 254). The head moves to the revision that the restore made,
 * which the accepted changeset states, so every later restore names it.
 */

/** One accepted revision, as the restore answer states it. */
export type AcceptedHeadRevision = {
  readonly revisionId: string;
  readonly fileId: string;
};

/**
 * The head of one file after an accepted changeset, or `null` when the
 * changeset holds no revision of that file.
 *
 * The revisions of one file come in the order they were submitted, so the
 * last one is the head.
 */
export function headAfterChangeset(
  revisions: readonly AcceptedHeadRevision[],
  fileId: string,
): string | null {
  let head: string | null = null;
  for (const revision of revisions)
    if (revision.fileId === fileId) head = revision.revisionId;
  return head;
}
