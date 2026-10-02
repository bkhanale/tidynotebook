/**
 * The upload of a pasted, dropped or chosen picture of the open note.
 *
 * Each file is read locally first, uploaded through the generated
 * operation, finalized as an immutable attachment revision, and embedded as a
 * relative path. No external URL is ever fetched through the server:
 * importing an external image means the person supplies its bytes here. A
 * failure keeps the text and reports one notice.
 */
import { useCallback, useRef, useState, type RefObject } from 'react';
import { finalizeAttachment, uploadAttachment } from '@notesapp/api-client';
import { generateUUID } from '@notesapp/core';
import { insertText, type EditorView } from '@notesapp/editor';
import { portableRelativePath } from '@notesapp/markdown';
import type { LocalStore } from '@notesapp/sync';
import { problemMessage, useRequestSync } from '../../app.tsx';
import {
  maxPastedBytes,
  sanitizeAttachmentName,
} from './note-editor-attachments.ts';

/** What one attachment upload is doing right now. */
export type AttachState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'uploading'; readonly name: string }
  | { readonly kind: 'failed'; readonly message: string };

/** The upload of the pictures of one open note. */
export function useImageUpload({
  store,
  workspaceId,
  viewRef,
  pathRef,
  setNotice,
}: {
  readonly store: LocalStore;
  readonly workspaceId: string;
  readonly viewRef: RefObject<EditorView | null>;
  readonly pathRef: { readonly current: string };
  readonly setNotice: (message: string) => void;
}): {
  readonly attachState: AttachState;
  /** The attachments of this open, by path, before the list holds them. */
  readonly recentAttachments: ReadonlyMap<string, string>;
  readonly upload: (files: readonly File[]) => void;
  /** Uploads the files of the last upload again. */
  readonly retry: () => void;
} {
  const [attachState, setAttachState] = useState<AttachState>({ kind: 'idle' });
  const [recentAttachments, setRecentAttachments] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const lastFilesRef = useRef<readonly File[]>([]);
  const requestSync = useRequestSync();
  const live = useRef({ store, workspaceId });
  live.current = { store, workspaceId };

  const upload = useCallback(
    (files: readonly File[]): void => {
      const images = files.filter((file) => file.type.startsWith('image/'));
      if (images.length === 0) return;
      lastFilesRef.current = images;
      void (async (): Promise<void> => {
        const current = live.current;
        for (const file of images) {
          setAttachState({ kind: 'uploading', name: file.name });
          if (file.size > maxPastedBytes) {
            const message = `The image ${file.name} is larger than 20 MiB and was not uploaded.`;
            setAttachState({ kind: 'failed', message });
            setNotice(message);
            continue;
          }
          try {
            const uploaded = await uploadAttachment({
              path: { workspaceId: current.workspaceId },
              body: { file },
            });
            if (uploaded.error !== undefined || uploaded.data === undefined) {
              const message = `The image ${file.name} did not upload: ${problemMessage(uploaded.error)}`;
              setAttachState({ kind: 'failed', message });
              setNotice(message);
              continue;
            }
            const fileId = generateUUID();
            const revisionId = generateUUID();
            const safeName = sanitizeAttachmentName(file.name);
            const finalized = await finalizeAttachment({
              path: {
                workspaceId: current.workspaceId,
                objectId: uploaded.data.objectId,
              },
              body: {
                fileId,
                revisionId,
                mutationId: generateUUID(),
                deviceId: current.store.deviceId,
                path: `attachments/${fileId}-${safeName}`,
                digest: uploaded.data.digest,
              },
            });
            if (finalized.error !== undefined) {
              const message = `The image ${file.name} did not finalize: ${problemMessage(finalized.error)}`;
              setAttachState({ kind: 'failed', message });
              setNotice(message);
              continue;
            }
            const attachmentPath = `attachments/${fileId}-${safeName}`;
            setRecentAttachments((currentAttachments) =>
              new Map(currentAttachments).set(attachmentPath, revisionId),
            );
            requestSync();
            const view = viewRef.current;
            if (view !== null)
              insertText(
                view,
                `![${safeName}](${portableRelativePath(pathRef.current, attachmentPath)})`,
              );
            setAttachState({ kind: 'idle' });
            setNotice('');
          } catch {
            const message = `The image ${file.name} could not be read on this device.`;
            setAttachState({ kind: 'failed', message });
            setNotice(message);
          }
        }
      })();
    },
    [requestSync, viewRef, pathRef, setNotice],
  );

  const retry = useCallback((): void => {
    upload(lastFilesRef.current);
  }, [upload]);

  return { attachState, recentAttachments, upload, retry };
}
