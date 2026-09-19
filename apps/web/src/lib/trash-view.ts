/**
 * The deleted notes that the Trash screen shows.
 *
 * The server list and the local tombstones are two statements of one Trash.
 * The local statement keeps an offline deletion visible, and the server
 * statement wins when both sources know the note.
 */

/** One deleted note as the Trash screen shows it. */
export type TrashItem = {
  readonly fileId: string;
  readonly path: string;
  /** The instant of the deletion, or `null` when only this device knows it. */
  readonly deletedAt: string | null;
  /** True while the deletion has not reached the server. */
  readonly pending: boolean;
};

/** The server statement of one deleted note. */
export type RemoteTrashFile = {
  readonly fileId: string;
  readonly path: string;
  readonly deletedAt: string;
};

/** The local statement of one file. */
export type LocalTrashFile = {
  readonly fileId: string;
  readonly path: string;
  readonly deleted: boolean;
  readonly updatedAt: string;
};

/** Rows separate with the named close-group distance and no rule. */
export const trashListClassName = 'm-0 flex list-none flex-col gap-cluster p-0';

/**
 * Merges the server Trash with the deleted notes only this device knows.
 *
 * A note that this device deleted while offline has no place in the server
 * list yet. A note that another device deleted can be absent from the local
 * cache. Both belong in Trash, so the two lists join on the file identifier.
 */
export function mergeTrash(
  remote: readonly RemoteTrashFile[],
  local: readonly LocalTrashFile[],
  removedFileIds: ReadonlySet<string> = new Set(),
): readonly TrashItem[] {
  const merged = new Map<string, TrashItem>();
  for (const file of local) {
    if (!file.deleted) continue;
    merged.set(file.fileId, {
      fileId: file.fileId,
      path: file.path,
      deletedAt: file.updatedAt,
      pending: true,
    });
  }
  for (const file of remote)
    merged.set(file.fileId, {
      fileId: file.fileId,
      path: file.path,
      deletedAt: file.deletedAt,
      pending: false,
    });
  return [...merged.values()]
    .filter((file) => !removedFileIds.has(file.fileId))
    .sort((left, right) => {
      const leftAt = Date.parse(left.deletedAt ?? '');
      const rightAt = Date.parse(right.deletedAt ?? '');
      if (
        Number.isFinite(leftAt) &&
        Number.isFinite(rightAt) &&
        leftAt !== rightAt
      )
        return rightAt - leftAt;
      return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
    });
}
