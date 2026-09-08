/** The state that an explicit save compares. */
export type CheckpointComparison = {
  readonly digest: string;
  readonly path: string;
  readonly deleted: boolean;
};

/**
 * Reports whether a version must be written.
 *
 * A named Save always creates a version. An unnamed internal operation writes
 * only when content or file metadata changed.
 */
export function shouldCheckpoint(
  previous: CheckpointComparison | null,
  draft: CheckpointComparison,
  message: string | null,
): boolean {
  if (message !== null && message !== '') return true;
  if (previous === null) return true;
  return (
    previous.digest !== draft.digest ||
    previous.path !== draft.path ||
    previous.deleted !== draft.deleted
  );
}
