/**
 * The note list that the link completion of the open editor offers.
 *
 * It travels through one compartment, so a refreshed list never replaces the
 * document. Only a change of the file list reads it again, one read at a
 * time, and an unchanged list reconfigures nothing (records 0175, 0176).
 */
import { useEffect, type RefObject } from 'react';
import { setNoteLinkSource, type EditorView } from '@notesapp/editor';
import type { LocalChange, LocalStore } from '@notesapp/sync';
import { createCoalescedRead } from '../../lib/coalesced-read.ts';

/**
 * Whether a change of the store can change the file list of the area. A
 * write of document work, a Review and a cursor cannot.
 */
export function fileListChange(change: LocalChange): boolean {
  return (
    change.kind === 'draft' ||
    change.kind === 'queue' ||
    change.kind === 'file' ||
    change.kind === 'purge' ||
    change.kind === 'reset'
  );
}

/** Feeds the link completion of the view of one open note. */
export function useNoteLinkSource(
  store: LocalStore,
  accountId: string,
  workspaceId: string,
  workingCopyId: string,
  viewRef: RefObject<EditorView | null>,
  pathRef: { readonly current: string },
): void {
  // The note list feeds the link completion. It travels through one
  // compartment, so a refreshed list never replaces the document. Only a
  // change of the file list reads it again, one read at a time (record 0176).
  useEffect(() => {
    let cancelled = false;
    // The list the view holds, so an unchanged list reconfigures nothing.
    let shown: string | null = null;
    const read = createCoalescedRead(async (): Promise<void> => {
      try {
        const files = await store.listLocalFiles(accountId, workspaceId);
        const view = viewRef.current;
        if (cancelled || view === null) return;
        const notes = files
          .filter((file) => file.kind === 'note' && !file.deleted)
          .map((file) => ({ path: file.path }));
        const key = JSON.stringify([pathRef.current, notes]);
        if (key === shown) return;
        shown = key;
        setNoteLinkSource(view, {
          currentPath: pathRef.current,
          notes,
        });
      } catch {
        // Completion is an aid. Without the list the person still types a
        // link by hand, so a failed read changes nothing else.
      }
    });
    read.ask();
    const unsubscribe = store.subscribe((change) => {
      if (
        change.accountId === accountId &&
        change.workspaceId === workspaceId &&
        fileListChange(change)
      )
        read.ask();
    });
    return () => {
      cancelled = true;
      read.stop();
      unsubscribe();
    };
  }, [store, accountId, workspaceId, workingCopyId, viewRef, pathRef]);
}
