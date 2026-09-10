/**
 * The message that the Save action writes: none.
 *
 * v0.1 has no named versions, so nothing names a version on the person's
 * behalf. A stored message such as `Manual save` said nothing and made every
 * Save create a version, because a message forces one. With no message the
 * rule below decides, so a Save that changed nothing writes nothing.
 */
export const saveCheckpointMessage: string | null = null;

/** The state that an explicit save compares. */
export type CheckpointComparison = {
  readonly digest: string;
  readonly path: string;
  readonly deleted: boolean;
};

/**
 * Reports whether a version must be written.
 *
 * A named version is always written, because only a person names one. An
 * operation with no name, which includes the Save action, writes only when the
 * content or the file metadata changed.
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
