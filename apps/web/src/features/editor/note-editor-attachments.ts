/**
 * Attachment object URL ownership for the note editor.
 *
 * Attachment widgets reference authenticated attachment bytes through
 * short-lived object URLs. This module owns the lifecycle of those
 * URLs: it loads one per referenced revision, holds it while the reference
 * stays in the buffer, and revokes it when the reference leaves the note or
 * when the editor closes. The editor host in `note-editor.tsx` reads the
 * resolved URLs; it never creates or revokes one itself.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { createAttachmentLoader } from '../../lib/attachment-content.ts';
import { extractAttachmentRefs } from '@notesapp/markdown';
import type { LocalFileSummary, LocalStore } from '@notesapp/sync';

/** Attachment revision references in stored Markdown. */
const attachmentReferencePattern = /\/attachments\/([0-9a-fA-F-]{36})/g;

/** Largest pasted file the editor uploads directly, matching the server cap. */
export const maxPastedBytes = 20 * 1024 * 1024;

/** The revision IDs referenced by one Markdown source, without duplicates. */
export function extractAttachmentIds(text: string): string[] {
  const found: string[] = [];
  attachmentReferencePattern.lastIndex = 0;
  for (;;) {
    const match = attachmentReferencePattern.exec(text);
    if (match === null) return found;
    const id = match[1] ?? '';
    if (id !== '' && !found.includes(id)) found.push(id);
  }
}

/** Makes a pasted file name safe for an attachment path segment. */
export function sanitizeAttachmentName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' || cleaned === '.' || cleaned === '..'
    ? 'pasted-image'
    : cleaned;
}

/** Whether the resolved attachment URLs are already the ones we hold. */
function sameUrls(
  current: ReadonlyMap<string, string>,
  owned: ReadonlyMap<string, { url: string }>,
): boolean {
  if (current.size !== owned.size) return false;
  for (const [id, entry] of owned)
    if (current.get(id) !== entry.url) return false;
  return true;
}

/** The resolved attachment URLs and a live ref to them. */
export type AttachmentUrls = {
  readonly attachmentUrls: ReadonlyMap<string, string>;
  readonly attachmentUrlsRef: MutableRefObject<ReadonlyMap<string, string>>;
};

/**
 * Owns the attachment object URLs of one open note.
 *
 * URLs are created for the references the buffer names and revoked when their
 * references leave the note and when the editor closes. The returned ref
 * always holds the current map, so a resolver can read it without a rerender.
 */
export function useAttachmentUrls(
  store: LocalStore,
  accountId: string,
  workspaceId: string,
  notePath: string,
  bufferText: string,
  recentAttachments: ReadonlyMap<string, string>,
): AttachmentUrls {
  const [attachmentUrls, setAttachmentUrls] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const attachmentUrlsRef = useRef<ReadonlyMap<string, string>>(new Map());
  attachmentUrlsRef.current = attachmentUrls;
  const ownedUrlsRef = useRef<
    Map<string, { url: string; dispose: () => void }>
  >(new Map());
  const loader = useMemo(
    () => createAttachmentLoader(workspaceId),
    [workspaceId],
  );

  // Attachment widgets use authenticated object URLs. URLs are revoked when
  // their references leave the note and when the editor closes.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async (): Promise<void> => {
      const references = extractAttachmentRefs(bufferText, notePath);
      let files: readonly LocalFileSummary[];
      try {
        files = await store.listLocalFiles(accountId, workspaceId);
      } catch {
        // A read of local storage that fails keeps the pictures that are
        // shown. The write of the same keystroke fails too, and the note
        // states that failure once (`lib/local-write.ts`).
        return;
      }
      if (cancelled) return;
      const wanted = references.flatMap((reference) => {
        if (reference.revisionId !== null)
          return [
            { key: reference.revisionId, revisionId: reference.revisionId },
          ];
        const recentRevisionId =
          reference.targetPath === null
            ? undefined
            : recentAttachments.get(reference.targetPath);
        if (recentRevisionId !== undefined)
          return [
            { key: reference.targetPath ?? '', revisionId: recentRevisionId },
          ];
        const file = files.find(
          (entry) =>
            entry.kind === 'attachment' &&
            !entry.deleted &&
            entry.path === reference.targetPath,
        );
        const revisionId =
          file?.localHeadRevisionId ?? file?.acceptedHeadRevisionId;
        return reference.targetPath === null ||
          revisionId === null ||
          revisionId === undefined
          ? []
          : [{ key: reference.targetPath, revisionId }];
      });
      const owned = ownedUrlsRef.current;
      for (const [key, entry] of owned) {
        if (!wanted.some((item) => item.key === key)) {
          entry.dispose();
          owned.delete(key);
        }
      }
      for (const item of wanted) {
        if (cancelled || owned.has(item.key)) continue;
        try {
          const loaded = await loader.loadAttachment(
            item.revisionId,
            controller.signal,
          );
          if (cancelled) {
            loaded.dispose();
            continue;
          }
          owned.set(item.key, { url: loaded.url, dispose: loaded.dispose });
        } catch {
          // A missing attachment stays as editable source in its widget.
        }
      }
      if (!cancelled)
        setAttachmentUrls((current) =>
          sameUrls(current, owned)
            ? current
            : new Map(
                [...owned].map(([id, entry]) => [id, entry.url] as const),
              ),
        );
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    store,
    accountId,
    workspaceId,
    notePath,
    loader,
    bufferText,
    recentAttachments,
  ]);

  useEffect(
    () => () => {
      for (const entry of ownedUrlsRef.current.values()) entry.dispose();
      ownedUrlsRef.current.clear();
    },
    [],
  );

  return { attachmentUrls, attachmentUrlsRef };
}
