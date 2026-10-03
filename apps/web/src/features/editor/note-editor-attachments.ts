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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { createAttachmentLoader } from '../../lib/attachment-content.ts';
import { createCoalescedRead } from '../../lib/coalesced-read.ts';
import type { LocalStore } from '@notesapp/sync';
import { createAttachmentReader } from './attachment-reader.ts';

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
  /**
   * Reads the references of a new text of the note. The editor calls it after
   * a quiet time, never for each key, and an unchanged set of references
   * reads nothing (record 0175).
   */
  readonly scan: (text: string) => void;
};

/**
 * Owns the attachment object URLs of one open note.
 *
 * URLs are created for the references the buffer names and revoked when their
 * references leave the note and when the editor closes. The returned ref
 * always holds the current map, so a resolver can read it without a rerender.
 * The map changes, and the screen renders, only when a URL comes or goes.
 */
export function useAttachmentUrls(
  store: LocalStore,
  accountId: string,
  workspaceId: string,
  notePathRef: { readonly current: string },
  initialText: string,
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
  const textRef = useRef(initialText);
  const askRef = useRef<() => void>(() => {});
  const loader = useMemo(
    () => createAttachmentLoader(workspaceId),
    [workspaceId],
  );

  // Attachment widgets use authenticated object URLs. URLs are revoked when
  // their references leave the note and when the editor closes.
  useEffect(() => {
    const controller = new AbortController();
    const owned = ownedUrlsRef.current;
    const reader = createAttachmentReader({
      listFiles: () => store.listLocalFiles(accountId, workspaceId),
      load: (revisionId) =>
        loader.loadAttachment(revisionId, controller.signal),
      recent: recentAttachments,
      owned,
      changed: () => {
        setAttachmentUrls((current) =>
          sameUrls(current, owned)
            ? current
            : new Map(
                [...owned].map(([id, entry]) => [id, entry.url] as const),
              ),
        );
      },
    });
    const read = createCoalescedRead(() =>
      reader.read(textRef.current, notePathRef.current),
    );
    askRef.current = read.ask;
    read.ask();
    // A picture that a read left out, because its file or its bytes were
    // not on this device yet, loads when the files of the area change.
    const unsubscribe = store.subscribe((change) => {
      if (
        change.accountId === accountId &&
        change.workspaceId === workspaceId &&
        change.kind === 'file' &&
        !reader.complete()
      )
        read.ask();
    });
    return () => {
      unsubscribe();
      reader.stop();
      read.stop();
      askRef.current = () => {};
      controller.abort();
    };
  }, [store, accountId, workspaceId, notePathRef, loader, recentAttachments]);

  const scan = useCallback((text: string): void => {
    textRef.current = text;
    askRef.current();
  }, []);

  useEffect(
    () => () => {
      for (const entry of ownedUrlsRef.current.values()) entry.dispose();
      ownedUrlsRef.current.clear();
    },
    [],
  );

  return { attachmentUrls, attachmentUrlsRef, scan };
}
