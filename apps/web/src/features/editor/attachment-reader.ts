/**
 * Reads the pictures of one open note into object URLs.
 *
 * One read takes the references of the text, finds the revision of each,
 * loads the ones that are not shown yet and frees the ones that left the
 * note. A text whose references were all shown reads nothing again, so the
 * quiet time after typing costs no load (record 0175).
 *
 * A read that left a picture out, because its file is not on this device yet
 * or its bytes did not arrive, is not complete. The next read of the same
 * text tries again, and the screen asks for one when the files of the area
 * change. A read that marked such a text done kept the picture out until the
 * person changed its reference.
 */
import { extractAttachmentRefs } from '@notesapp/markdown';
import type { LocalFileSummary } from '@notesapp/sync';

/** One object URL that the reader holds. */
export type OwnedUrl = { readonly url: string; readonly dispose: () => void };

/** What a reader needs. */
export type AttachmentReaderPorts = {
  readonly listFiles: () => Promise<readonly LocalFileSummary[]>;
  readonly load: (revisionId: string) => Promise<OwnedUrl>;
  /** The revision of each recent upload, by its path. */
  readonly recent: ReadonlyMap<string, string>;
  /** The URLs that the screen shows, by reference. The reader owns them. */
  readonly owned: Map<string, OwnedUrl>;
  /** Runs after a read changed the URLs that the screen shows. */
  readonly changed: () => void;
};

/** The reader of the pictures of one open note. */
export type AttachmentReader = {
  /** Reads the references of `text`. One read runs at a time. */
  readonly read: (text: string, notePath: string) => Promise<void>;
  /** Whether the last read showed every picture of its text. */
  readonly complete: () => boolean;
  /** Ends the reader. A read that runs keeps no new URL. */
  readonly stop: () => void;
};

/** Builds the reader of the pictures of one open note. */
export function createAttachmentReader(
  ports: AttachmentReaderPorts,
): AttachmentReader {
  // The references of the last complete read, so a text whose references
  // did not change reads nothing.
  let doneKey: string | null = null;
  let stopped = false;

  return {
    read: async (text, notePath) => {
      const references = extractAttachmentRefs(text, notePath);
      const key = JSON.stringify(references);
      if (key === doneKey) return;
      doneKey = null;
      // Only a reference by path needs the file list of the area.
      const needsFiles = references.some(
        (reference) =>
          reference.revisionId === null &&
          reference.targetPath !== null &&
          !ports.recent.has(reference.targetPath),
      );
      let files: readonly LocalFileSummary[] = [];
      if (needsFiles)
        try {
          files = await ports.listFiles();
        } catch {
          // A read of local storage that fails keeps the pictures that are
          // shown. The write of the same text fails too, and the note
          // states that failure once (`lib/local-write.ts`).
          return;
        }
      if (stopped) return;
      let complete = true;
      const wanted = references.flatMap((reference) => {
        if (reference.revisionId !== null)
          return [
            { key: reference.revisionId, revisionId: reference.revisionId },
          ];
        if (reference.targetPath === null) return [];
        const recentRevisionId = ports.recent.get(reference.targetPath);
        if (recentRevisionId !== undefined)
          return [{ key: reference.targetPath, revisionId: recentRevisionId }];
        const file = files.find(
          (entry) =>
            entry.kind === 'attachment' &&
            !entry.deleted &&
            entry.path === reference.targetPath,
        );
        const revisionId =
          file?.localHeadRevisionId ?? file?.acceptedHeadRevisionId;
        if (revisionId === null || revisionId === undefined) {
          // The file can still arrive with the next feed page.
          complete = false;
          return [];
        }
        return [{ key: reference.targetPath, revisionId }];
      });
      let changed = false;
      for (const [ownedKey, entry] of ports.owned) {
        if (!wanted.some((item) => item.key === ownedKey)) {
          entry.dispose();
          ports.owned.delete(ownedKey);
          changed = true;
        }
      }
      for (const item of wanted) {
        if (stopped) return;
        if (ports.owned.has(item.key)) continue;
        try {
          const loaded = await ports.load(item.revisionId);
          if (stopped) {
            loaded.dispose();
            return;
          }
          ports.owned.set(item.key, loaded);
          changed = true;
        } catch {
          // A missing picture stays as editable source in its widget, and
          // the next read tries it again.
          complete = false;
        }
      }
      if (stopped) return;
      if (complete) doneKey = key;
      if (changed) ports.changed();
    },
    complete: () => doneKey !== null,
    stop: () => {
      stopped = true;
    },
  };
}
